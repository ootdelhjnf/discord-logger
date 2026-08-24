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
import { recordTicket, listUserTickets, userStats } from './ticketStore.js';

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

  const open = new ButtonBuilder()
    .setCustomId('ticket_open')
    .setStyle(ButtonStyle.Primary)
    .setLabel('Open a ticket')
    .setEmoji('🎫');

  const history = new ButtonBuilder()
    .setCustomId('ticket_history')
    .setStyle(ButtonStyle.Secondary)
    .setLabel('My past tickets')
    .setEmoji('📁');

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(open, history)] };
}

export const TICKET_STATUS = {
  open: { emoji: '🟢', label: 'Open', colour: 0x3b82f6 },
  resolved: { emoji: '✅', label: 'Resolved', colour: 0x22c55e },
  unresolved: { emoji: '❌', label: 'Closed without solution', colour: 0xef4444 },
};

const HISTORY_PAGE_SIZE = 5;

function statusOf(entry) {
  return TICKET_STATUS[entry.status] ?? TICKET_STATUS.open;
}

function stamp(ms, style = 'f') {
  if (!ms) return 'unknown';
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

function typeOf(entry) {
  return TICKET_TYPES[entry.type] ?? { label: entry.type ?? 'unknown', emoji: '🎫', colour: 0x5865f2 };
}

export async function historyMessage(userId, page = 0, viewerIsOwner = true) {
  const entries = await listUserTickets(userId);
  const stats = await userStats(userId);
  const pages = Math.max(1, Math.ceil(entries.length / HISTORY_PAGE_SIZE));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const slice = entries.slice(current * HISTORY_PAGE_SIZE, current * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(viewerIsOwner ? '📁 Your past tickets' : '📁 Ticket history')
    .setDescription(
      entries.length
        ? slice
            .map((e) => {
              const s = statusOf(e);
              const t = typeOf(e);
              const closed = e.closedAt ? ` · closed ${stamp(e.closedAt, 'R')}` : '';
              return [
                `${s.emoji} **${e.subject || 'no subject'}**`,
                `${t.emoji} ${t.label} · opened ${stamp(e.openedAt, 'R')}${closed}`,
                `Status: **${s.label}**${e.resolution ? ` · ${e.resolution}` : ''}`,
              ].join('\n');
            })
            .join('\n\n')
        : 'No ticket has been opened yet with this account.',
    )
    .addFields(
      { name: 'Total', value: `${stats.total}`, inline: true },
      { name: '✅ Resolved', value: `${stats.resolved}`, inline: true },
      { name: '❌ Not resolved', value: `${stats.unresolved}`, inline: true },
    )
    .setFooter({ text: `Page ${current + 1} of ${pages} · pick a ticket below to see the full details` })
    .setTimestamp(new Date());

  const components = [];

  if (slice.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`ticket_history_view:${userId}:${current}`)
      .setPlaceholder('Open the details of a ticket')
      .addOptions(
        slice.map((e) => ({
          value: e.id,
          label: (e.subject || 'no subject').slice(0, 90),
          description: `${statusOf(e).label} · ${typeOf(e).label}`.slice(0, 90),
          emoji: statusOf(e).emoji,
        })),
      );
    components.push(new ActionRowBuilder().addComponents(menu));
  }

  if (pages > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket_history:${userId}:${current - 1}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('Previous')
          .setEmoji('⬅️')
          .setDisabled(current === 0),
        new ButtonBuilder()
          .setCustomId(`ticket_history:${userId}:${current + 1}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('Next')
          .setEmoji('➡️')
          .setDisabled(current >= pages - 1),
      ),
    );
  }

  return { embeds: [embed], components };
}

export function ticketDetailMessage(entry, backTarget) {
  const s = statusOf(entry);
  const t = typeOf(entry);

  const embed = new EmbedBuilder()
    .setColor(s.colour)
    .setTitle(`${s.emoji} ${entry.subject || 'no subject'}`)
    .addFields(
      { name: 'Category', value: `${t.emoji} ${t.label}`, inline: true },
      { name: 'Status', value: s.label, inline: true },
      { name: 'Ticket ID', value: `\`${entry.id}\``, inline: true },
      { name: 'Opened', value: stamp(entry.openedAt), inline: true },
      { name: 'Closed', value: entry.closedAt ? stamp(entry.closedAt) : 'still open', inline: true },
      { name: 'Closed by', value: entry.closedBy ? `<@${entry.closedBy}>` : '—', inline: true },
    )
    .setTimestamp(new Date());

  if (entry.details) embed.addFields({ name: 'What you wrote', value: entry.details.slice(0, 1024) });
  if (entry.casino) embed.addFields({ name: 'Casino support contacted', value: entry.casino.slice(0, 1024) });
  if (entry.account) embed.addFields({ name: 'Username on the site', value: entry.account.slice(0, 256), inline: true });
  if (entry.resolution) embed.addFields({ name: 'Staff outcome', value: entry.resolution.slice(0, 1024) });
  embed.addFields({
    name: 'Channel',
    value: entry.channelDeleted ? 'deleted by the staff' : `<#${entry.id}>`,
    inline: true,
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_history:${backTarget.userId}:${backTarget.page}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Back to the list')
      .setEmoji('↩️'),
  );

  return { embeds: [embed], components: [row] };
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
    new ButtonBuilder().setCustomId('ticket_anon_toggle').setStyle(ButtonStyle.Primary).setLabel('Anonymous mode').setEmoji('🛡️'),
    new ButtonBuilder().setCustomId('ticket_staff_reply').setStyle(ButtonStyle.Secondary).setLabel('Staff reply').setEmoji('✉️'),
    new ButtonBuilder().setCustomId(`ticket_history:${user.id}:0`).setStyle(ButtonStyle.Secondary).setLabel('Past tickets').setEmoji('📁'),
  );

  await channel.send({
    content: `${user} ${config.staffRoles.map((id) => `<@&${id}>`).join(' ')}`,
    embeds: [embed],
    components: [buttons],
  });

  await recordTicket({
    id: channel.id,
    guildId: guild.id,
    userId: user.id,
    userTag: user.tag,
    type: typeKey,
    subject: answers.subject,
    details: answers.details,
    casino: answers.casino || null,
    account: answers.account || null,
    channelName: channel.name,
    openedAt: Date.now(),
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

export function claimChooser(alias) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('How do you want to claim this ticket?')
    .setDescription(
      [
        `**${alias}** — the user only sees the support team, your name stays hidden.`,
        '**Your name** — the user sees exactly who is handling the ticket.',
        '',
        'Either way the staff log records who claimed it.',
      ].join('\n'),
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_claim:anon').setStyle(ButtonStyle.Primary).setLabel(`Claim as ${alias}`.slice(0, 80)).setEmoji('🛡️'),
    new ButtonBuilder().setCustomId('ticket_claim:named').setStyle(ButtonStyle.Secondary).setLabel('Claim with my name').setEmoji('🙋'),
  );

  return { embeds: [embed], components: [row], ephemeral: true };
}

export function claimAnnouncement(alias, user, anonymous) {
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('🙋 Ticket claimed')
    .setDescription(
      anonymous
        ? `A member of the **${alias}** is now handling this ticket. Please keep the conversation in this channel.`
        : `${user} is now handling this ticket. Please keep the conversation in this channel.`,
    )
    .setTimestamp(new Date());
  return { embeds: [embed] };
}

export function staffToolsPanel(prefix, alias, active, ownerId, relay) {
  const embed = new EmbedBuilder()
    .setColor(active ? 0x22c55e : 0x5865f2)
    .setTitle('🛠️ Staff tools')
    .setDescription(
      [
        active
          ? `You are currently replying as **${alias}** in this ticket.`
          : `You are replying with **your own Discord name** in this ticket.`,
        '',
        `**🛡️ Anonymous mode** — turn the \`${prefix} / ...\` identity on or off`,
        '**✉️ Staff reply** — send one single message under the support identity',
        '**🙋 Claim** — take the ticket and pick how the user sees you',
        relay ? `**Staff relay** — write in ${relay}, the user sees nothing` : '**Staff relay** — created as soon as you enable anonymous mode',
      ].join('\n'),
    )
    .setFooter({ text: 'Only you can see this panel' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_anon_toggle').setStyle(active ? ButtonStyle.Danger : ButtonStyle.Primary).setLabel(active ? 'Anonymous mode: ON' : 'Anonymous mode').setEmoji('🛡️'),
    new ButtonBuilder().setCustomId('ticket_staff_reply').setStyle(ButtonStyle.Secondary).setLabel('Staff reply').setEmoji('✉️'),
    new ButtonBuilder().setCustomId('ticket_claim').setStyle(ButtonStyle.Secondary).setLabel('Claim').setEmoji('🙋'),
  );
  if (ownerId) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`ticket_history:${ownerId}:0`).setStyle(ButtonStyle.Secondary).setLabel('User tickets').setEmoji('📁'),
    );
  }

  return { embeds: [embed], components: [row], ephemeral: true };
}

export function aliasChooser(flow, prefix, defaultAlias, memberName) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🛡️ Which name should the user see?')
    .setDescription(
      [
        `Every option keeps **${prefix}** in front, so the user always knows he is talking to the staff.`,
        '',
        `**${defaultAlias}** — fully anonymous, no personal name`,
        `**${prefix} / ${memberName}** — the user sees a name he can call you by`,
        `**${prefix} / custom** — pick any nickname you want`,
      ].join('\n'),
    );

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ticket_alias_select:${flow}`)
    .setPlaceholder('Choose the identity to reply with')
    .addOptions(
      { value: 'none', label: defaultAlias.slice(0, 90), description: 'No personal name at all', emoji: '🛡️' },
      { value: 'self', label: `${prefix} / ${memberName}`.slice(0, 90), description: 'Your server display name', emoji: '🙋' },
      { value: 'custom', label: `${prefix} / custom alias`.slice(0, 90), description: 'Type the nickname you prefer', emoji: '✏️' },
    );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true };
}

export function aliasModal(flow, prefix) {
  const modal = new ModalBuilder()
    .setCustomId(`ticket_alias_modal:${flow}`)
    .setTitle(`${prefix} / ...`.slice(0, 45));

  const alias = new TextInputBuilder()
    .setCustomId('alias')
    .setLabel('Nickname shown after the prefix')
    .setPlaceholder('Mark')
    .setStyle(TextInputStyle.Short)
    .setMinLength(2)
    .setMaxLength(24)
    .setRequired(true);

  return modal.addComponents(new ActionRowBuilder().addComponents(alias));
}

export function staffReplyModal(alias) {
  const modal = new ModalBuilder()
    .setCustomId('ticket_staff_reply_modal')
    .setTitle(`Reply as ${alias}`.slice(0, 45));

  const message = new TextInputBuilder()
    .setCustomId('message')
    .setLabel('Message sent to the user')
    .setPlaceholder('Write the reply exactly as the user will read it')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(2)
    .setMaxLength(1800)
    .setRequired(true);

  return modal.addComponents(new ActionRowBuilder().addComponents(message));
}

export function staffReplyLog(alias, user, channel, text) {
  return new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle('🛡️ Risposta staff anonima')
    .addFields(
      { name: 'Autore reale', value: `${user} (${user.tag})`, inline: true },
      { name: 'Mostrato come', value: alias, inline: true },
      { name: 'Canale', value: `${channel}`, inline: true },
      { name: 'Messaggio', value: text.slice(0, 1024) },
    )
    .setTimestamp(new Date());
}

export function closeConfirmMessage() {
  const embed = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle('Close this ticket?')
    .setDescription(
      'The channel will be locked and archived. A transcript is saved for the staff.\n\nPick the outcome: it is stored in the ticket history so you can always check later if the issue was solved.',
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close_confirm:resolved').setStyle(ButtonStyle.Success).setLabel('Close as resolved').setEmoji('✅'),
    new ButtonBuilder().setCustomId('ticket_close_confirm:unresolved').setStyle(ButtonStyle.Danger).setLabel('Close without solution').setEmoji('❌'),
    new ButtonBuilder().setCustomId('ticket_close_cancel').setStyle(ButtonStyle.Secondary).setLabel('Cancel'),
  );
  return { embeds: [embed], components: [row], ephemeral: true };
}

export function archivedMessage(closer, resolved, ownerId) {
  const status = resolved ? TICKET_STATUS.resolved : TICKET_STATUS.unresolved;
  const embed = new EmbedBuilder()
    .setColor(status.colour)
    .setTitle(`🔒 Ticket closed · ${status.emoji} ${status.label}`)
    .setDescription(
      `Closed by ${closer}. The channel is now read-only and archived.\n\nThis ticket stays in the history: use **My past tickets** on the support panel to read it again.`,
    )
    .setTimestamp(new Date());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_delete').setStyle(ButtonStyle.Danger).setLabel('Delete channel').setEmoji('🗑️'),
  );
  if (ownerId) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_history:${ownerId}:0`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Past tickets')
        .setEmoji('📁'),
    );
  }
  return { embeds: [embed], components: [row] };
}
