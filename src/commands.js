const { SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Supprime un nombre de messages (maximum 100).")
    .addIntegerOption((option) =>
      option
        .setName("nombre")
        .setDescription("Nombre de messages à supprimer.")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Gère les giveaways.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("start")
        .setDescription("Lance un giveaway avec un titre, un lot, une durée et des gagnants.")
        .addStringOption((option) =>
          option.setName("titre").setDescription("Titre du giveaway.").setMaxLength(200).setRequired(true),
        )
        .addStringOption((option) =>
          option.setName("lot").setDescription("Nom de la récompense à gagner.").setMaxLength(200).setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("duree")
            .setDescription("Durée du giveaway.")
            .addChoices(
              { name: "1 minute", value: "1m" },
              { name: "10 minutes", value: "10m" },
              { name: "1 heure", value: "1h" },
              { name: "2 heures", value: "2h" },
              { name: "3 heures", value: "3h" },
              { name: "6 heures", value: "6h" },
              { name: "10 heures", value: "10h" },
              { name: "12 heures", value: "12h" },
              { name: "24 heures", value: "24h" },
              { name: "3 jours", value: "3d" },
              { name: "7 jours", value: "7d" },
              { name: "10 jours", value: "10d" },
            )
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("gagnants")
            .setDescription("Nombre de gagnants.")
            .setMinValue(1)
            .setMaxValue(20)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("reroll")
        .setDescription("Tire de nouveaux gagnants parmi les participants.")
        .addStringOption((option) =>
          option.setName("message_id").setDescription("ID du message du giveaway terminé.").setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("cancel")
        .setDescription("Annule un giveaway en cours.")
        .addStringOption((option) =>
          option.setName("message_id").setDescription("ID du message du giveaway.").setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("end")
        .setDescription("Termine un giveaway immédiatement.")
        .addStringOption((option) =>
          option.setName("message_id").setDescription("ID du message du giveaway.").setRequired(true),
        ),
    ),
  new SlashCommandBuilder()
    .setName("protection")
    .setDescription("Affiche les protections automatiques du serveur.")
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Affiche les réglages anti-spam, anti-raid et anti-liens."),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("lockdown").setDescription("Active le mode de vérification renforcée pendant la durée configurée."),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("unlock").setDescription("Désactive le mode de vérification renforcée et restaure le réglage précédent."),
    ),
  new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("Affiche le nombre de pièces de ton compte."),
  new SlashCommandBuilder()
    .setName("givepiece")
    .setDescription("Donne des pièces à un membre du serveur.")
    .addUserOption((option) =>
      option.setName("membre").setDescription("Membre qui reçoit des pièces.").setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("pieces")
        .setDescription("Nombre de pièces à ajouter.")
        .setMinValue(1)
        .setMaxValue(1000000)
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("gift")
    .setDescription("Donne des pièces à quelqu'un si tu as le rôle ARSAL.")
    .addUserOption((option) =>
      option.setName("membre").setDescription("Membre qui reçoit les pièces.").setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("pieces")
        .setDescription("Nombre de pièces à donner.")
        .setMinValue(1)
        .setMaxValue(1000000)
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("deletepiece")
    .setDescription("Crée un bouton qui retire un montant précis de pièces à chaque clic.")
    .addIntegerOption((option) =>
      option
        .setName("pieces")
        .setDescription("Nombre de pièces à retirer à chaque utilisation.")
        .setMinValue(1)
        .setMaxValue(1000000)
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("utilisations")
        .setDescription("Nombre de clics autorisés avant fermeture du bouton.")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("createbuypanel")
    .setDescription("Publie un panneau d'achat dans un salon avec un nombre d'utilisations optionnel.")
    .addChannelOption((option) =>
      option.setName("salon").setDescription("Salon où publier le panneau.").setRequired(true),
    )
    .addIntegerOption((option) =>
      option.setName("utilisations").setDescription("Nombre d'utilisations autorisées (laisser vide pour illimité)."),
    ),
  new SlashCommandBuilder()
    .setName("check")
    .setDescription("Commandes de vérification.")
    .addSubcommand((subcommand) =>
      subcommand.setName("inventory").setDescription("Affiche le nombre de pièces de ton compte."),
    ),
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Ouvre ou configure les tickets.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("panel")
        .setDescription("Publie le panneau d'ouverture de ticket.")
        .addChannelOption((option) =>
          option.setName("salon").setDescription("Salon où publier le panneau (par défaut : ici)."),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("close").setDescription("Ferme le ticket dans lequel la commande est utilisée."),
    ),
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Bannit un membre du serveur.")
    .addUserOption((option) =>
      option.setName("membre").setDescription("Membre à bannir.").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("raison").setDescription("Raison du bannissement.").setMaxLength(500),
    ),
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Expulse un membre du serveur.")
    .addUserOption((option) =>
      option.setName("membre").setDescription("Membre à expulser.").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("raison").setDescription("Raison de l'expulsion.").setMaxLength(500),
    ),
];

module.exports = commands.map((command) => command.toJSON());
