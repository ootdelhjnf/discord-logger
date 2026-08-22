import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';

export const TICKET_TYPES = {
  website: {
    label: 'Website issue',
    emoji: '🌐',
    description: 'Bugs, login or access problems on our website',
    colour: 0x3b82f6,
    askCasino: false,
  },
  affiliate: {
    label: 'Affiliate & partnership',
    emoji: '🤝',
    description: 'Sign-up under our code, tracking, collaborations',
    colour: 0x8b5cf6,
    askCasino: true,
  },
  casino: {
    label: 'Promoted casino issue',
    emoji: '🎰',
    description: 'Problems with a site we promote (read the rules first)',
    colour: 0xf59e0b,
    askCasino: true,
  },
  rewards: {
    label: 'Rewards, leaderboard & giveaways',
    emoji: '🏆',
    description: 'Prizes, leaderboard positions, winning slips',
    colour: 0x22c55e,
    askCasino: false,
  },
  report: {
    label: 'Report a user',
    emoji: '🚨',
    description: 'Scams, rule breaking, harassment',
    colour: 0xef4444,
    askCasino: false,
  },
  other: {
    label: 'Something else',
    emoji: '❓',
    description: 'Anything that does not fit the categories above',
    colour: 0x6b7280,
    askCasino: false,
  },
};

const RULES = [
  '**1.** Every ticket must have a **clear and legitimate reason**. Empty, joke or test tickets are closed on sight.',
  '**2.** **We are not a casino.** We have no access to your gaming account, balance, deposits, withdrawals, bonuses or KYC verification.',
  '**3.** For **anything related to your account on a gambling site** you must contact **that site\'s official support first**. Do not open a ticket here before doing so.',
  '**4.** If their support already failed to solve it, open a ticket and **attach their reply**. Without it we cannot help you.',
  '**5.** **One ticket at a time.** Duplicates are deleted without warning.',
  '**6.** Do **not** ask for money, free bonuses, tips or loans. Instant close.',
  '**7.** Explain your issue **immediately**, with screenshots and details. "Hello?" is not a ticket.',
  '**8.** Any abuse, spam or disrespect toward the staff means the ticket is closed and sanctions are applied.',
  '**9.** **18+ only.** Gamble responsibly and never bet money you cannot afford to lose.',
];

export function buildPanel(imageName) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎫 Support Tickets')
    .setDescription(
      [
        'Need to reach the staff? Pick the category that matches your request in the menu below and a **private channel** will be created for you.',
        '',
        '**⚠️ READ THIS BEFORE OPENING A TICKET**',
        '',
        ...RULES,
        '',
        'By opening a ticket you confirm that you have read and accepted the rules above.',
      ].join('\n'),
    )
    .setImage(`attachment://${imageName}`)
    .setFooter({ text: 'Cousik Community · Support' })
    .setTimestamp(new Date());

  const button = new ButtonBuilder()
    .setCustomId('ticket_open')
    .setStyle(ButtonStyle.Primary)
    .setLabel('Open a ticket')
    .setEmoji('🎫');

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
}

export function categoryChooser() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket_select')
    .setPlaceholder('Select the reason for your ticket')
    .addOptions(
      Object.entries(TICKET_TYPES).map(([value, t]) => ({
        value,
        label: t.label,
        description: t.description,
        emoji: t.emoji,
      })),
    );

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('What do you need help with?')
    .setDescription('Choose the category that matches your request. You will then be asked for a few details so the staff can help you straight away.');

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
    ephemeral: true,
  };
}

export function buildModal(typeKey) {
  const type = TICKET_TYPES[typeKey];
  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal:${typeKey}`)
    .setTitle(`${type.label}`.slice(0, 45));

  const subject = new TextInputBuilder()
    .setCustomId('subject')
    .setLabel('Subject')
    .setPlaceholder('Summarise your issue in one line')
    .setStyle(TextInputStyle.Short)
    .setMinLength(6)
    .setMaxLength(100)
    .setRequired(true);

  const details = new TextInputBuilder()
    .setCustomId('details')
    .setLabel('Describe your issue in detail')
    .setPlaceholder('What happened, when, and what you already tried')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(30)
    .setMaxLength(1000)
    .setRequired(true);

  const rows = [
    new ActionRowBuilder().addComponents(subject),
    new ActionRowBuilder().addComponents(details),
  ];

  if (type.askCasino) {
    const casino = new TextInputBuilder()
      .setCustomId('casino')
      .setLabel('Did you contact their support already?')
      .setPlaceholder('Site name + what their support answered')
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(10)
      .setMaxLength(400)
      .setRequired(true);
    rows.push(new ActionRowBuilder().addComponents(casino));
  }

  const username = new TextInputBuilder()
    .setCustomId('account')
    .setLabel('Your username on the site (if relevant)')
    .setPlaceholder('Leave empty if it does not apply')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(80)
    .setRequired(false);
  rows.push(new ActionRowBuilder().addComponents(username));

  return modal.addComponents(...rows);
}

function ticketName(user) {
  const base = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';
  return `ticket-${base}`;
}

export async function findOpenTicket(guild, userId, categoryId) {
  const channels = await guild.channels.fetch();
  return channels.find(
    (c) => c?.type === ChannelType.GuildText
      && c.parentId === categoryId
      && c.topic?.includes(`owner:${userId}`),
  );
}

export async function createTicket(interaction, config, answers, typeKey) {
  const type = TICKET_TYPES[typeKey];
  const { guild, user } = interaction;

  const existing = await findOpenTicket(guild, user.id, config.categoryId);
  if (existing) {
    return { ok: false, message: `You already have an open ticket: ${existing}. Close it before opening a new one.` };
  }

  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    ...config.staffRoles.map((id) => ({
      id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageMessages,
      ],
    })),
  ];

  const channel = await guild.channels.create({
    name: ticketName(user),
    type: ChannelType.GuildText,
    parent: config.categoryId,
    topic: `owner:${user.id} type:${typeKey} opened:${Date.now()}`,
    permissionOverwrites: overwrites,
    reason: `Ticket ${typeKey} aperto da ${user.tag}`,
  });

  const fields = [
    { name: 'Category', value: `${type.emoji} ${type.label}`, inline: true },
    { name: 'Opened by', value: `${user}`, inline: true },
    { name: 'Subject', value: answers.subject },
    { name: 'Details', value: answers.details.slice(0, 1024) },
  ];
  if (answers.casino) fields.push({ name: 'Casino support contacted', value: answers.casino.slice(0, 1024) });
  if (answers.account) fields.push({ name: 'Username on the site', value: answers.account, inline: true });

  const embed = new EmbedBuilder()
    .setColor(type.colour)
    .setTitle(`${type.emoji} ${type.label}`)
    .setDescription(
      'A staff member will reply here as soon as possible. **Do not ping the whole team**, you will only slow things down.\n\nAdd any screenshot or proof right now: the more complete your first message is, the faster this gets solved.',
    )
    .addFields(fields)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `Ticket ID: ${channel.id}` })
    .setTimestamp(new Date());

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setStyle(ButtonStyle.Danger).setLabel('Close ticket').setEmoji('🔒'),
    new ButtonBuilder().setCustomId('ticket_claim').setStyle(ButtonStyle.Secondary).setLabel('Claim').setEmoji('🙋'),
  );

  await channel.send({
    content: `${user} ${config.staffRoles.map((id) => `<@&${id}>`).join(' ')}`,
    embeds: [embed],
    components: [buttons],
  });

  return { ok: true, channel, type };
}

export async function buildTranscript(channel) {
  const collected = [];
  let before;
  for (let i = 0; i < 5; i += 1) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    collected.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }

  const lines = collected
    .reverse()
    .map((m) => {
      const when = new Date(m.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19);
      const attachments = m.attachments.map((a) => a.url).join(' ');
      const embeds = m.embeds.map((e) => `[embed] ${e.title ?? ''} ${e.description ?? ''}`).join(' ');
      return `[${when}] ${m.author.tag}: ${m.content} ${attachments} ${embeds}`.trim();
    });

  const header = `Transcript of #${channel.name}\nChannel ID: ${channel.id}\nGenerated: ${new Date().toISOString()}\nMessages: ${lines.length}\n${'='.repeat(60)}\n\n`;
  return new AttachmentBuilder(Buffer.from(header + lines.join('\n'), 'utf8'), {
    name: `transcript-${channel.name}-${channel.id}.txt`,
  });
}

export function closeConfirmMessage() {
  const embed = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle('Close this ticket?')
    .setDescription('The channel will be locked and archived. A transcript is saved for the staff.');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close_confirm').setStyle(ButtonStyle.Danger).setLabel('Yes, close it').setEmoji('🔒'),
    new ButtonBuilder().setCustomId('ticket_close_cancel').setStyle(ButtonStyle.Secondary).setLabel('Cancel'),
  );
  return { embeds: [embed], components: [row], ephemeral: true };
}

export function archivedMessage(closer) {
  const embed = new EmbedBuilder()
    .setColor(0x6b7280)
    .setTitle('🔒 Ticket closed')
    .setDescription(`Closed by ${closer}. The channel is now read-only and archived.`)
    .setTimestamp(new Date());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_delete').setStyle(ButtonStyle.Danger).setLabel('Delete channel').setEmoji('🗑️'),
  );
  return { embeds: [embed], components: [row] };
}
