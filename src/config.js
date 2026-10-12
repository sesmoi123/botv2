require("dotenv").config();

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    if (name === "DISCORD_TOKEN") {
      throw new Error("DISCORD_TOKEN est vide dans .env. Génère un nouveau token dans le portail développeur Discord puis colle-le après DISCORD_TOKEN=.");
    }
    throw new Error(`La variable ${name} est obligatoire. Consulte .env.example.`);
  }
  return value;
}

const tagText = process.env.TAG_TEXT?.trim() ?? "";
const supportTagRoleId = process.env.SUPPORT_TAG_ROLE_ID?.trim() ?? "";

if (Boolean(tagText) !== Boolean(supportTagRoleId)) {
  throw new Error("TAG_TEXT et SUPPORT_TAG_ROLE_ID doivent être renseignés ensemble.");
}

const adminIds = (process.env.ADMIN_IDS ?? "1226440339615907860,293002324987871232")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

if (adminIds.length === 0) {
  throw new Error("ADMIN_IDS doit contenir au moins un identifiant Discord.");
}

const positiveInteger = (name, defaultValue) => {
  const value = Number.parseInt(process.env[name] ?? String(defaultValue), 10);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} doit être un entier supérieur ou égal à 1.`);
  }
  return value;
};

const discordSnowflake = (name, defaultValue) => {
  const id = process.env[name]?.trim() || defaultValue;
  if (!/^\d{17,20}$/.test(id)) {
    throw new Error(`${name} doit contenir un identifiant Discord valide.`);
  }
  return id;
};

const usernameRoleIds = {
  threeLetter: discordSnowflake("THREE_LETTER_ROLE_ID", "1558868645260566620"),
  threeCharacter: discordSnowflake("THREE_CHARACTER_ROLE_ID", "1558868685219823726"),
  fourLetter: discordSnowflake("FOUR_LETTER_ROLE_ID", "1558868561336991845"),
  fourCharacter: discordSnowflake("FOUR_CHARACTER_ROLE_ID", "1558868540063486083"),
};
if (new Set(Object.values(usernameRoleIds)).size !== Object.values(usernameRoleIds).length) {
  throw new Error("Les quatre rôles de longueur du nom d'utilisateur doivent avoir des IDs distincts.");
}

const ticketStaffRoleIds = (process.env.TICKET_STAFF_ROLE_IDS ?? "1558871041936334929,1558867051869773986")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
if (ticketStaffRoleIds.some((id) => !/^\d{17,20}$/.test(id))) {
  throw new Error("TICKET_STAFF_ROLE_IDS doit contenir des identifiants de rôle Discord valides.");
}

const gambleRewardRoleId = discordSnowflake("GAMBLE_REWARD_ROLE_ID", "1558930693927735388");

module.exports = {
  token: required("DISCORD_TOKEN"),
  clientId: required("CLIENT_ID"),
  guildId: required("GUILD_ID"),
  adminIds: new Set(adminIds),
  securityLogChannelId: discordSnowflake("SECURITY_LOG_CHANNEL_ID", "1559233587759415338"),
  spamMessageLimit: positiveInteger("SPAM_MESSAGE_LIMIT", 6),
  spamWindowSeconds: positiveInteger("SPAM_WINDOW_SECONDS", 8),
  mentionLimit: positiveInteger("MENTION_LIMIT", 5),
  raidJoinLimit: positiveInteger("RAID_JOIN_LIMIT", 8),
  raidWindowSeconds: positiveInteger("RAID_WINDOW_SECONDS", 30),
  raidLockdownMinutes: positiveInteger("RAID_LOCKDOWN_MINUTES", 10),
  raidAutoLockdown: (process.env.RAID_AUTO_LOCKDOWN ?? "true").toLowerCase() === "true",
  tagText,
  supportTagRoleId,
  ticketCategoryId: process.env.TICKET_CATEGORY_ID?.trim() || "1559108153386336277",
  ticketPanelChannelId: discordSnowflake("TICKET_PANEL_CHANNEL_ID", "1559103249091657798"),
  gamblePanelChannelId: discordSnowflake("GAMBLE_PANEL_CHANNEL_ID", "1559171077005901864"),
  roulettePanelChannelId: discordSnowflake("ROULETTE_PANEL_CHANNEL_ID", "1559178697800417391"),
  numberGuessPanelChannelId: discordSnowflake("NUMBER_GUESS_PANEL_CHANNEL_ID", "1559244249667604560"),
  buyCategoryId: discordSnowflake("BUY_CATEGORY_ID", "1559228398633619527"),
  shopPanelChannelId: discordSnowflake("SHOP_PANEL_CHANNEL_ID", "1559227085866934415"),
  ticketSupportRoleId: process.env.TICKET_SUPPORT_ROLE_ID?.trim() || null,
  ticketStaffRoleIds,
  renameBoosters: (process.env.RENAME_BOOSTERS ?? process.env.RENAME_BOOSTING_BOTS ?? "true").toLowerCase() === "true",
  usernameRoleIds,
  legacyAccountRoleId: process.env.LEGACY_ACCOUNT_ROLE_ID?.trim() || "1558867588652605561",
  arsalRoleId: discordSnowflake("ARSAL_ROLE_ID", "1559097678158102540"),
  gambleRewardRoleId,
  giveawayResultsChannelId: discordSnowflake("GIVEAWAY_RESULTS_CHANNEL_ID", "1558905774741266502"),
};
