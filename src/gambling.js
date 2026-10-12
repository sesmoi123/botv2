const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const DATA_DIRECTORY = process.env.DATA_DIR?.trim() ? path.resolve(process.env.DATA_DIR.trim()) : path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIRECTORY, "gambling.json");
const GAMBLE_PANEL_MARKER = "emilie-gamble-panel";

const STARTING_BALANCE = 100;
const DEFAULT_BET = 5;
const GAMBLE_BUTTON_ID = "gamble:play";
const GAMBLE_MODAL_ID = "gamble:setup";
const GAMBLE_CHOICE_PREFIX = "gamble:choice:";
const BET_EXPIRATION_MS = 2 * 60 * 1000;
const pendingBets = new Map();

function readBalances() {
  fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return {};

  const contents = fs.readFileSync(DATA_FILE, "utf8");
  const parsed = JSON.parse(contents);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Le fichier data/gambling.json doit contenir un objet JSON.");
  }
  return parsed;
}

let balances = readBalances();

function saveBalances() {
  fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(balances, null, 2)}\n`, "utf8");
}

function ensureBalance(userId) {
  if (!Object.prototype.hasOwnProperty.call(balances, userId)) {
    balances[userId] = STARTING_BALANCE;
    saveBalances();
  }
  return balances[userId];
}

function getUserBalance(userId) {
  return ensureBalance(userId);
}

function updateBalance(userId, delta) {
  const current = ensureBalance(userId);
  const next = Math.max(0, current + delta);
  balances[userId] = next;
  saveBalances();
  return next;
}

function addBalance(userId, amount) {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error("Le montant ajouté doit être un entier positif.");
  }
  const current = ensureBalance(userId);
  const next = current + amount;
  balances[userId] = next;
  saveBalances();
  return next;
}

function clearExpiredBets() {
  const now = Date.now();
  for (const [betId, pendingBet] of pendingBets) {
    if (pendingBet.expiresAt <= now) pendingBets.delete(betId);
  }
}

function createGamblePanel() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(GAMBLE_BUTTON_ID)
      .setLabel("Jouer au gamble")
      .setStyle(ButtonStyle.Primary),
  );
}

function createGambleMessage() {
  const embed = new EmbedBuilder()
    .setColor(0xff69b4)
    .setTitle("🎲 Gamble du serveur")
    .setDescription(
      "Chaque compte démarre avec 100 pièces.\n\nClique sur le bouton pour choisir ta mise, puis parie **moins que 5** ou **plus que 5**. Le tirage est un nombre aléatoire entre 1 et 10.\n\nSi tu gagnes, tu reçois le double de ta mise. Si tu perds, tu perds toute ta mise. Un 5 rembourse la mise.",
    )
    .setFooter({ text: GAMBLE_PANEL_MARKER });
  return { embeds: [embed], components: [createGamblePanel()] };
}

async function ensureGamblePanel(client, config) {
  const target = await client.channels.fetch(config.gamblePanelChannelId);
  if (!target?.isTextBased() || target.isDMBased()) {
    throw new Error(`Le salon configuré pour le panneau de gamble est introuvable ou non textuel : ${config.gamblePanelChannelId}`);
  }
  if (target.guildId !== config.guildId) {
    throw new Error(`Le salon du panneau de gamble ${target.id} n'appartient pas au serveur configuré ${config.guildId}.`);
  }

  const recentMessages = await target.messages.fetch({ limit: 100 });
  const panelExists = recentMessages.some((message) =>
    message.author.id === client.user.id
    && message.embeds.some((embed) => embed.footer?.text === GAMBLE_PANEL_MARKER),
  );
  let created = false;
  if (!panelExists) {
    await target.send(createGambleMessage());
    created = true;
  }

  let removed = 0;
  if (config.ticketPanelChannelId !== target.id) {
    const ticketChannel = await client.channels.fetch(config.ticketPanelChannelId);
    if (!ticketChannel?.isTextBased() || ticketChannel.isDMBased()) {
      throw new Error(`Le salon configuré pour les tickets est introuvable ou non textuel : ${config.ticketPanelChannelId}`);
    }
    if (ticketChannel.guildId !== config.guildId) {
      throw new Error(`Le salon des tickets ${ticketChannel.id} n'appartient pas au serveur configuré ${config.guildId}.`);
    }

    const oldMessages = await ticketChannel.messages.fetch({ limit: 100 });
    const oldPanels = oldMessages.filter((message) =>
      message.author.id === client.user.id
      && message.embeds.some((embed) => embed.footer?.text === GAMBLE_PANEL_MARKER),
    );
    for (const message of oldPanels.values()) {
      await message.delete();
      removed += 1;
    }
  }

  return { created, removed };
}

async function showGambleModal(interaction) {
  const modal = new ModalBuilder().setCustomId(GAMBLE_MODAL_ID).setTitle("Mise du gamble");
  const amountInput = new TextInputBuilder()
    .setCustomId("amount")
    .setLabel("Combien de pièces tu mets ?")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(String(DEFAULT_BET))
    .setMinLength(1)
    .setMaxLength(6)
    .setRequired(true)
    .setValue(String(DEFAULT_BET));

  modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
  await interaction.showModal(modal);
}

async function handleGambleButton(interaction) {
  await showGambleModal(interaction);
}

function getGambleChoiceButtons(betId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${GAMBLE_CHOICE_PREFIX}${betId}:low`)
      .setLabel("Moins que 5")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${GAMBLE_CHOICE_PREFIX}${betId}:high`)
      .setLabel("Plus que 5")
      .setStyle(ButtonStyle.Secondary),
  );
}

async function handleGambleModalSubmit(interaction) {
  clearExpiredBets();
  const rawAmount = interaction.fields.getTextInputValue("amount");
  const bet = /^\d+$/.test(rawAmount) ? Number(rawAmount) : Number.NaN;
  const balance = getUserBalance(interaction.user.id);
  const reservedBets = [...pendingBets.values()]
    .filter((pendingBet) => pendingBet.userId === interaction.user.id)
    .reduce((total, pendingBet) => total + pendingBet.amount, 0);

  if (!Number.isInteger(bet) || bet < 1) {
    await interaction.reply({
      content: "Le montant doit être un nombre entier positif.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (bet > balance - reservedBets) {
    await interaction.reply({
      content: `Tu n'as pas assez de pièces pour miser ${bet}. Tu as ${balance} pièce(s) dans ton inventaire.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const betId = randomUUID();
  pendingBets.set(betId, {
    userId: interaction.user.id,
    amount: bet,
    expiresAt: Date.now() + BET_EXPIRATION_MS,
  });
  const components = getGambleChoiceButtons(betId);
  await interaction.reply({
    content: `Tu mises ${bet} pièce(s). Choisis maintenant : moins que 5 ou plus que 5.`,
    components: [components],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleGambleChoice(interaction) {
  const customId = interaction.customId;
  if (!customId.startsWith(GAMBLE_CHOICE_PREFIX)) return;

  const [betId, side] = customId.slice(GAMBLE_CHOICE_PREFIX.length).split(":");
  const pendingBet = pendingBets.get(betId);
  if (
    !pendingBet
    || pendingBet.expiresAt <= Date.now()
    || pendingBet.userId !== interaction.user.id
    || !["low", "high"].includes(side)
  ) {
    if (pendingBet?.expiresAt <= Date.now()) pendingBets.delete(betId);
    await interaction.reply({
      content: "Ce pari n'est plus disponible ou ne t'appartient pas. Relance une partie depuis le panneau.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  pendingBets.delete(betId);
  const bet = pendingBet.amount;

  const roll = Math.floor(Math.random() * 10) + 1;
  const wasLow = side === "low";
  const wasHigh = side === "high";

  let outcomeText = "";
  let balanceChange = 0;

  if (roll === 5) {
    outcomeText = `Le nombre tiré est ${roll}. C'est un 5, donc tu récupères ta mise.`;
  } else if ((wasLow && roll < 5) || (wasHigh && roll > 5)) {
    balanceChange = bet;
    outcomeText = `Le nombre tiré est ${roll}. Tu gagnes ! Tu reçois ${bet * 2} pièces (le double de ta mise).`;
  } else {
    balanceChange = -bet;
    outcomeText = `Le nombre tiré est ${roll}. Tu perds ! -${bet} pièces.`;
  }

  updateBalance(interaction.user.id, balanceChange);
  const inventory = getUserBalance(interaction.user.id);
  const embed = new EmbedBuilder()
    .setColor(roll === 5 ? 0xF1C40F : (wasLow && roll < 5) || (wasHigh && roll > 5) ? 0x2ECC71 : 0xE74C3C)
    .setTitle("🎲 Résultat du gamble")
    .setDescription(`${outcomeText}\n\nTu as maintenant ${inventory} pièce(s).`)
    .addFields(
      { name: "Mise", value: `${bet} pièces`, inline: true },
      { name: "Choix", value: wasLow ? "Moins que 5" : "Plus que 5", inline: true },
      { name: "Niveau tiré", value: String(roll), inline: true },
    );

  await interaction.update({ embeds: [embed], components: [] });
}

async function inventoryCommand(interaction) {
  const balance = getUserBalance(interaction.user.id);
  await interaction.reply({
    content: `Tu as ${balance} pièce(s) dans ton inventaire.`,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  GAMBLE_BUTTON_ID,
  GAMBLE_MODAL_ID,
  GAMBLE_CHOICE_PREFIX,
  ensureGamblePanel,
  handleGambleButton,
  handleGambleChoice,
  handleGambleModalSubmit,
  inventoryCommand,
  getUserBalance,
  updateBalance,
addBalance,
};
