const { randomInt } = require("node:crypto");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { getUserBalance, updateBalance } = require("./gambling");

const ROULETTE_PANEL_MARKER = "emilie-european-roulette";
const ROULETTE_BUTTON_ID = "roulette:play";
const ROULETTE_SELECT_ID = "roulette:bet-type";
const ROULETTE_MODAL_PREFIX = "roulette:bet:";
const DEFAULT_BET = 5;
const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18,
  19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const BET_TYPES = new Map([
  ["red", { label: "Rouge", description: "18 numéros rouges — paiement 1:1" }],
  ["black", { label: "Noir", description: "18 numéros noirs — paiement 1:1" }],
  ["even", { label: "Pair", description: "Numéros pairs de 1 à 36 — paiement 1:1" }],
  ["odd", { label: "Impair", description: "Numéros impairs de 1 à 36 — paiement 1:1" }],
  ["low", { label: "Petit (1–18)", description: "Numéros de 1 à 18 — paiement 1:1" }],
  ["high", { label: "Grand (19–36)", description: "Numéros de 19 à 36 — paiement 1:1" }],
  ["number", { label: "Numéro précis", description: "Choisis un numéro de 0 à 36 — paiement 35:1" }],
]);

function getNumberColor(number) {
  if (number === 0) return "vert";
  return RED_NUMBERS.has(number) ? "rouge" : "noir";
}

function isWinningBet(type, selection, number) {
  switch (type) {
    case "red":
      return getNumberColor(number) === "rouge";
    case "black":
      return getNumberColor(number) === "noir";
    case "even":
      return number !== 0 && number % 2 === 0;
    case "odd":
      return number % 2 === 1;
    case "low":
      return number >= 1 && number <= 18;
    case "high":
      return number >= 19 && number <= 36;
    case "number":
      return number === selection;
    default:
      throw new Error(`Type de pari roulette inconnu : ${type}`);
  }
}

function createRoulettePanel() {
  const embed = new EmbedBuilder()
    .setColor(0x168a52)
    .setTitle("🎡 Roulette européenne")
    .setDescription([
      "1) Clique sur **Jouer à la roulette**",
      "2) Choisis un pari : **Rouge / Noir / Pair / Impair / Petit / Grand / Numéro exact**",
      "3) Écris ta mise en pièces",
      "4) Le bot tire un nombre entre **0 et 36**",
      "",
      "✅ **Règles simples**",
      "• **Rouge / Noir / Pair / Impair / Petit / Grand** : gagne **1 fois ta mise**",
      "• **Numéro exact** : gagne **35 fois ta mise**",
      "• **0** = vert et il fait perdre les paris de couleur, pair/impair et petit/grand",
      "• Si tu perds, tu perds ta mise. Si tu gagnes, tu reçois ton gain selon le pari choisi.",
      "",
      "C’est un jeu avec des pièces virtuelles uniquement.",
    ].join("\n"))
    .setFooter({ text: ROULETTE_PANEL_MARKER });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ROULETTE_BUTTON_ID)
      .setLabel("Jouer à la roulette")
      .setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}

async function ensureRoulettePanel(client, config) {
  const target = await client.channels.fetch(config.roulettePanelChannelId);
  if (!target?.isTextBased() || target.isDMBased()) {
    throw new Error(`Le salon configuré pour la roulette est introuvable ou non textuel : ${config.roulettePanelChannelId}`);
  }
  if (target.guildId !== config.guildId) {
    throw new Error(`Le salon de roulette ${target.id} n'appartient pas au serveur configuré ${config.guildId}.`);
  }

  const recentMessages = await target.messages.fetch({ limit: 100 });
  const panelExists = recentMessages.some((message) =>
    message.author.id === client.user.id
    && message.embeds.some((embed) => embed.footer?.text === ROULETTE_PANEL_MARKER),
  );
  if (panelExists) return false;

  await target.send(createRoulettePanel());
  return true;
}

function isRouletteChannel(interaction, config) {
  return interaction.guildId === config.guildId
    && interaction.channelId === config.roulettePanelChannelId;
}

async function rejectWrongChannel(interaction, config) {
  if (isRouletteChannel(interaction, config)) return false;
  await interaction.reply({
    content: `La roulette est disponible uniquement dans <#${config.roulettePanelChannelId}>.`,
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function handleRouletteButton(interaction, config) {
  if (await rejectWrongChannel(interaction, config)) return;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(ROULETTE_SELECT_ID)
    .setPlaceholder("Choisis ton type de pari")
    .addOptions([...BET_TYPES].map(([value, betType]) => ({
      label: betType.label,
      description: betType.description,
      value,
    })));
  await interaction.reply({
    content: `Tu as ${getUserBalance(interaction.user.id)} pièce(s). Choisis ton pari :`,
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRouletteBetType(interaction, config) {
  if (await rejectWrongChannel(interaction, config)) return;

  const type = interaction.values[0];
  const betType = BET_TYPES.get(type);
  if (!betType) {
    await interaction.reply({
      content: "Ce type de pari n'est pas valide. Relance une partie depuis le panneau.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${ROULETTE_MODAL_PREFIX}${type}`)
    .setTitle(`Pari : ${betType.label}`);
  const amountInput = new TextInputBuilder()
    .setCustomId("amount")
    .setLabel("Mise en pièces")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(String(DEFAULT_BET))
    .setMinLength(1)
    .setMaxLength(15)
    .setRequired(true)
    .setValue(String(DEFAULT_BET));
  modal.addComponents(new ActionRowBuilder().addComponents(amountInput));

  if (type === "number") {
    const numberInput = new TextInputBuilder()
      .setCustomId("number")
      .setLabel("Numéro choisi (de 0 à 36)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("0 à 36")
      .setMinLength(1)
      .setMaxLength(2)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(numberInput));
  }

  await interaction.showModal(modal);
}

async function handleRouletteModalSubmit(interaction, config) {
  if (await rejectWrongChannel(interaction, config)) return;

  const type = interaction.customId.slice(ROULETTE_MODAL_PREFIX.length);
  const betType = BET_TYPES.get(type);
  if (!betType) {
    await interaction.reply({
      content: "Ce pari n'est pas valide. Relance une partie depuis le panneau.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const rawAmount = interaction.fields.getTextInputValue("amount").trim();
  const amount = /^\d+$/.test(rawAmount) ? Number(rawAmount) : Number.NaN;
  const rawSelection = type === "number"
    ? interaction.fields.getTextInputValue("number").trim()
    : null;
  const selection = rawSelection !== null && /^\d+$/.test(rawSelection)
    ? Number(rawSelection)
    : null;
  if (!Number.isSafeInteger(amount) || amount < 1) {
    await interaction.reply({
      content: "La mise doit être un entier positif.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (type === "number" && (!Number.isInteger(selection) || selection < 0 || selection > 36)) {
    await interaction.reply({
      content: "Le numéro choisi doit être un entier entre 0 et 36.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const balance = getUserBalance(interaction.user.id);
  if (amount > balance) {
    await interaction.reply({
      content: `Tu n'as pas assez de pièces pour miser ${amount}. Ton solde est de ${balance} pièce(s).`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (type === "number" && !Number.isSafeInteger(amount * 35)) {
    await interaction.reply({
      content: "Cette mise est trop élevée pour calculer le gain. Choisis une mise plus petite.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = randomInt(0, 37);
  const won = isWinningBet(type, selection, result);
  const netChange = won ? amount * (type === "number" ? 35 : 1) : -amount;
  if (!Number.isSafeInteger(balance + netChange)) {
    await interaction.reply({
      content: "Le solde maximal autorisé serait dépassé par ce résultat. Choisis une mise plus petite.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const newBalance = updateBalance(interaction.user.id, netChange);
  const color = getNumberColor(result);
  const embed = new EmbedBuilder()
    .setColor(color === "rouge" ? 0xe74c3c : color === "noir" ? 0x202225 : 0x2ecc71)
    .setTitle(`🎡 La bille tombe sur ${result} ${color}`)
    .setDescription(won
      ? `**Gagné !** Ton pari **${betType.label}${type === "number" ? ` ${selection}` : ""}** est gagnant. Tu remportes ${netChange} pièce(s) net.`
      : `**Perdu.** Ton pari **${betType.label}${type === "number" ? ` ${selection}` : ""}** ne gagne pas. Tu perds ${amount} pièce(s).`)
    .addFields(
      { name: "Mise", value: `${amount} pièces`, inline: true },
      { name: "Résultat", value: `${result} — ${color}`, inline: true },
      { name: "Nouveau solde", value: `${newBalance} pièces`, inline: true },
    );
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = {
  ROULETTE_BUTTON_ID,
  ROULETTE_MODAL_PREFIX,
  ROULETTE_SELECT_ID,
  ensureRoulettePanel,
  getNumberColor,
  handleRouletteBetType,
  handleRouletteButton,
  handleRouletteModalSubmit,
  isWinningBet,
};
