const fs = require("node:fs");
const path = require("node:path");
const { GuildVerificationLevel, PermissionFlagsBits } = require("discord.js");

const INVITE_PATTERN = /(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)[\w-]+/i;
const EXECUTABLE_PATTERN = /\.exe(?:$|[?#\s])/i;
const URL_PATTERN = /(?:https?:\/\/|htps:\/\/|www\.)[^\s<>()]+|(?<![\w@.])(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}(?:\/[^\s<>()]*)?/gi;
const MEDIA_FILE_EXTENSION = /\.(?:apng|avif|bmp|gif|heic|heif|jpe?g|m4v|mkv|mov|mp4|mpeg|mpg|png|webm|webp|3gp)$/i;
const messageHistory = new Map();
const joinHistory = new Map();
const lastRaidAlerts = new Map();
const lockdownTimers = new Map();
const LOCKDOWN_DATA_FILE = path.join(__dirname, "..", "data", "raid-lockdowns.json");
let lastMessageHistoryCleanup = 0;

function readLockdowns() {
  if (!fs.existsSync(LOCKDOWN_DATA_FILE)) return {};
  const data = JSON.parse(fs.readFileSync(LOCKDOWN_DATA_FILE, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Le fichier data/raid-lockdowns.json doit contenir un objet JSON.");
  }
  return data;
}

const lockdowns = readLockdowns();

function saveLockdowns() {
  fs.mkdirSync(path.dirname(LOCKDOWN_DATA_FILE), { recursive: true });
  fs.writeFileSync(LOCKDOWN_DATA_FILE, `${JSON.stringify(lockdowns, null, 2)}\n`, "utf8");
}

function isProtected(member, adminIds) {
  return adminIds.has(member.id);
}

function isAllowedMediaAttachment(attachment) {
  if (EXECUTABLE_PATTERN.test(attachment.name ?? "") || EXECUTABLE_PATTERN.test(attachment.url ?? "")) {
    return false;
  }
  if (attachment.contentType) {
    return /^(?:image|video)\//i.test(attachment.contentType);
  }
  return MEDIA_FILE_EXTENSION.test(attachment.name ?? attachment.url ?? "");
}

function findUrls(content) {
  return content.match(URL_PATTERN) ?? [];
}

function isAllowedGifUrl(value) {
  const cleanedValue = value.replace(/[.,!?;:)\]}]+$/g, "");
  const normalizedValue = cleanedValue.replace(/^htps:\/\//i, "https://");
  const urlValue = /^www\./i.test(normalizedValue) ? `https://${normalizedValue}` : normalizedValue;
  let url;
  try {
    url = new URL(urlValue.includes("://") ? urlValue : `https://${urlValue}`);
  } catch {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  const isGifProvider = hostname === "tenor.com"
    || hostname.endsWith(".tenor.com")
    || hostname === "giphy.com"
    || hostname.endsWith(".giphy.com");
  return isGifProvider || /\.gif$/i.test(url.pathname);
}

function hasForbiddenLink(content) {
  return findUrls(content).some((url) => !isAllowedGifUrl(url));
}

async function applyTimeout(member, duration, reason, context) {
  const botMember = member.guild.members.me;
  if (!botMember?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    console.warn(`Timeout ignoré pour ${member.id} (${context}) : le bot n'a pas la permission « Modérer les membres ».`);
    return false;
  }
  if (!member.moderatable) {
    console.warn(`Timeout ignoré pour ${member.id} (${context}) : le rôle du membre est égal ou supérieur à celui du bot, ou le membre est protégé.`);
    return false;
  }

  try {
    await member.timeout(duration, reason);
    return true;
  } catch (error) {
    if (error.code === 50013) {
      console.warn(`Timeout refusé par Discord pour ${member.id} (${context}) : vérifie la permission « Modérer les membres » et la hiérarchie des rôles.`);
      return false;
    }
    console.error(`Impossible de mettre ${member.id} en timeout (${context}):`, error);
    return false;
  }
}

async function sendSecurityLog(guild, config, content) {
  if (!config.securityLogChannelId) return;

  const channel = await guild.channels.fetch(config.securityLogChannelId);
  if (!channel?.isTextBased() || channel.isDMBased()) {
    throw new Error(`Salon de logs de sécurité introuvable ou non textuel : ${config.securityLogChannelId}`);
  }
  await channel.send({ content, allowedMentions: { parse: [] } });
}

function trackMessage(message, config) {
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  if (now - lastMessageHistoryCleanup > 60_000) {
    for (const [historyKey, entries] of messageHistory) {
      const recentEntries = entries.filter(
        (entry) => now - entry.timestamp <= config.spamWindowSeconds * 1000,
      );
      if (recentEntries.length) messageHistory.set(historyKey, recentEntries);
      else messageHistory.delete(historyKey);
    }
    lastMessageHistoryCleanup = now;
  }

  const history = (messageHistory.get(key) ?? []).filter(
    (entry) => now - entry.timestamp <= config.spamWindowSeconds * 1000,
  );
  history.push({ timestamp: now, content: message.content.trim().toLowerCase() });
  messageHistory.set(key, history);

  const identicalCount = history.filter((entry) => entry.content === message.content.trim().toLowerCase()).length;
  if (history.length >= config.spamMessageLimit || identicalCount >= 3) return "spam";

  const mentionCount = message.mentions.users.size + message.mentions.roles.size;
  if (message.mentions.everyone || mentionCount >= config.mentionLimit) return "mentions";
  return null;
}

function clearLockdownTimer(guildId) {
  const timer = lockdownTimers.get(guildId);
  if (timer) clearTimeout(timer);
  lockdownTimers.delete(guildId);
}

function scheduleLockdownRestore(guild, config, retryDelay = null) {
  const guildId = guild.id;
  clearLockdownTimer(guildId);
  const state = lockdowns[guildId];
  if (!state) return;

  const delay = retryDelay ?? Math.max(0, state.expiresAt - Date.now());
  const timer = setTimeout(() => {
    if (retryDelay === null && state.expiresAt > Date.now()) {
      scheduleLockdownRestore(guild, config);
      return;
    }
    restoreRaidLockdown(guild, config).catch((error) => {
      console.error(`Impossible de restaurer le niveau de vérification du serveur ${guildId}:`, error);
      scheduleLockdownRestore(guild, config, 60_000);
    });
  }, Math.min(delay, 2_147_000_000));
  timer.unref();
  lockdownTimers.set(guildId, timer);
}

async function activateRaidLockdown(guild, config, reason = "Détection d'un pic d'arrivées.") {
  const currentState = lockdowns[guild.id];
  const originalVerificationLevel = currentState?.originalVerificationLevel ?? guild.verificationLevel;
  const expiresAt = Date.now() + config.raidLockdownMinutes * 60_000;

  lockdowns[guild.id] = {
    originalVerificationLevel,
    expiresAt,
    reason,
  };
  saveLockdowns();
  try {
    if (guild.verificationLevel !== GuildVerificationLevel.High) {
      await guild.edit({
        verificationLevel: GuildVerificationLevel.High,
        reason: `Mode anti-raid activé : ${reason}`.slice(0, 512),
      });
    }
  } catch (error) {
    delete lockdowns[guild.id];
    saveLockdowns();
    throw error;
  }
  scheduleLockdownRestore(guild, config);

  try {
    await sendSecurityLog(
      guild,
      config,
      `🔒 **Mode anti-raid activé** — vérification Discord renforcée pour ${config.raidLockdownMinutes} minutes. Le niveau précédent sera restauré automatiquement.`,
    );
  } catch (error) {
    console.error(`Impossible de journaliser l'activation anti-raid du serveur ${guild.id}:`, error);
  }
  return lockdowns[guild.id];
}

async function restoreRaidLockdown(guildOrId, config) {
  const guildId = typeof guildOrId === "string" ? guildOrId : guildOrId.id;
  const state = lockdowns[guildId];
  if (!state) return false;

  if (typeof guildOrId === "string") {
    throw new Error("restoreRaidLockdown requiert un objet serveur Discord chargé.");
  }
  const guild = guildOrId;
  if (guild.verificationLevel === GuildVerificationLevel.High) {
    await guild.edit({
      verificationLevel: state.originalVerificationLevel,
      reason: "Fin du mode anti-raid temporaire.",
    });
  }

  delete lockdowns[guildId];
  saveLockdowns();
  clearLockdownTimer(guildId);
  try {
    await sendSecurityLog(guild, config, "🔓 **Mode anti-raid terminé** — le niveau de vérification a été restauré.");
  } catch (error) {
    console.error(`Impossible de journaliser la fin anti-raid du serveur ${guildId}:`, error);
  }
  return true;
}

async function restoreRaidLockdowns(client, config) {
  for (const guildId of Object.keys(lockdowns)) {
    try {
      const guild = await client.guilds.fetch(guildId);
      if (lockdowns[guildId].expiresAt <= Date.now()) {
        await restoreRaidLockdown(guild, config);
      } else {
        scheduleLockdownRestore(guild, config);
      }
    } catch (error) {
      console.error(`Impossible de reprendre le mode anti-raid du serveur ${guildId}:`, error);
      const guild = client.guilds.cache.get(guildId);
      if (guild) scheduleLockdownRestore(guild, config, 60_000);
    }
  }
}

async function moderateMessage(message, config) {
  if (!message.guild || message.author.bot || !message.member) return;

  const forbiddenAttachments = message.attachments.filter((attachment) => !isAllowedMediaAttachment(attachment));
  if (forbiddenAttachments.size > 0) {
    const containsExecutable = forbiddenAttachments.some((attachment) =>
      EXECUTABLE_PATTERN.test(attachment.name ?? "") || EXECUTABLE_PATTERN.test(attachment.url),
    );
    let messageDeleted = false;
    try {
      await message.delete();
      messageDeleted = true;
    } catch (error) {
      console.error(`Impossible de supprimer le message ${message.id} contenant un fichier non autorisé:`, error);
    }
    const timeoutApplied = containsExecutable
      ? await applyTimeout(message.member, 60 * 60 * 1000, "Envoi d'un fichier .exe interdit.", "envoi d'un fichier .exe")
      : false;
    try {
      const names = forbiddenAttachments.map((attachment) => attachment.name ?? "fichier sans nom").join(", ");
      const deletion = messageDeleted ? "Message supprimé." : "La suppression du message a échoué.";
      const sanction = containsExecutable
        ? timeoutApplied
          ? " Un timeout d'une heure a été appliqué."
          : " Le timeout n'a pas pu être appliqué."
        : "";
      await sendSecurityLog(
        message.guild,
        config,
        `📎 **Fichier bloqué** — ${message.author.tag} (\`${message.author.id}\`) a envoyé un fichier autre qu'une image ou une vidéo dans <#${message.channelId}> : ${names}. ${deletion}${sanction}`,
      );
    } catch (error) {
      console.error(`Impossible de journaliser le fichier bloqué de ${message.author.id}:`, error);
    }
    return;
  }

  if (isProtected(message.member, config.adminIds)) return;

  const hasExecutableAttachment = message.attachments.some((attachment) =>
    EXECUTABLE_PATTERN.test(attachment.name ?? "") || EXECUTABLE_PATTERN.test(attachment.url),
  );
  const invitationOrExecutable = INVITE_PATTERN.test(message.content)
    || EXECUTABLE_PATTERN.test(message.content)
    || hasExecutableAttachment;
  const forbiddenLink = hasForbiddenLink(message.content);
  const behaviorViolation = trackMessage(message, config);
  if (!invitationOrExecutable && !forbiddenLink && !behaviorViolation) return;

  const reason = invitationOrExecutable
    ? "Lien d'invitation Discord ou fichier .exe détecté."
    : behaviorViolation === "mentions"
      ? "Spam de mentions détecté."
      : behaviorViolation === "spam"
        ? "Flood ou répétition de messages détecté."
        : "Lien externe interdit (seuls les liens GIF sont autorisés).";

  let messageDeleted = false;
  try {
    await message.delete();
    messageDeleted = true;
  } catch (error) {
    console.error(`Impossible de supprimer le message ${message.id}:`, error);
  }

  const timeoutDuration = invitationOrExecutable || behaviorViolation === "mentions"
    ? 60 * 60 * 1000
    : behaviorViolation === "spam"
      ? 10 * 60 * 1000
      : null;
  const timeoutApplied = timeoutDuration
    ? await applyTimeout(message.member, timeoutDuration, reason, "protection automatique")
    : false;

  try {
    await sendSecurityLog(
      message.guild,
      config,
      `🛡️ **Protection automatique** — ${message.author.tag} (\`${message.author.id}\`) dans <#${message.channelId}> : ${messageDeleted ? "message supprimé" : "suppression du message échouée"}. Motif : ${reason}${timeoutDuration ? timeoutApplied ? " Timeout appliqué." : " Timeout non appliqué." : ""}`,
    );
  } catch (error) {
    console.error(`Impossible d'envoyer le journal de sécurité pour ${message.author.id}:`, error);
  }
}

async function detectJoinRaid(member, config) {
  const guildId = member.guild.id;
  const now = Date.now();
  const windowMs = config.raidWindowSeconds * 1000;
  const recentJoins = (joinHistory.get(guildId) ?? []).filter((timestamp) => now - timestamp <= windowMs);
  recentJoins.push(now);
  joinHistory.set(guildId, recentJoins);

  if (recentJoins.length < config.raidJoinLimit) return;
  const lastAlertAt = lastRaidAlerts.get(guildId) ?? 0;
  if (now - lastAlertAt < windowMs) return;
  lastRaidAlerts.set(guildId, now);

  const alert = `🚨 **Alerte anti-raid** — ${recentJoins.length} arrivées en ${config.raidWindowSeconds} secondes.`;
  if (config.raidAutoLockdown) {
    try {
      await activateRaidLockdown(member.guild, config, alert);
    } catch (error) {
      console.error(`Impossible d'activer le mode anti-raid du serveur ${guildId}:`, error);
      try {
        await sendSecurityLog(member.guild, config, `${alert} Le verrouillage automatique a échoué.`);
      } catch (logError) {
        console.error(`Impossible de journaliser l'alerte anti-raid du serveur ${guildId}:`, logError);
      }
    }
  } else {
    try {
      await sendSecurityLog(member.guild, config, `${alert} Le verrouillage automatique est désactivé.`);
    } catch (error) {
      console.error(`Impossible d'envoyer l'alerte anti-raid du serveur ${guildId}:`, error);
    }
  }
}

async function assignSupportTagRole(member, config) {
  if (!config.tagText || !config.supportTagRoleId || member.user.bot) return;

  const role = member.guild.roles.cache.get(config.supportTagRoleId);
  if (!role) {
    console.error(`Rôle Soutien tag introuvable : ${config.supportTagRoleId}`);
    return;
  }

  const hasTag = member.displayName.toLocaleLowerCase().includes(config.tagText.toLocaleLowerCase());

  if (hasTag) {
    if (member.roles.cache.has(role.id)) return;
    try {
      await member.roles.add(role, "Tag configuré détecté dans le pseudo ou le surnom.");
    } catch (error) {
      console.error(`Impossible d'attribuer le rôle ${role.id} à ${member.id}:`, error);
    }
    return;
  }

  if (!member.roles.cache.has(role.id)) return;

  try {
    await member.roles.remove(role, "Le tag configuré n'est plus présent dans le pseudo ou le surnom.");
  } catch (error) {
    console.error(`Impossible de retirer le rôle ${role.id} à ${member.id}:`, error);
  }
}

async function assignGambleTagRole(member, config) {
  const primaryGuild = member.user.primaryGuild;
  if (
    primaryGuild?.identityGuildId !== member.guild.id
    || primaryGuild.identityEnabled !== true
  ) return;

  const rewardRole = member.guild.roles.cache.get(config.gambleRewardRoleId);
  if (!rewardRole) {
    console.error(`Rôle à attribuer aux membres avec le tag introuvable : ${config.gambleRewardRoleId}`);
    return;
  }
  if (member.roles.cache.has(rewardRole.id)) return;

  try {
    await member.roles.add(rewardRole, "Attribution automatique du rôle aux membres avec le tag du serveur.");
  } catch (error) {
    console.error(`Impossible d'attribuer le rôle ${rewardRole.id} au membre ${member.id}:`, error);
  }
}

async function assignJoinRoles(member, config) {
  const username = member.user.username;
  const usernameLength = [...username].length;
  const { threeLetter, threeCharacter, fourLetter, fourCharacter } = config.usernameRoleIds;
  const managedUsernameRoleIds = new Set([threeLetter, threeCharacter, fourLetter, fourCharacter]);
  const desiredUsernameRoleIds = new Set();

  if (usernameLength === 3) {
    desiredUsernameRoleIds.add(/^\p{L}{3}$/u.test(username) ? threeLetter : threeCharacter);
  } else if (usernameLength === 4) {
    desiredUsernameRoleIds.add(/^\p{L}{4}$/u.test(username) ? fourLetter : fourCharacter);
  }

  const accountCreatedAt = member.user.createdTimestamp;
  const roleIdsToAdd = new Set([...desiredUsernameRoleIds, config.arsalRoleId]);
  if (accountCreatedAt >= Date.UTC(2015, 0, 1) && accountCreatedAt < Date.UTC(2018, 0, 1)) {
    roleIdsToAdd.add(config.legacyAccountRoleId);
  }

  for (const roleId of managedUsernameRoleIds) {
    if (desiredUsernameRoleIds.has(roleId) || !member.roles.cache.has(roleId)) continue;
    const role = member.guild.roles.cache.get(roleId);
    if (!role) {
      console.error(`Rôle automatique introuvable sur le serveur ${member.guild.id} : ${roleId}`);
      continue;
    }
    try {
      await member.roles.remove(role, "Synchronisation du rôle selon la longueur et le type de caractères du nom d'utilisateur.");
    } catch (error) {
      console.error(`Impossible de retirer le rôle automatique ${roleId} au membre ${member.id}:`, error);
    }
  }

  for (const roleId of roleIdsToAdd) {
    if (member.roles.cache.has(roleId)) continue;
    const role = member.guild.roles.cache.get(roleId);
    if (!role) {
      console.error(`Rôle d'arrivée introuvable sur le serveur ${member.guild.id} : ${roleId}`);
      continue;
    }
    try {
      await member.roles.add(role, "Attribution automatique d'un rôle général ou selon le nom d'utilisateur et l'ancienneté du compte.");
    } catch (error) {
      console.error(`Impossible d'attribuer le rôle ${roleId} au membre ${member.id}:`, error);
    }
  }
}

async function renameBooster(member, config) {
  if (!config.renameBoosters || !member.premiumSince || member.nickname === ".") return;
  if (config.adminIds.has(member.id) || member.id === member.guild.ownerId) return;

  const botMember = member.guild.members.me;
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageNicknames)) {
    console.warn(`Renommage des boosters ignoré sur ${member.guild.id} : le bot n'a pas la permission « Gérer les pseudos ».`);
    return;
  }
  if (!member.manageable) {
    console.warn(`Renommage du booster ${member.id} ignoré : son rôle est égal ou supérieur à celui du bot.`);
    return;
  }

  try {
    await member.setNickname(".", "Renommage du membre qui booste le serveur.");
  } catch (error) {
    if (error.code === 50013) {
      console.warn(`Discord refuse le renommage du booster ${member.id}; vérifie les permissions et la hiérarchie des rôles.`);
      return;
    }
    console.error(`Impossible de renommer le membre booster ${member.id}:`, error);
  }
}

module.exports = {
  activateRaidLockdown,
  assignGambleTagRole,
  assignJoinRoles,
  assignSupportTagRole,
  detectJoinRaid,
  findUrls,
  getRaidLockdown: (guildId) => lockdowns[guildId] ?? null,
  hasForbiddenLink,
  isAllowedGifUrl,
  isAllowedMediaAttachment,
  moderateMessage,
  renameBooster,
  restoreRaidLockdown,
  restoreRaidLockdowns,
};
