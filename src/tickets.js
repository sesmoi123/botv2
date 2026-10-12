const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  MessageFlags,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const CREATE_TICKET_BUTTON = "ticket:create";
const CLOSE_TICKET_BUTTON = "ticket:close";
const TICKET_REASON_MODAL = "ticket:reason";
const TICKET_PANEL_MARKER = "emilie-ticket-panel";

function isTicketChannel(channel) {
  return channel?.type === ChannelType.GuildText && channel.topic?.startsWith("ticket-owner:");
}

function ticketOwnerId(channel) {
  return channel.topic?.slice("ticket-owner:".length).split(";")[0] ?? null;
}

async function showTicketReasonModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId(TICKET_REASON_MODAL)
    .setTitle("Créer un ticket");

  const reasonInput = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("Raison du ticket")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Explique ta demande en quelques mots…")
    .setMinLength(5)
    .setMaxLength(1000)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  await interaction.showModal(modal);
}

function hasStaffAccess(interaction, config) {
  if (config.adminIds.has(interaction.user.id)) return true;
  const roles = interaction.member?.roles?.cache;
  return Boolean(roles && config.ticketStaffRoleIds.some((roleId) => roles.has(roleId)));
}

async function openTicketChannel({ interaction, config, reason }) {
  const guild = interaction.guild;
  if (!guild) throw new Error("Impossible de trouver le serveur pour créer le ticket.");

  const existing = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && ticketOwnerId(channel) === interaction.user.id,
  );
  if (existing) {
    await interaction.editReply({ content: `Tu as déjà un ticket ouvert : ${existing}` });
    return existing;
  }

  const [member, botMember] = await Promise.all([
    guild.members.fetch(interaction.user.id),
    guild.members.fetchMe(),
  ]);
  const overwrites = [
    { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: member,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    {
      id: botMember,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];

  for (const adminId of config.adminIds) {
    if (adminId === member.id || adminId === botMember.id) continue;
    let adminMember;
    try {
      adminMember = await guild.members.fetch(adminId);
    } catch (error) {
      if (error.code === 10007) {
        console.warn(`L'administrateur autorisé ${adminId} n'est pas membre de ce serveur; il ne sera pas ajouté aux accès du ticket.`);
        continue;
      }
      throw error;
    }
    overwrites.push({
      id: adminMember,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  const staffRoleIds = new Set(config.ticketStaffRoleIds);
  if (config.ticketSupportRoleId) staffRoleIds.add(config.ticketSupportRoleId);
  const staffRoles = [];
  for (const roleId of staffRoleIds) {
    let role;
    try {
      role = await guild.roles.fetch(roleId);
    } catch (error) {
      if (error.code === 10011) {
        console.warn(`Le rôle de support ${roleId} est introuvable sur le serveur; le ticket sera créé sans ce rôle.`);
        continue;
      }
      throw error;
    }
    if (!role) {
      console.warn(`Le rôle de support ${roleId} est introuvable sur le serveur; le ticket sera créé sans ce rôle.`);
      continue;
    }
    staffRoles.push(role);
    overwrites.push({
      id: role,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  const safeName = member.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 35);
  const channel = await guild.channels.create({
    name: `ticket-${safeName || "membre"}`.slice(0, 90),
    type: ChannelType.GuildText,
    topic: `ticket-owner:${interaction.user.id}`,
    parent: config.ticketCategoryId ?? undefined,
    permissionOverwrites: overwrites,
    reason: `Ticket ouvert par ${interaction.user.tag}`,
  });

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CLOSE_TICKET_BUTTON)
      .setLabel("Fermer le ticket")
      .setStyle(ButtonStyle.Danger),
  );
  const validStaffRoleIds = staffRoles.map((role) => role.id);
  const rolePings = validStaffRoleIds.map((roleId) => `<@&${roleId}>`).join(" ");

  await channel.send({
    content: `<@${interaction.user.id}> ${rolePings}`.trim(),
    allowedMentions: { users: [interaction.user.id], roles: validStaffRoleIds },
    embeds: [
      new EmbedBuilder()
        .setColor(0xff69b4)
        .setTitle("Ticket Emilie")
        .setDescription(`**Raison :** ${reason}\n\nUn membre du staff te répondra dès que possible.`),
    ],
    components: [closeRow],
  });
  await interaction.editReply({ content: `Ton ticket privé est ouvert : ${channel}` });
  return channel;
}

async function createTicket(interaction, config) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Les tickets sont disponibles uniquement sur un serveur.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const reason = interaction.fields.getTextInputValue("reason").trim();
  await openTicketChannel({ interaction, config, reason });
}

function ticketPanelComponents() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CREATE_TICKET_BUTTON)
      .setLabel("Créer un ticket")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🎫"),
  );
}

async function sendTicketPanel(target) {
  await target.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xff69b4)
        .setTitle("Besoin d'aide ?")
        .setDescription("Clique sur le bouton ci-dessous pour créer un ticket privé avec l'équipe.")
        .setFooter({ text: TICKET_PANEL_MARKER }),
    ],
    components: [ticketPanelComponents()],
  });
}

async function ensureTicketPanel(client, config) {
  const target = await client.channels.fetch(config.ticketPanelChannelId);
  if (!target?.isTextBased() || target.isDMBased()) {
    throw new Error(`Le salon configuré pour le panneau de tickets est introuvable ou non textuel : ${config.ticketPanelChannelId}`);
  }
  if (target.guildId !== config.guildId) {
    throw new Error(`Le salon du panneau de tickets ${target.id} n'appartient pas au serveur configuré ${config.guildId}.`);
  }
  const recentMessages = [...(await target.messages.fetch({ limit: 100 })).values()];
  const panelExists = recentMessages.some((message) =>
    message.author.id === client.user.id
    && message.embeds.some((embed) => embed.footer?.text === TICKET_PANEL_MARKER),
  );
  if (panelExists) return false;
  await sendTicketPanel(target);
  return true;
}

async function postTicketPanel(interaction) {
  const target = interaction.options.getChannel("salon") ?? interaction.channel;
  if (!target?.isTextBased() || target.isDMBased()) {
    if (interaction.deferred) {
      await interaction.editReply({ content: "Choisis un salon textuel du serveur." });
    } else {
      await interaction.reply({ content: "Choisis un salon textuel du serveur.", flags: MessageFlags.Ephemeral });
    }
    return;
  }
  await sendTicketPanel(target);
  if (interaction.deferred) {
    await interaction.editReply({ content: `Panneau publié dans ${target}.` });
  } else {
    await interaction.reply({ content: `Panneau publié dans ${target}.`, flags: MessageFlags.Ephemeral });
  }
}

async function closeTicket(interaction, config) {
  const channel = interaction.channel;
  const isButton = interaction.isButton();
  if (isButton) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  if (!isTicketChannel(channel)) {
    const response = { content: "Cette commande doit être utilisée dans un salon ticket." };
    if (isButton) {
      await interaction.followUp({ ...response, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.editReply(response);
    }
    return;
  }

  if (!hasStaffAccess(interaction, config)) {
    const response = { content: "Seuls les administrateurs autorisés et les rôles de support configurés peuvent fermer un ticket." };
    if (isButton) {
      await interaction.followUp({ ...response, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.editReply(response);
    }
    return;
  }

  if (isButton) {
    await interaction.editReply({ content: "Ticket fermé. Le salon sera supprimé dans 2 secondes.", components: [] });
  } else {
    await interaction.editReply({ content: "Ticket fermé. Le salon sera supprimé dans 2 secondes." });
  }
  setTimeout(() => {
    channel.delete(`Ticket fermé par ${interaction.user.tag}`).catch((error) => {
      console.error(`Impossible de supprimer le ticket ${channel.id}:`, error);
    });
  }, 2_000).unref();
}

module.exports = {
  closeTicket,
  createTicket,
  ensureTicketPanel,
  isTicketChannel,
  postTicketPanel,
  showTicketReasonModal,
  CREATE_TICKET_BUTTON,
  CLOSE_TICKET_BUTTON,
};
