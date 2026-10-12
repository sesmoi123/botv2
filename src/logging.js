async function logToChannel(client, config, category, details) {
  const channelId = config.securityLogChannelId;
  if (!channelId) return;

  try {
    const channel = client.channels.cache.get(channelId) ?? await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || channel.isDMBased() || channel.guildId !== config.guildId) {
      throw new Error(`Salon de logs invalide ou hors serveur : ${channelId}`);
    }

    await channel.send({
      content: `📋 **${category}** — ${details}`.slice(0, 2000),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error(`Impossible d'envoyer un log dans le salon ${channelId}:`, error);
  }
}

module.exports = { logToChannel };
