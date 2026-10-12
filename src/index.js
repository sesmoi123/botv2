const {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
} = require("discord.js");
const config = require("./config");
const commands = require("./commands");
const { logToChannel } = require("./logging");
const {
  cancelGiveaway,
  finishGiveaway,
  handleGiveawayButton,
  rerollGiveaway,
  restoreGiveawayTimers,
  startGiveaway,
} = require("./giveaways");
const {
  activateRaidLockdown,
  assignGambleTagRole,
  assignJoinRoles,
  assignSupportTagRole,
  detectJoinRaid,
  getRaidLockdown,
  moderateMessage,
  renameBooster,
  restoreRaidLockdown,
  restoreRaidLockdowns,
} = require("./moderation");
const {
  GAMBLE_BUTTON_ID,
  GAMBLE_MODAL_ID,
  GAMBLE_CHOICE_PREFIX,
  addBalance,
  ensureGamblePanel,
  getUserBalance,
  handleGambleButton,
  handleGambleChoice,
  handleGambleModalSubmit,
  inventoryCommand,
} = require("./gambling");
const {
  ROULETTE_BUTTON_ID,
  ROULETTE_MODAL_PREFIX,
  ROULETTE_SELECT_ID,
  ensureRoulettePanel,
  handleRouletteBetType,
  handleRouletteButton,
  handleRouletteModalSubmit,
} = require("./roulette");
const {
  BUTTON_ID: NUMBER_GUESS_BUTTON_ID,
  MODAL_ID: NUMBER_GUESS_MODAL_ID,
  ensurePanel: ensureNumberGuessPanel,
  handleButton: handleNumberGuessButton,
  handleModalSubmit: handleNumberGuessModalSubmit,
} = require("./number-guess");
const {
  ensureShopPanel,
  handleDeletePieceButton,
  handleShopButton,
  handleShopSelect,
  handleShopModalSubmit,
  postDeletePiecePanel,
  DELETE_PIECE_BUTTON_ID,
  SHOP_BUTTON_ID,
  SHOP_SELECT_ID,
  SHOP_MODAL_PREFIX,
} = require("./shop");
const {
  closeTicket,
  createTicket,
  ensureTicketPanel,
  postTicketPanel,
  showTicketReasonModal,
  CREATE_TICKET_BUTTON,
  CLOSE_TICKET_BUTTON,
} = require("./tickets");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function isAuthorized(userId) {
  return config.adminIds.has(userId);
}

function hasStaffRole(interaction) {
  const roles = interaction.member?.roles;
  if (roles?.cache) {
    return config.ticketStaffRoleIds.some((roleId) => roles.cache.has(roleId));
  }
  if (Array.isArray(roles)) {
    return config.ticketStaffRoleIds.some((roleId) => roles.includes(roleId));
  }
  return false;
}

function hasRole(interaction, roleId) {
  const roles = interaction.member?.roles;
  if (roles?.cache) return roles.cache.has(roleId);
  if (Array.isArray(roles)) return roles.includes(roleId);
  return false;
}

function canUseCommands(interaction) {
  return isAuthorized(interaction.user.id) || hasStaffRole(interaction);
}

function canUseInventory(interaction) {
  return isAuthorized(interaction.user.id) || hasRole(interaction, config.arsalRoleId) || hasStaffRole(interaction);
}

const networkErrorCodes = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

function getErrorCode(error) {
  let current = error;
  while (current) {
    if (current.code !== undefined) return current.code;
    current = current.cause;
  }
  return undefined;
}

async function denyUnauthorized(interaction) {
  await interaction.reply({
    content: "Cette commande est réservée aux administrateurs autorisés du bot.",
    flags: MessageFlags.Ephemeral,
  });
}

async function handleAdminCommand(interaction, callback) {
  if (!canUseCommands(interaction)) {
    await denyUnauthorized(interaction);
    return;
  }
  await callback();
}

async function handleCommand(interaction) {
  const { commandName } = interaction;

  if (!interaction.member) {
    await interaction.reply({ content: "Les commandes sont disponibles uniquement sur le serveur.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (commandName === "inventory") {
    if (!canUseInventory(interaction)) {
      await interaction.reply({
        content: `Tu dois avoir le rôle <@&${config.arsalRoleId}> pour consulter ton inventaire.`,
        allowedMentions: { parse: [] },
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await inventoryCommand(interaction);
    return;
  }

  if (commandName === "check") {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "inventory") {
      if (!canUseInventory(interaction)) {
        await interaction.reply({
          content: `Tu dois avoir le rôle <@&${config.arsalRoleId}> pour consulter ton inventaire.`,
          allowedMentions: { parse: [] },
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await inventoryCommand(interaction);
      return;
    }
  }

  if (!canUseCommands(interaction)) {
    await interaction.reply({ content: `Seules les personnes disposant des rôles de support peuvent utiliser les commandes.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (commandName === "clear") {
    await handleAdminCommand(interaction, async () => {
      if (!interaction.channel?.isTextBased() || !interaction.channel.bulkDelete) {
        await interaction.reply({ content: "Cette commande doit être utilisée dans un salon textuel.", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const amount = interaction.options.getInteger("nombre", true);
      const deleted = await interaction.channel.bulkDelete(amount, true);
      await interaction.editReply({
        content: `${deleted.size} message(s) supprimé(s). Les messages datant de plus de 14 jours ne peuvent pas être supprimés en masse.`,
      });
    });
    return;
  }

  if (commandName === "giveaway") {
    await handleAdminCommand(interaction, async () => {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "start") {
        await startGiveaway(interaction, config);
        return;
      }
      const messageId = interaction.options.getString("message_id", true);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (subcommand === "cancel") {
        const cancelled = await cancelGiveaway(client, messageId);
        await interaction.editReply({
          content: cancelled ? "Giveaway annulé." : "Giveaway introuvable ou déjà terminé.",
        });
        return;
      }
      if (subcommand === "reroll") {
        const winners = await rerollGiveaway(client, messageId);
        await interaction.editReply({
          content: winners
            ? winners.length
              ? `Nouveau(x) gagnant(s) : ${winners.map((id) => `<@${id}>`).join(", ")}`
              : "Aucun autre participant disponible pour le tirage."
            : "Giveaway introuvable ou pas encore terminé.",
        });
        return;
      }
      const winners = await finishGiveaway(client, messageId);
      if (!winners) {
        await interaction.editReply({ content: "Giveaway introuvable ou déjà terminé." });
        return;
      }
      await interaction.editReply({ content: `Giveaway terminé. ${winners.length} gagnant(s) tiré(s).` });
    });
    return;
  }

  if (commandName === "protection") {
    await handleAdminCommand(interaction, async () => {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "lockdown" || subcommand === "unlock") {
        if (!interaction.guild) {
          await interaction.reply({ content: "Cette commande doit être utilisée sur le serveur.", flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (subcommand === "unlock") {
          const restored = await restoreRaidLockdown(interaction.guild, config);
          await interaction.editReply({
            content: restored ? "Mode anti-raid désactivé; le niveau précédent a été restauré." : "Aucun mode anti-raid temporaire n'est actif.",
          });
          return;
        }
        const state = await activateRaidLockdown(interaction.guild, config, `Activation manuelle par ${interaction.user.tag}`);
        await interaction.editReply({
          content: `Mode anti-raid activé jusqu'à <t:${Math.floor(state.expiresAt / 1000)}:R>.`,
        });
        return;
      }

      const state = getRaidLockdown(interaction.guildId);
      await interaction.reply({
        content: [
          "**Protections actives**",
          `• Liens externes (sauf GIF), invitations Discord et fichiers .exe : suppression; timeout 1 h pour les invitations/.exe`,
          `• Flood : ${config.spamMessageLimit} messages en ${config.spamWindowSeconds} s (timeout 10 min)`,
          `• Spam de mentions : ${config.mentionLimit} mentions (timeout 1 h)`,
          `• Anti-raid : ${config.raidJoinLimit} arrivées en ${config.raidWindowSeconds} s`,
          `• Verrouillage automatique : ${config.raidAutoLockdown ? `oui, ${config.raidLockdownMinutes} min en niveau High` : "non"}`,
          "• Arrivées suspectes : vérification renforcée temporaire, sans bannissement automatique",
          `• État : ${state ? `verrouillé jusqu'à <t:${Math.floor(state.expiresAt / 1000)}:R>` : "normal"}`,
          `• Salon de journalisation : ${config.securityLogChannelId ? `<#${config.securityLogChannelId}>` : "non configuré"}`,
        ].join("\n"),
        flags: MessageFlags.Ephemeral,
      });
    });
    return;
  }

  if (commandName === "gift") {
    if (!(isAuthorized(interaction.user.id) || hasRole(interaction, config.arsalRoleId) || hasStaffRole(interaction))) {
      await interaction.reply({
        content: `Tu dois avoir le rôle <@&${config.arsalRoleId}> pour donner des pièces.`,
        allowedMentions: { parse: [] },
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const target = interaction.options.getUser("membre", true);
    const amount = interaction.options.getInteger("pieces", true);

    if (target.id === interaction.user.id) {
      await interaction.editReply({ content: "Tu ne peux pas te donner des pièces à toi-même." });
      return;
    }

    const senderBalance = getUserBalance(interaction.user.id);
    if (amount > senderBalance) {
      await interaction.editReply({ content: `Tu n'as pas assez de pièces pour donner ${amount}. Ton solde est de ${senderBalance}.` });
      return;
    }

    updateBalance(interaction.user.id, -amount);
    const targetBalance = addBalance(target.id, amount);
    await interaction.editReply({
      content: `Tu as donné ${amount} pièce(s) à ${target.tag}. Nouveau solde de ${target.tag} : ${targetBalance}.`,
    });
    return;
  }

  if (commandName === "givepiece") {
    await handleAdminCommand(interaction, async () => {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const target = interaction.options.getUser("membre", true);
      const amount = interaction.options.getInteger("pieces", true);
      const previousBalance = getUserBalance(target.id);
      const nextBalance = addBalance(target.id, amount);
      await interaction.editReply({
        content: `${target.tag} reçoit ${amount} pièce(s). Ancien solde : ${previousBalance}. Nouveau solde : ${nextBalance}.`,
      });
    });
    return;
  }

  if (commandName === "deletepiece") {
    await handleAdminCommand(interaction, async () => {
      const amount = interaction.options.getInteger("pieces", true);
      const uses = interaction.options.getInteger("utilisations", true);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const msg = await postDeletePiecePanel(interaction, amount, uses);
        await interaction.editReply({ content: `Bouton créé dans ${interaction.channel} : ${msg.url}` });
      } catch (error) {
        console.error("Impossible de publier le bouton de suppression de pièces :", error);
        await interaction.editReply({ content: "Échec de la création du bouton de suppression de pièces." });
      }
    });
    return;
  }

  if (commandName === "createbuypanel") {
    await handleAdminCommand(interaction, async () => {
      const channel = interaction.options.getChannel("salon", true);
      const uses = interaction.options.getInteger("utilisations");
      if (!channel?.isTextBased()) {
        await interaction.reply({ content: "Choisis un salon textuel du serveur.", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const msg = await postShopPanel(channel, uses ?? null);
        await interaction.editReply({ content: `Panneau d'achat publié : ${msg.url}` });
      } catch (error) {
        console.error("Impossible de publier le panneau d'achat :", error);
        await interaction.editReply({ content: "Échec de la publication du panneau d'achat." });
      }
    });
    return;
  }

  if (commandName === "ticket") {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "panel") {
      await handleAdminCommand(interaction, async () => {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await postTicketPanel(interaction);
      });
    } else {
      await closeTicket(interaction, config);
    }
    return;
  }

  if (commandName === "ban" || commandName === "kick") {
    await handleAdminCommand(interaction, async () => {
      const target = interaction.options.getUser("membre", true);
      const reason = interaction.options.getString("raison") ?? `Action effectuée par ${interaction.user.tag}`;
      if (config.adminIds.has(target.id) || target.id === interaction.guild.ownerId) {
        await interaction.reply({ content: "Tu ne peux pas bannir ou expulser un administrateur protégé.", flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (commandName === "ban") {
        await interaction.guild.members.ban(target.id, { reason });
        await interaction.editReply({ content: `${target.tag} a été banni.` });
      } else {
        const member = await interaction.guild.members.fetch(target.id);
        await member.kick(reason);
        await interaction.editReply({ content: `${target.tag} a été expulsé.` });
      }
    });
  }
}

async function handleInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    await handleCommand(interaction);
    return;
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === GAMBLE_MODAL_ID) {
      await handleGambleModalSubmit(interaction);
      return;
    }
    if (interaction.customId === NUMBER_GUESS_MODAL_ID) {
      await handleNumberGuessModalSubmit(interaction, config);
      return;
    }
    if (interaction.customId.startsWith(ROULETTE_MODAL_PREFIX)) {
      await handleRouletteModalSubmit(interaction, config);
      return;
    }
    if (interaction.customId.startsWith(SHOP_MODAL_PREFIX)) {
      await handleShopModalSubmit(interaction, config);
      return;
    }
    if (interaction.customId === "ticket:reason") {
      await createTicket(interaction, config);
    }
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === ROULETTE_SELECT_ID) {
    await handleRouletteBetType(interaction, config);
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === SHOP_SELECT_ID) {
  await handleShopSelect(interaction, config);
  return;
  }

  if (!interaction.isButton()) return;
  if (interaction.customId.startsWith("giveaway:join:")) {
    await handleGiveawayButton(interaction);
    return;
  }
  if (interaction.customId === GAMBLE_BUTTON_ID) {
    await handleGambleButton(interaction);
    return;
  }
  if (interaction.customId === NUMBER_GUESS_BUTTON_ID) {
    await handleNumberGuessButton(interaction, config);
    return;
  }
  if (interaction.customId === ROULETTE_BUTTON_ID) {
    await handleRouletteButton(interaction, config);
    return;
  }
  if (interaction.customId === SHOP_BUTTON_ID) {
    await handleShopButton(interaction, config);
    return;
  }
  if (interaction.customId === DELETE_PIECE_BUTTON_ID) {
    await handleDeletePieceButton(interaction);
    return;
  }
  if (interaction.customId.startsWith(GAMBLE_CHOICE_PREFIX)) {
    await handleGambleChoice(interaction);
    return;
  }
  if (interaction.customId === CREATE_TICKET_BUTTON) {
    await showTicketReasonModal(interaction);
    return;
  }
  if (interaction.customId === CLOSE_TICKET_BUTTON) {
    await closeTicket(interaction, config);
  }
}

async function synchronizeExistingMemberRoles(guild) {
  const members = await guild.members.fetch();
  console.log(`Vérification des rôles automatiques pour ${members.size} membre(s) du serveur ${guild.name}.`);
  for (const member of members.values()) {
    await assignJoinRoles(member, config);
    await assignGambleTagRole(member, config);
    await renameBooster(member, config);
  }
  console.log(`Vérification des rôles et des pseudos boosters terminée pour le serveur ${guild.name}.`);
}

async function sendWelcomeMessage(member) {
  if (member.user.bot) return;
  const welcomeText = [
    `Salut ${member.displayName} ! 👋`,
    "",
    "Tu cherches peut-être un serveur avec des giveaways, plein de photos de profil et de bannières à découvrir, et des gens sympas avec qui discuter ? Tu peux trouver tout ça ici !",
    "",
    `Rejoins-nous : https://discord.gg/RbR9aB2dAs`,
  ].join("\n");

  try {
    await member.send({ content: welcomeText, allowedMentions: { parse: [] } });
  } catch (error) {
    const errorCode = error.code ?? error.cause?.code;
    if (errorCode === 50007) {
      console.warn(`Impossible d'envoyer le message de bienvenue en DM à ${member.id}; ses messages privés sont fermés.`);
      return;
    }
    console.warn(`Impossible d'envoyer le message de bienvenue en DM à ${member.id}.`, error);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  try {
    const rest = new REST({ version: "10" }).setToken(config.token);
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
    console.log(`Connecté en tant que ${readyClient.user.tag}. Commandes synchronisées.`);
    void logToChannel(readyClient, config, "Bot connecté", `${readyClient.user.tag} est en ligne et les commandes sont synchronisées.`);
    try {
      const guild = await readyClient.guilds.fetch(config.guildId);
      await synchronizeExistingMemberRoles(guild);
    } catch (error) {
      console.error(`Impossible de vérifier les rôles des membres déjà présents sur le serveur ${config.guildId}:`, error);
    }
    try {
      const panelCreated = await ensureTicketPanel(readyClient, config);
      console.log(panelCreated
        ? `Panneau de création de tickets publié dans le salon ${config.ticketPanelChannelId}.`
        : `Panneau de création de tickets déjà présent dans le salon ${config.ticketPanelChannelId}.`);
    } catch (error) {
      console.error(`Impossible de vérifier ou publier le panneau de tickets dans ${config.ticketPanelChannelId}:`, error);
    }
    try {
      const { created, removed } = await ensureGamblePanel(readyClient, config);
      console.log(created
        ? `Panneau de gamble publié dans le salon ${config.gamblePanelChannelId}.`
        : `Panneau de gamble déjà présent dans le salon ${config.gamblePanelChannelId}.`);
      if (removed > 0) {
        console.log(`${removed} ancien(s) panneau(x) de gamble supprimé(s) du salon des tickets ${config.ticketPanelChannelId}.`);
      }
    } catch (error) {
      console.error(`Impossible de vérifier ou publier le panneau de gamble dans ${config.gamblePanelChannelId}:`, error);
    }
    try {
      const created = await ensureRoulettePanel(readyClient, config);
      console.log(created
        ? `Panneau de roulette publié dans le salon ${config.roulettePanelChannelId}.`
        : `Panneau de roulette déjà présent dans le salon ${config.roulettePanelChannelId}.`);
    } catch (error) {
      console.error(`Impossible de vérifier ou publier le panneau de roulette dans ${config.roulettePanelChannelId}:`, error);
    }
    try {
      const created = await ensureNumberGuessPanel(readyClient, config);
      console.log(created
        ? `Panneau de devinette publié dans le salon ${config.numberGuessPanelChannelId}.`
        : `Panneau de devinette déjà présent dans le salon ${config.numberGuessPanelChannelId}.`);
    } catch (error) {
      console.error(`Impossible de vérifier ou publier le panneau de devinette dans ${config.numberGuessPanelChannelId}:`, error);
    }
    try {
      const created = await ensureShopPanel(readyClient, config);
      console.log(created
        ? `Panneau d'achat publié dans le salon ${config.shopPanelChannelId}.`
        : `Panneau d'achat déjà présent dans le salon ${config.shopPanelChannelId}.`);
    } catch (error) {
      console.error(`Impossible de vérifier ou publier le panneau d'achat dans ${config.shopPanelChannelId}:`, error);
    }
    await restoreGiveawayTimers(readyClient, config);
    await restoreRaidLockdowns(readyClient, config);

    if (!config.tagText) {
      console.warn("Attribution du rôle Soutien tag désactivée : configure TAG_TEXT et SUPPORT_TAG_ROLE_ID dans .env.");
    }
    if (!readyClient.user.username.toLowerCase().includes("emilie")) {
      console.log("Pour appeler le bot « Emilie », change son nom et son avatar dans le portail développeur Discord.");
    }
  } catch (error) {
    console.error("Erreur lors de l'initialisation du bot ou de la synchronisation des commandes :", error);
    process.exitCode = 1;
    await readyClient.destroy();
  }
});

client.on(Events.MessageCreate, (message) => {
  moderateMessage(message, config).catch((error) => {
    console.error(`Erreur de modération du message ${message.id}:`, error);
  });
});

client.on(Events.GuildMemberAdd, (member) => {
  if (member.guild.id !== config.guildId) return;
  void logToChannel(client, config, "Arrivée", `${member.user.tag} (\`${member.id}\`) a rejoint le serveur.`);
});

client.on(Events.GuildMemberRemove, (member) => {
  if (member.guild.id !== config.guildId) return;
  void logToChannel(client, config, "Départ", `${member.user.tag} (\`${member.id}\`) a quitté le serveur.`);
});

client.on(Events.MessageDelete, (message) => {
  if (message.guild?.id !== config.guildId || message.author?.bot) return;
  void logToChannel(
    client,
    config,
    "Message supprimé",
    `Auteur : ${message.author?.tag ?? "inconnu"} (\`${message.author?.id ?? "inconnu"}\`), salon : <#${message.channelId}>, message : \`${message.id}\`.`,
  );
});

client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
  if (newMessage.guild?.id !== config.guildId || newMessage.author?.bot || oldMessage.content === newMessage.content) return;
  void logToChannel(
    client,
    config,
    "Message modifié",
    `Auteur : ${newMessage.author?.tag ?? "inconnu"} (\`${newMessage.author?.id ?? "inconnu"}\`), salon : <#${newMessage.channelId}>, message : \`${newMessage.id}\`.`,
  );
});

client.on(Events.ChannelCreate, (channel) => {
  if (channel.guildId !== config.guildId) return;
  void logToChannel(client, config, "Salon créé", `${channel} (\`${channel.id}\`).`);
});

client.on(Events.ChannelDelete, (channel) => {
  if (channel.guildId !== config.guildId) return;
  void logToChannel(client, config, "Salon supprimé", `#${channel.name} (\`${channel.id}\`).`);
});

client.on(Events.GuildBanAdd, (ban) => {
  if (ban.guild.id !== config.guildId) return;
  void logToChannel(client, config, "Membre banni", `${ban.user.tag} (\`${ban.user.id}\`).`);
});

client.on(Events.GuildBanRemove, (ban) => {
  if (ban.guild.id !== config.guildId) return;
  void logToChannel(client, config, "Bannissement retiré", `${ban.user.tag} (\`${ban.user.id}\`).`);
});

client.on(Events.GuildMemberAdd, (member) => {
  sendWelcomeMessage(member).catch((error) => {
    console.error(`Erreur lors de l'envoi du message de bienvenue à ${member.id}:`, error);
  });
  detectJoinRaid(member, config).catch((error) => {
    console.error(`Erreur de détection anti-raid pour ${member.id}:`, error);
  });
  assignJoinRoles(member, config).catch((error) => {
    console.error(`Erreur d'attribution des rôles d'arrivée à ${member.id}:`, error);
  });
  assignGambleTagRole(member, config).catch((error) => {
    console.error(`Erreur d'attribution du rôle lié au tag serveur pour ${member.id}:`, error);
  });
  assignSupportTagRole(member, config).catch((error) => {
    console.error(`Erreur d'attribution du rôle à ${member.id}:`, error);
  });
});

client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
  assignJoinRoles(newMember, config).catch((error) => {
    console.error(`Erreur de synchronisation des rôles automatiques de ${newMember.id}:`, error);
  });
  assignGambleTagRole(newMember, config).catch((error) => {
    console.error(`Erreur de synchronisation du rôle lié au tag serveur de ${newMember.id}:`, error);
  });
  assignSupportTagRole(newMember, config).catch((error) => {
    console.error(`Erreur d'attribution du rôle à ${newMember.id}:`, error);
  });
  renameBooster(newMember, config).catch((error) => {
    console.error(`Erreur de renommage du membre booster ${newMember.id}:`, error);
  });
});

client.on(Events.UserUpdate, (oldUser, newUser) => {
  const guild = client.guilds.cache.get(config.guildId);
  const member = guild?.members.cache.get(newUser.id);
  if (!member) return;

  assignGambleTagRole(member, config).catch((error) => {
    console.error(`Erreur de synchronisation du rôle lié au tag serveur de ${newUser.id}:`, error);
  });
});

client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.isChatInputCommand()) {
    let subcommand = "";
    try {
      subcommand = interaction.options.getSubcommand(false) ?? "";
    } catch (error) {
      console.warn(`Impossible de lire la sous-commande de l'interaction ${interaction.id}:`, error);
    }
    const command = `/${interaction.commandName}${subcommand ? ` ${subcommand}` : ""}`;
    void logToChannel(
      client,
      config,
      "Commande",
      `${interaction.user.tag} (\`${interaction.user.id}\`) a lancé \`${command}\` dans <#${interaction.channelId}>.`,
    );
  }

  handleInteraction(interaction).catch(async (error) => {
    const errorCode = getErrorCode(error);
    void logToChannel(
      client,
      config,
      "Erreur bot",
      `Interaction \`${interaction.id}\`${interaction.isChatInputCommand() ? ` /${interaction.commandName}` : ""} : \`${errorCode ?? "inconnu"}\`.`,
    );
    if (errorCode === 10003) {
      console.warn(`Interaction ${interaction.id} reçue dans un salon déjà supprimé.`);
      return;
    }
    if (errorCode === 10062 || errorCode === 40060) {
      console.warn(`Interaction ${interaction.id} expirée ou déjà acquittée par Discord.`);
      return;
    }
    if (networkErrorCodes.has(errorCode)) {
      console.warn(`Impossible de répondre à l'interaction ${interaction.id} : Discord est inaccessible (${errorCode}). Vérifie la connexion Internet, le pare-feu ou le proxy; le bot ne peut pas livrer une réponse sans accès à discord.com:443.`);
      return;
    }
    console.error(`Erreur de traitement de l'interaction ${interaction.id}:`, error);
    const response = {
      content: "Une erreur est survenue. Vérifie les permissions du bot et réessaie.",
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(response).catch((replyError) => {
        console.error(`Impossible d'afficher l'erreur à l'utilisateur ${interaction.user.id}:`, replyError);
      });
    } else {
      await interaction.reply(response).catch((replyError) => {
        console.error(`Impossible d'afficher l'erreur à l'utilisateur ${interaction.user.id}:`, replyError);
      });
    }
  });
});

client.on(Events.Error, (error) => {
  console.error("Erreur du client Discord :", error);
  void logToChannel(client, config, "Erreur client Discord", `${error.name}: ${error.message}`);
});

process.on("unhandledRejection", (error) => {
  console.error("Promesse non gérée :", error);
  void logToChannel(client, config, "Promesse non gérée", String(error?.message ?? error).slice(0, 1500));
});

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function loginWithRetry() {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await client.login(config.token);
      return;
    } catch (error) {
      const errorCode = getErrorCode(error);
      const isNetworkError = networkErrorCodes.has(errorCode);
      if (!isNetworkError || attempt === maxAttempts) {
        if (isNetworkError) {
          console.error("Connexion réseau à Discord impossible après plusieurs tentatives. Vérifie Internet, le pare-feu ou le proxy, puis relance start.bat :", error);
        } else if (error.status === 401 || error.code === "TokenInvalid") {
          console.error("Token Discord refusé. Vérifie DISCORD_TOKEN dans .env et régénère le token s'il a été exposé :", error);
        } else {
          console.error("Connexion Discord impossible. Vérifie la configuration et les permissions du bot :", error);
        }
        process.exitCode = 1;
        return;
      }

      const delayMilliseconds = Math.min(2 ** attempt * 1000, 15_000);
      console.warn(`Connexion à Discord interrompue (${errorCode}). Nouvelle tentative ${attempt + 1}/${maxAttempts} dans ${delayMilliseconds / 1000} s.`);
      await sleep(delayMilliseconds);
    }
  }
}

loginWithRetry().catch((error) => {
  console.error("Erreur inattendue pendant la connexion à Discord :", error);
  process.exitCode = 1;
});
