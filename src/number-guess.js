const { randomInt } = require("node:crypto");
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
const { getUserBalance, updateBalance } = require("./gambling");

const PANEL_MARKER = "emilie-number-guess-panel";
const BUTTON_ID = "number-guess:play";
const MODAL_ID = "number-guess:submit";
const DEFAULT_BET = 5;

function createPanel() {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎯 Devine le nombre")
    .setDescription([
      "Clique sur le bouton, choisis ta mise et un nombre de **0 à 20**.",
      "Le bot tire ensuite un nombre au hasard :",
      "• Même nombre : tu récupères **5 fois ta mise** au total.",
      "• À 1 ou 2 d’écart : tu récupères **2 fois ta mise** au total.",
      "• À plus de 2 d’écart : tu perds ta mise.",
      "",
      "Jeu avec des pièces virtuelles uniquement.",
    ].join("\n"))
    .setFooter({ text: PANEL_MARKER });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_ID)
      .setLabel("Deviner un nombre")
      .setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

async function ensurePanel(client, config) {
  const target = await client.channels.fetch(config.numberGuessPanelChannelId);
  if (!target?.isTextBased() || target.isDMBased()) {
    throw new Error(`Le salon configuré pour le jeu de nombres est introuvable ou non textuel : ${config.numberGuessPanelChannelId}`);
  }
  if (target.guildId !== config.guildId) {
    throw new Error(`Le salon du jeu de nombres ${target.id} n'appartient pas au serveur configuré ${config.guildId}.`);
  }

  const recentMessages = await target.messages.fetch({ limit: 100 });
  const panelExists = recentMessages.some((message) =>
    message.author.id === client.user.id
    && message.embeds.some((embed) => embed.footer?.text === PANEL_MARKER),
  );
  if (panelExists) return false;

  await target.send(createPanel());
  return true;
}

async function rejectWrongChannel(interaction, config) {
  if (
    interaction.guildId === config.guildId
    && interaction.channelId === config.numberGuessPanelChannelId
  ) return false;

  await interaction.reply({
    content: `Ce jeu est disponible uniquement dans <#${config.numberGuessPanelChannelId}>.`,
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function handleButton(interaction, config) {
  if (await rejectWrongChannel(interaction, config)) return;

  const modal = new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle("Devine le nombre");
  const amountInput = new TextInputBuilder()
    .setCustomId("amount")
    .setLabel("Mise en pièces")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(String(DEFAULT_BET))
    .setMinLength(1)
    .setMaxLength(15)
    .setRequired(true)
    .setValue(String(DEFAULT_BET));
  const guessInput = new TextInputBuilder()
    .setCustomId("guess")
    .setLabel("Ton nombre (de 0 à 20)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("0 à 20")
    .setMinLength(1)
    .setMaxLength(2)
    .setRequired(true);
  modal.addComponents(
    new ActionRowBuilder().addComponents(amountInput),
    new ActionRowBuilder().addComponents(guessInput),
  );
  await interaction.showModal(modal);
}

async function handleModalSubmit(interaction, config) {
  if (await rejectWrongChannel(interaction, config)) return;

  const rawAmount = interaction.fields.getTextInputValue("amount").trim();
  const amount = /^\d+$/.test(rawAmount) ? Number(rawAmount) : Number.NaN;
  const rawGuess = interaction.fields.getTextInputValue("guess").trim();
  const guess = /^\d+$/.test(rawGuess) ? Number(rawGuess) : Number.NaN;

  if (!Number.isSafeInteger(amount) || amount < 1) {
    await interaction.reply({
      content: "La mise doit être un nombre entier positif.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!Number.isInteger(guess) || guess < 0 || guess > 20) {
    await interaction.reply({
      content: "Ton nombre doit être un entier compris entre 0 et 20.",
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
  if (!Number.isSafeInteger(balance + amount * 4)) {
    await interaction.reply({
      content: "Cette mise pourrait dépasser le solde maximal autorisé. Choisis une mise plus petite.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const secretNumber = randomInt(0, 21);
  const difference = Math.abs(secretNumber - guess);
  const multiplier = difference === 0 ? 5 : difference <= 2 ? 2 : 0;
  const balanceChange = multiplier === 0 ? -amount : amount * (multiplier - 1);
  const newBalance = updateBalance(interaction.user.id, balanceChange);
  const resultDescription = multiplier === 5
    ? `**Exact !** Le nombre était **${secretNumber}**. Tu récupères **${amount * 5} pièces** au total.`
    : multiplier === 2
      ? `**Bien joué !** Le nombre était **${secretNumber}**, à ${difference} d'écart. Tu récupères **${amount * 2} pièces** au total.`
      : `**Perdu.** Le nombre était **${secretNumber}**, à ${difference} d'écart. Tu perds ta mise de **${amount} pièces**.`;
  const embed = new EmbedBuilder()
    .setColor(multiplier > 0 ? 0x2ecc71 : 0xe74c3c)
    .setTitle("🎯 Résultat")
    .setDescription(resultDescription)
    .addFields(
      { name: "Ton choix", value: String(guess), inline: true },
      { name: "Mise", value: `${amount} pièces`, inline: true },
      { name: "Nouveau solde", value: `${newBalance} pièces`, inline: true },
    );
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = {
  BUTTON_ID,
  MODAL_ID,
  ensurePanel,
  handleButton,
  handleModalSubmit,
};
