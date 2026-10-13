const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} = require("discord.js");
const { getUserBalance, updateBalance } = require("./gambling");

const DATA_DIR = process.env.DATA_DIR?.trim() ? path.resolve(process.env.DATA_DIR.trim()) : path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "shop.json");

const SHOP_PANEL_MARKER = "emilie-shop-panel";
const SHOP_BUTTON_ID = "shop:open";
const SHOP_SELECT_ID = "shop:select";
const SHOP_MODAL_PREFIX = "shop:confirm:";
const DELETE_PIECE_BUTTON_ID = "delete-piece:click";
const DELETE_PIECE_PANEL_MARKER = "emilie-delete-piece-panel";
const deletePieceMessageState = new Map();

const ITEMS = [
  { id: "netflix", label: "Netflix", price: 2800, emoji: "<:netflix:1559227785111797800>" },
  { id: "spotify", label: "Spotify", price: 2500, emoji: "<:spotify:1559230561820868618>" },
  { id: "crunchy", label: "Crunchyroll", price: 3500, emoji: "<:crunchy:1559228162414743556>" },
];
const pendingPurchases = new Set();

function readShopData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveShopData(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

let shopData = readShopData();

function createShopEmbed() {
  const embed = new EmbedBuilder()
    .setTitle("🛒 Acheter des comptes avec vos pièces")
    .setColor(0x1abc9c)
    .setDescription(ITEMS.map((it) => `${it.emoji} **${it.label}** — ${it.price} pièces`).join("\n\n"))
    .setFooter({ text: SHOP_PANEL_MARKER });
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(SHOP_BUTTON_ID).setLabel("Acheter un compte").setStyle(ButtonStyle.Primary))] };
}

async function ensureShopPanel(client, config) {
  const target = await client.channels.fetch(config.shopPanelChannelId);
  if (!target?.isTextBased() || target.isDMBased()) {
    throw new Error(`Salon de shop introuvable : ${config.shopPanelChannelId}`);
  }
  if (target.guildId !== config.guildId) {
    throw new Error(`Salon de shop ${target.id} n'appartient pas au serveur configuré.`);
  }
  const recent = await target.messages.fetch({ limit: 100 });
  const existingPanel = recent.find((message) =>
    message.author.id === client.user.id
    && message.embeds.some((embed) => embed.footer?.text === SHOP_PANEL_MARKER),
  );
  if (existingPanel) {
    await existingPanel.edit(createShopEmbed());
    return false;
  }

  const message = await target.send(createShopEmbed());
  shopData[message.id] = { usesRemaining: null };
  saveShopData(shopData);
  return true;
}

async function postShopPanel(channel, uses = null) {
  const msg = await channel.send(createShopEmbed());
  shopData[msg.id] = { usesRemaining: Number.isInteger(uses) ? uses : null };
  saveShopData(shopData);
  return msg;
}

function isShopChannel(interaction, config) {
  return interaction.guildId === config.guildId && interaction.channelId === config.shopPanelChannelId;
}

async function handleShopButton(interaction, config) {
  if (!isShopChannel(interaction, config)) {
    await interaction.reply({ content: `Le panneau d'achat est disponible uniquement dans <#${config.shopPanelChannelId}>.`, flags: MessageFlags.Ephemeral });
    return;
  }
  const select = new StringSelectMenuBuilder().setCustomId(SHOP_SELECT_ID).setPlaceholder("Choisis un compte à acheter").addOptions(
    ITEMS.map((it) => ({ label: `${it.label} — ${it.price} pièces`, value: `${it.id}:${it.price}` })),
  );
  await interaction.reply({ content: `Ton solde : ${getUserBalance(interaction.user.id)} pièces. Choisis le compte à acheter :`, components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
}

async function completePurchase(interaction, config, item, messageId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (pendingPurchases.has(interaction.user.id)) {
    await interaction.editReply({ content: "Un de tes achats est déjà en cours." });
    return;
  }

  pendingPurchases.add(interaction.user.id);
  try {
    const meta = shopData[messageId] ?? { usesRemaining: null };
    if (meta.usesRemaining === 0) {
      await interaction.editReply({ content: "Cet article n'est plus disponible (plus d'utilisations)." });
      return;
    }

    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({ content: "Les achats sont disponibles uniquement sur le serveur." });
      return;
    }
    const existingPurchase = guild.channels.cache.find((channel) =>
      channel.type === 0
      && (
        channel.topic?.startsWith(`purchase-owner:${interaction.user.id}`)
        || (channel.parentId === config.buyCategoryId && channel.topic?.startsWith(`ticket-owner:${interaction.user.id}`))
      ),
    );
    if (existingPurchase) {
      await interaction.editReply({ content: `Tu as déjà un salon d'achat ouvert : ${existingPurchase}` });
      return;
    }

    const balance = getUserBalance(interaction.user.id);
    if (balance < item.price) {
      await interaction.editReply({ content: `Il te faut ${item.price} pièces pour acheter ${item.label}. Ton solde est de ${balance} pièces.` });
      return;
    }

    const itemName = item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const pseudo = interaction.user.username.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "user";
    const channelName = `${itemName}-${pseudo}`.slice(0, 90);
    const categoryId = config.buyCategoryId;
    const everyone = guild.roles.everyone;
    const member = await guild.members.fetch(interaction.user.id);
    const botMember = guild.members.me;

    const permissionOverwrites = [
      { id: everyone.id, deny: ["ViewChannel"] },
      { id: member.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
    ];

    for (const roleId of config.ticketStaffRoleIds) {
      permissionOverwrites.push({ id: roleId, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] });
    }
    permissionOverwrites.push({ id: botMember.id, allow: ["ViewChannel", "SendMessages", "ManageChannels", "ReadMessageHistory"] });

    let channel;
    try {
      channel = await guild.channels.create({
        name: channelName,
        type: 0,
        parent: categoryId,
        topic: `purchase-owner:${interaction.user.id}`,
        permissionOverwrites,
        reason: `Achat ${item.label} par ${interaction.user.tag}`,
      });
    } catch (error) {
      console.error(`Impossible de créer le salon d'achat pour ${interaction.user.id}:`, error);
      await interaction.editReply({ content: "Impossible de créer le salon privé. Contacte un administrateur." });
      return;
    }

    if (getUserBalance(interaction.user.id) < item.price) {
      await channel.delete("Solde insuffisant au moment de valider l'achat.");
      await interaction.editReply({ content: `Ton solde a changé pendant l'achat; il te faut ${item.price} pièces.` });
      return;
    }

    const staffPings = config.ticketStaffRoleIds.map((r) => `<@&${r}>`).join(" ");
    const embed = new EmbedBuilder()
      .setTitle(`Achat : ${item.label}`)
      .setDescription(`${interaction.user} a acheté **${item.label}** pour **${item.price}** pièces.`);
    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket:close")
        .setLabel("Fermer le salon")
        .setStyle(ButtonStyle.Danger),
    );
    try {
      await channel.send({
        content: `${interaction.user} ${staffPings}`,
        embeds: [embed],
        components: [closeRow],
      });
    } catch (error) {
      console.error(`Impossible d'envoyer le récapitulatif dans le salon d'achat ${channel.id}:`, error);
      await channel.delete("Impossible d'initialiser le salon d'achat.").catch((deleteError) => {
        console.error(`Impossible de supprimer le salon d'achat incomplet ${channel.id}:`, deleteError);
      });
      throw error;
    }

    updateBalance(interaction.user.id, -item.price);
    if (Number.isInteger(meta.usesRemaining)) {
      meta.usesRemaining -= 1;
      shopData[messageId] = meta;
      saveShopData(shopData);
    }
    await interaction.editReply({ content: `Achat validé pour ${item.price} pièces — salon créé : ${channel}. Un membre du staff va te répondre.` });
  } finally {
    pendingPurchases.delete(interaction.user.id);
  }
}

async function handleShopSelect(interaction, config) {
  if (!isShopChannel(interaction, config)) {
    await interaction.reply({ content: `Le panneau d'achat est disponible uniquement dans <#${config.shopPanelChannelId}>.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const [itemId] = interaction.values[0].split(":");
  const item = ITEMS.find((i) => i.id === itemId);
  if (!item) {
    await interaction.reply({ content: "Article inconnu.", flags: MessageFlags.Ephemeral });
    return;
  }

  await completePurchase(interaction, config, item, interaction.message.id);
}

async function handleShopModalSubmit(interaction, config) {
  const raw = interaction.customId.slice(SHOP_MODAL_PREFIX.length);
  const [itemId, , messageId] = raw.split(":");
  const item = ITEMS.find((i) => i.id === itemId);
  if (!item) {
    await interaction.reply({ content: "Article inconnu.", flags: MessageFlags.Ephemeral });
    return;
  }

  await completePurchase(interaction, config, item, messageId);
}

function createDeletePiecePanel(amount, usesRemaining) {
  const embed = new EmbedBuilder()
    .setColor(0xf5a623)
    .setTitle("🗑️ Suppression de pièces")
    .setDescription(`Clique sur le bouton pour perdre **${amount}** pièces.\n\nUtilisations restantes : **${usesRemaining}**.`)
    .setFooter({ text: DELETE_PIECE_PANEL_MARKER });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(DELETE_PIECE_BUTTON_ID)
      .setLabel("Click pour delete piece")
      .setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row] };
}

async function postDeletePiecePanel(interaction, amount, usesRemaining) {
  if (!interaction.channel?.isTextBased() || interaction.channel.isDMBased()) {
    throw new Error("La commande doit être utilisée dans un salon textuel du serveur.");
  }
  const message = await interaction.channel.send(createDeletePiecePanel(amount, usesRemaining));
  deletePieceMessageState.set(String(message.id), { amount, usesRemaining });
  return message;
}

async function handleDeletePieceButton(interaction) {
  if (!interaction.isButton() || interaction.customId !== DELETE_PIECE_BUTTON_ID) return;

  const state = deletePieceMessageState.get(String(interaction.message.id));
  if (!state) {
    await interaction.reply({ content: "Ce bouton n'est plus actif.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (state.usesRemaining <= 0) {
    await interaction.reply({ content: "Ce bouton n'a plus d'utilisations disponibles.", flags: MessageFlags.Ephemeral });
    return;
  }

  const userBalance = getUserBalance(interaction.user.id);
  if (userBalance < state.amount) {
    await interaction.reply({ content: `Tu n'as pas assez de pièces pour payer ${state.amount}.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const newBalance = updateBalance(interaction.user.id, -state.amount);
  const remainingUses = state.usesRemaining - 1;
  deletePieceMessageState.set(String(interaction.message.id), { ...state, usesRemaining: remainingUses });

  if (remainingUses <= 0) {
    deletePieceMessageState.delete(String(interaction.message.id));
  }

  await interaction.reply({
    content: `Tu as perdu ${state.amount} pièces. Nouveau solde : ${newBalance}.`,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  ensureShopPanel,
  postShopPanel,
  handleShopButton,
  handleShopSelect,
  handleShopModalSubmit,
  postDeletePiecePanel,
  handleDeletePieceButton,
  DELETE_PIECE_BUTTON_ID,
  SHOP_BUTTON_ID,
  SHOP_SELECT_ID,
  SHOP_MODAL_PREFIX,
};