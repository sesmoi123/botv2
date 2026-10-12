const fs = require("node:fs");
const path = require("node:path");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");

const DATA_DIRECTORY = process.env.DATA_DIR?.trim() ? path.resolve(process.env.DATA_DIR.trim()) : path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIRECTORY, "giveaways.json");
const GIVEAWAY_BUTTON_PREFIX = "giveaway:join:";
const DURATION_MS = {
  "1m": 60_000,
  "10m": 10 * 60_000,
  "1h": 60 * 60_000,
  "2h": 2 * 60 * 60_000,
  "3h": 3 * 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "10h": 10 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "3d": 3 * 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "10d": 10 * 24 * 60 * 60_000,
};

function readGiveaways() {
  fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return {};

  const contents = fs.readFileSync(DATA_FILE, "utf8");
  const giveaways = JSON.parse(contents);
  if (!giveaways || typeof giveaways !== "object" || Array.isArray(giveaways)) {
    throw new Error("Le fichier data/giveaways.json doit contenir un objet JSON.");
  }
  return giveaways;
}

let giveaways = readGiveaways();

function saveGiveaways() {
  fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(giveaways, null, 2)}\n`, "utf8");
}

function createJoinRow(messageId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${GIVEAWAY_BUTTON_PREFIX}${messageId}`)
      .setLabel("Participer")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🎉")
      .setDisabled(disabled),
  );
}

function createGiveawayEmbed(giveaway, ended = false, winners = []) {
  const embed = new EmbedBuilder()
    .setColor(ended ? (giveaway.cancelled ? 0xe74c3c : 0x808080) : 0xff69b4)
    .setTitle(`🎉 ${giveaway.title ?? giveaway.theme}`)
    .setDescription(
      giveaway.cancelled
        ? "Giveaway annulé par le staff."
        : ended
          ? winners.length
            ? `Lot : **${giveaway.prize ?? giveaway.theme}**\nGagnant${winners.length > 1 ? "s" : ""} : ${winners.map((id) => `<@${id}>`).join(", ")}`
            : `Giveaway terminé — aucun participant.\nLot : **${giveaway.prize ?? giveaway.theme}**`
          : `**Lot :** ${giveaway.prize ?? giveaway.theme}\nClique sur **Participer** pour tenter ta chance !\n\n**Fin :** <t:${Math.floor(giveaway.endsAt / 1000)}:R>`,
    )
    .addFields(
      { name: "Gagnants", value: String(giveaway.winnerCount), inline: true },
      { name: "Participants", value: String(giveaway.participants.length), inline: true },
    )
    .setTimestamp(new Date(giveaway.endsAt));
  return embed;
}

async function updateGiveawayMessage(client, giveaway, ended = false, winners = []) {
  const guild = await client.guilds.fetch(giveaway.guildId);
  const channel = await guild.channels.fetch(giveaway.channelId);
  if (!channel?.isTextBased()) throw new Error(`Salon du giveaway ${giveaway.messageId} introuvable.`);

  const message = await channel.messages.fetch(giveaway.messageId);
  await message.edit({
    embeds: [createGiveawayEmbed(giveaway, ended, winners)],
    components: [createJoinRow(giveaway.messageId, ended)],
  });
}

async function announceGiveawayResults(client, giveaway, winners, reroll = false) {
  const guild = await client.guilds.fetch(giveaway.guildId);
  const channel = await guild.channels.fetch(giveaway.resultsChannelId);
  if (!channel?.isTextBased() || channel.isDMBased()) {
    throw new Error(`Salon de résultats des giveaways introuvable ou non textuel : ${giveaway.resultsChannelId}`);
  }
  const winnerText = winners.length ? winners.map((id) => `<@${id}>`).join(", ") : "Aucun participant éligible.";
  await channel.send({
    content: `${reroll ? "🎲 Nouveau tirage" : "🎉 Giveaway terminé"} : **${giveaway.title ?? giveaway.theme}** — Lot : **${giveaway.prize ?? giveaway.theme}**\n${winners.length ? `Gagnant${winners.length > 1 ? "s" : ""} : ${winnerText}` : winnerText}`,
    allowedMentions: { users: winners, parse: [] },
  });
  giveaway.resultsAnnouncedAt = Date.now();
  saveGiveaways();
}

async function sendWinnerNotifications(client, giveaway, winners) {
  giveaway.ticketDmsSent ??= [];

  for (const winnerId of winners) {
    if (giveaway.ticketDmsSent.includes(winnerId)) continue;
    try {
      const user = await client.users.fetch(winnerId);
      await user.send({
        content: `🎉 Bien joué ! Tu as gagné **${giveaway.prize ?? giveaway.theme}** dans le giveaway **${giveaway.title ?? giveaway.theme}**. Pour recevoir ton lot, ouvre un ticket sur le serveur.`,
        allowedMentions: { parse: [] },
      });
      giveaway.ticketDmsSent.push(winnerId);
      saveGiveaways();
    } catch (error) {
      console.warn(`Impossible d'envoyer le DM de gain à ${winnerId}; les MP sont peut-être fermés.`, error);
    }
  }
}

async function finishGiveaway(client, messageId) {
  const giveaway = giveaways[messageId];
  if (!giveaway || giveaway.ended) return null;

  const pool = [...giveaway.participants];
  const winners = [];
  while (pool.length && winners.length < giveaway.winnerCount) {
    const index = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(index, 1)[0]);
  }

  giveaway.ended = true;
  giveaway.winners = winners;
  giveaway.drawnWinners = [...winners];
  saveGiveaways();
  try {
    await updateGiveawayMessage(client, giveaway, true, winners);
  } catch (error) {
    console.error(`Impossible de mettre à jour le message du giveaway ${messageId}:`, error);
  }
  try {
    await announceGiveawayResults(client, giveaway, winners);
  } catch (error) {
    console.error(`Impossible d'annoncer les résultats du giveaway ${messageId}:`, error);
  }
  try {
    await sendWinnerNotifications(client, giveaway, winners);
  } catch (error) {
    console.error(`Impossible d'envoyer les annonces de gagnant du giveaway ${messageId}:`, error);
  }
  return winners;
}

async function cancelGiveaway(client, messageId) {
  const giveaway = giveaways[messageId];
  if (!giveaway || giveaway.ended) return false;

  giveaway.ended = true;
  giveaway.cancelled = true;
  giveaway.winners = [];
  saveGiveaways();
  await updateGiveawayMessage(client, giveaway, true, []);
  return true;
}

async function rerollGiveaway(client, messageId) {
  const giveaway = giveaways[messageId];
  if (!giveaway || !giveaway.ended || giveaway.cancelled) return null;

  const previousWinners = new Set(giveaway.drawnWinners ?? giveaway.winners);
  const pool = giveaway.participants.filter((id) => !previousWinners.has(id));
  if (!pool.length) return [];

  const winners = [];
  while (pool.length && winners.length < giveaway.winnerCount) {
    const index = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(index, 1)[0]);
  }

  giveaway.winners = winners;
  giveaway.drawnWinners = [...previousWinners, ...winners];
  saveGiveaways();
  await updateGiveawayMessage(client, giveaway, true, winners);
  try {
    await announceGiveawayResults(client, giveaway, winners, true);
  } catch (error) {
    console.error(`Impossible d'annoncer le nouveau tirage du giveaway ${messageId}:`, error);
  }
  try {
    await sendWinnerNotifications(client, giveaway, winners);
  } catch (error) {
    console.error(`Impossible d'envoyer les annonces de gagnant du giveaway ${messageId}:`, error);
  }
  return winners;
}

function scheduleGiveawayEnd(client, giveaway) {
  const delay = Math.max(0, giveaway.endsAt - Date.now());
  const timer = setTimeout(() => {
    if (giveaway.endsAt > Date.now()) {
      scheduleGiveawayEnd(client, giveaway);
      return;
    }
    finishGiveaway(client, giveaway.messageId).catch((error) => {
      console.error(`Impossible de terminer le giveaway ${giveaway.messageId}:`, error);
    });
  }, Math.min(delay, 2_147_000_000));
  timer.unref();
}

async function restoreGiveawayTimers(client, config) {
  for (const giveaway of Object.values(giveaways)) {
    if (!giveaway.resultsChannelId) giveaway.resultsChannelId = config.giveawayResultsChannelId;
    if (!giveaway.ended) {
      scheduleGiveawayEnd(client, giveaway);
      continue;
    }
    if (!giveaway.cancelled && !giveaway.resultsAnnouncedAt) {
      try {
        await announceGiveawayResults(client, giveaway, giveaway.winners ?? []);
      } catch (error) {
        console.error(`Impossible de reprendre l'annonce des résultats du giveaway ${giveaway.messageId}:`, error);
      }
    }
    if (!giveaway.cancelled) {
      try {
        await sendWinnerNotifications(client, giveaway, giveaway.winners ?? []);
      } catch (error) {
        console.error(`Impossible de reprendre les annonces du giveaway ${giveaway.messageId}:`, error);
      }
    }
  }
  saveGiveaways();
}

async function startGiveaway(interaction, config) {
  const title = interaction.options.getString("titre", true);
  const prize = interaction.options.getString("lot", true);
  const duration = interaction.options.getString("duree", true);
  const durationMs = DURATION_MS[duration];
  if (!durationMs) throw new Error(`Durée de giveaway non reconnue : ${duration}`);
  const winnerCount = interaction.options.getInteger("gagnants", true);
  const startedAt = Date.now();
  const endsAt = startedAt + durationMs;
  const draft = { title, prize, winnerCount, startedAt, endsAt, participants: [] };

  const response = await interaction.reply({
    embeds: [createGiveawayEmbed(draft)],
    withResponse: true,
  });

  const message = response.resource?.message;
  if (!message) throw new Error("Discord n'a pas retourné le message du giveaway.");
  giveaways[message.id] = {
    ...draft,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    resultsChannelId: config.giveawayResultsChannelId,
    messageId: message.id,
    ended: false,
    winners: [],
    drawnWinners: [],
  };
  saveGiveaways();
  scheduleGiveawayEnd(interaction.client, giveaways[message.id]);
  await message.edit({ components: [createJoinRow(message.id)] });
}

async function handleGiveawayButton(interaction) {
  const messageId = interaction.customId.slice(GIVEAWAY_BUTTON_PREFIX.length);
  const giveaway = giveaways[messageId];
  if (
    !giveaway ||
    giveaway.ended ||
    giveaway.endsAt <= Date.now() ||
    interaction.guildId !== giveaway.guildId ||
    interaction.message.id !== giveaway.messageId
  ) {
    await interaction.reply({ content: "Ce giveaway est terminé ou introuvable.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (giveaway.participants.includes(interaction.user.id)) {
    await interaction.reply({ content: "Tu participes déjà à ce giveaway !", flags: MessageFlags.Ephemeral });
    return;
  }
  giveaway.participants.push(interaction.user.id);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  saveGiveaways();
  await interaction.editReply({ content: "Ta participation est enregistrée. Bonne chance !" });
  try {
    await updateGiveawayMessage(interaction.client, giveaway);
  } catch (error) {
    console.error(`Impossible de mettre à jour le giveaway ${messageId}:`, error);
  }
}

module.exports = {
  cancelGiveaway,
  finishGiveaway,
  getGiveawayByMessageId: (messageId) => giveaways[messageId] ?? null,
  handleGiveawayButton,
  rerollGiveaway,
  restoreGiveawayTimers,
  startGiveaway,
};
