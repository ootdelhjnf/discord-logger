import { createServer } from 'node:http';
import { createVerification, handleVerify, pendingCount } from './verify.js';
import { buildLiveMessage, buildLiveAnnouncement } from './live.js';
import { readLiveState, writeLiveState } from './liveState.js';
import {
  buildPanel,
  buildModal,
  createTicket,
  buildTranscript,
  closeConfirmMessage,
  archivedMessage,
  categoryChooser,
  historyMessage,
  ticketDetailMessage,
  TICKET_TYPES,
} from './tickets.js';
import { getTicket, markClosed, markDeleted } from './ticketStore.js';
import { startCodeStream, buildCodeMessage, expiredCodeMessage, redeemInstructions } from './codes.js';
import { getCodesState, setCodesChannel, filterNewCodes, markSeen, addPosted, takeExpiredPosts } from './codesStore.js';
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AuditLogEvent,
  MessageFlags,
  ChannelType,
  PermissionFlagsBits,
  time,
} from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const AUTO_ROLE_ID = process.env.AUTO_ROLE_ID;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const VERIFY_ENABLED = process.env.VERIFY_ENABLED === 'true';
const KICK_SLUG = process.env.KICK_SLUG;
const KICK_COUNTER_CHANNEL_ID = process.env.KICK_COUNTER_CHANNEL_ID;
const KICK_REFRESH_MS = Number(process.env.KICK_REFRESH_MS) || 3 * 60 * 1000;
const LIVE_CHANNEL_ID = process.env.LIVE_CHANNEL_ID;
const LIVE_ANNOUNCE_CHANNEL_ID = process.env.LIVE_ANNOUNCE_CHANNEL_ID;
const LIVE_ANNOUNCE_CHANNEL_NAME = process.env.LIVE_ANNOUNCE_CHANNEL_NAME || 'live-alerts';
const LIVE_ANNOUNCE_CATEGORY_ID = process.env.LIVE_ANNOUNCE_CATEGORY_ID;
const LIVE_ANNOUNCE_AUTOCREATE = process.env.LIVE_ANNOUNCE_AUTOCREATE !== 'false';
const LIVE_ANNOUNCE_LOCK = process.env.LIVE_ANNOUNCE_LOCK !== 'false';
let announceChannelId = null;
const LIVE_PING_ROLE_ID = process.env.LIVE_PING_ROLE_ID;
const LIVE_ANNOUNCE_MENTION = (process.env.LIVE_ANNOUNCE_MENTION || 'everyone').toLowerCase();
const LIVE_ANNOUNCE_COOLDOWN_MS = (Number(process.env.LIVE_ANNOUNCE_COOLDOWN_MIN) || 60) * 60 * 1000;
const LIVE_ANNOUNCE_REPEATS = Math.max(1, Number(process.env.LIVE_ANNOUNCE_REPEATS ?? 3));
const LIVE_ANNOUNCE_REPEAT_EVERY_MS = (Number(process.env.LIVE_ANNOUNCE_REPEAT_EVERY_MIN) || 8) * 60 * 1000;
const LIVE_ANNOUNCE_WINDOW_MS = (Number(process.env.LIVE_ANNOUNCE_WINDOW_MIN) || 20) * 60 * 1000;
const LIVE_ANNOUNCE_TTL_MS = (Number(process.env.LIVE_ANNOUNCE_DELETE_AFTER_MIN ?? 20)) * 60 * 1000;
const liveAnnouncementIds = new Set();
const RENAME_MIN_INTERVAL_MS = 10 * 60 * 1000;
let liveMessageId = null;
let lastRenameAt = 0;
const CODES_ENABLED = process.env.CODES_ENABLED !== 'false';
const CODES_BRANDS = (process.env.CODES_BRANDS || 'shuffle,shuffleus')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const CODES_CHANNEL_ID = process.env.CODES_CHANNEL_ID;
const CODES_CHANNEL_NAME = process.env.CODES_CHANNEL_NAME || 'code-drops';
const CODES_CATEGORY_ID = process.env.CODES_CATEGORY_ID;
const CODES_PING_ROLE_ID = process.env.CODES_PING_ROLE_ID;
const CODES_MENTION = (process.env.CODES_MENTION || 'role').toLowerCase();
const CODES_MIN_VALUE = Number(process.env.CODES_MIN_VALUE) || 0;
const CODES_REDEEM_URL = process.env.CODES_REDEEM_URL || 'https://shuffle.com';
const CODES_TOPIC = 'Automatic Shuffle code drops from fairgambling.com/livecodes';
const CODES_WEBHOOK_NAME = process.env.CODES_WEBHOOK_NAME || 'Code Drops';
const CODES_WEBHOOK_ENABLED = process.env.CODES_WEBHOOK !== 'false';
let codesChannelId = null;
let codesWebhook = null;
const codeMessageIds = new Set();

const TICKET_CONFIG = {
  categoryId: process.env.TICKET_CATEGORY_ID,
  archiveCategoryId: process.env.TICKET_ARCHIVE_CATEGORY_ID,
  logChannelId: process.env.TICKET_LOG_CHANNEL_ID,
  staffRoles: (process.env.TICKET_STAFF_ROLES || '').split(',').map((s) => s.trim()).filter(Boolean),
};
const TICKET_BANNER = 'server-banner.gif';
const NO_REACTION_CHANNELS = (process.env.NO_REACTION_CHANNELS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const PUBLIC_URL = (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '');

if (!TOKEN || !GUILD_ID || !LOG_CHANNEL_ID) {
  console.error('Mancano DISCORD_TOKEN, GUILD_ID o LOG_CHANNEL_ID nel file .env');
  process.exit(1);
}

const VIEW = { size: 512, extension: 'png', forceStatic: false };
const FULL = { size: 4096, extension: 'png', forceStatic: false };

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.GuildMember, Partials.User, Partials.Message, Partials.Reaction, Partials.Channel],
});

async function getLogChannel() {
  const channel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.error('Canale di log non trovato o non testuale:', LOG_CHANNEL_ID);
    return null;
  }
  return channel;
}

async function send(embed, buttons = []) {
  const channel = await getLogChannel();
  if (!channel) return;
  const components = buttons.length
    ? [new ActionRowBuilder().addComponents(...buttons.slice(0, 5))]
    : [];
  await channel
    .send({ embeds: [embed], components })
    .catch((err) => console.error('Invio fallito:', err.message));
}

function linkButton(label, url, emoji) {
  const b = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url);
  if (emoji) b.setEmoji(emoji);
  return b;
}

async function freshUser(userOrId) {
  const id = typeof userOrId === 'string' ? userOrId : userOrId.id;
  const fetched = await client.users.fetch(id, { force: true }).catch(() => null);
  return fetched ?? (typeof userOrId === 'string' ? null : userOrId);
}

function avatarSources(user, member) {
  const global = user.displayAvatarURL(VIEW);
  const server = member?.avatar ? member.displayAvatarURL(VIEW) : null;
  return { global, server, shown: server ?? global };
}

function baseEmbed(user, member) {
  const { shown } = avatarSources(user, member);
  return new EmbedBuilder()
    .setAuthor({ name: user.tag, iconURL: shown })
    .setThumbnail(shown)
    .setImage(shown)
    .setFooter({ text: `ID: ${user.id}`, iconURL: shown })
    .setTimestamp(new Date());
}

function identityField(user, member) {
  const rows = [`Username: \`@${user.username}\``];
  if (user.globalName) rows.push(`Nome visualizzato: **${user.globalName}**`);
  if (member?.nickname) rows.push(`Nickname nel server: **${member.nickname}**`);
  return rows.join('\n');
}

function socialField(user) {
  const items = [];
  if (user.bannerURL?.(VIEW)) items.push(`[Banner del profilo](${user.bannerURL(FULL)})`);
  if (user.accentColor) items.push(`Colore profilo \`#${user.accentColor.toString(16).padStart(6, '0')}\``);
  if (user.flags?.toArray?.().length) items.push(`Badge: ${user.flags.toArray().join(', ')}`);
  items.push(`[Apri profilo](https://discord.com/users/${user.id})`);
  return items.join('\n');
}

async function grantRole(member, roleId, reason) {
  if (!roleId) return null;

  const role = member.guild.roles.cache.get(roleId)
    ?? (await member.guild.roles.fetch(roleId).catch(() => null));
  if (!role) return { ok: false, text: `ruolo ${roleId} inesistente` };

  if (member.roles.cache.has(roleId)) return { ok: true, text: 'gia presente', role };

  const me = await member.guild.members.fetchMe();
  if (!me.permissions.has('ManageRoles')) {
    return { ok: false, text: "manca il permesso 'Gestisci ruoli' al bot" };
  }
  if (role.position >= me.roles.highest.position) {
    return { ok: false, text: `${role.name} e piu in alto del ruolo del bot` };
  }
  if (role.managed) return { ok: false, text: `${role.name} e gestito da un'integrazione` };

  try {
    await member.roles.add(role, reason);
    return { ok: true, text: `${role} assegnato`, role };
  } catch (err) {
    return { ok: false, text: err.message };
  }
}

async function assignAutoRole(member) {
  return grantRole(member, AUTO_ROLE_ID, 'Autorole ingresso');
}

async function findRemovalReason(guild, userId) {
  const me = await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has('ViewAuditLog')) return null;

  const types = [AuditLogEvent.MemberKick, AuditLogEvent.MemberBanAdd];
  for (const type of types) {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 }).catch(() => null);
    const entry = logs?.entries.find(
      (e) => e.target?.id === userId && Date.now() - e.createdTimestamp < 10_000,
    );
    if (entry) {
      return {
        action: type === AuditLogEvent.MemberKick ? 'Espulso (kick)' : 'Bannato',
        executor: entry.executor ? `${entry.executor.tag}` : 'sconosciuto',
        reason: entry.reason || 'nessuna motivazione',
      };
    }
  }
  return null;
}

client.once('clientReady', async () => {
  console.log(`Bot online come ${client.user.tag}`);

  const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
  if (!guild) {
    console.error(`Il bot NON e' nel server ${GUILD_ID}. Invitalo con l'URL OAuth2.`);
    return;
  }
  console.log(`Server: ${guild.name}`);

  const channel = await getLogChannel();
  if (!channel) return;
  console.log(`Canale di log: #${channel.name}`);

  const me = await guild.members.fetchMe();
  const perms = channel.permissionsFor(me);
  const missing = ['ViewChannel', 'SendMessages', 'EmbedLinks'].filter((p) => !perms.has(p));
  if (missing.length) {
    console.error(`Permessi mancanti sul canale: ${missing.join(', ')}`);
    return;
  }
  if (!me.permissions.has('ViewAuditLog')) {
    console.warn("Permesso 'Visualizza registro attivita' mancante: niente motivo kick/ban.");
  }

  if (AUTO_ROLE_ID) {
    const role = await guild.roles.fetch(AUTO_ROLE_ID).catch(() => null);
    if (!role) console.error(`Autorole: ruolo ${AUTO_ROLE_ID} non trovato.`);
    else if (!me.permissions.has('ManageRoles')) console.error(`Autorole '${role.name}': manca il permesso 'Gestisci ruoli'.`);
    else if (role.position >= me.roles.highest.position) console.error(`Autorole '${role.name}': e sopra al ruolo del bot.`);
    else console.log(`Autorole attivo: ${role.name}`);
  }

  const members = await guild.members.fetch().catch(() => null);
  if (!members) {
    console.error('SERVER MEMBERS INTENT non attivo nel Developer Portal: gli eventi non arriveranno.');
    return;
  }
  console.log(`Intent membri OK — ${members.size} membri in cache. Logger attivo.`);

  if (KICK_SLUG) {
    await ensureAnnounceChannel(guild);
    trackAnnouncements((await readLiveState()).messages);
    await pollKick();
    setInterval(pollKick, KICK_REFRESH_MS);
    console.log(`Monitor Kick attivo su ${KICK_SLUG}, controllo ogni ${KICK_REFRESH_MS / 60000} minuti`);
    if (announceChannelId) {
      console.log(`Annunci live in <#${announceChannelId}> con ping ${liveMention() || 'disattivato'}`);
    }
  }

  if (CODES_ENABLED) {
    await ensureCodesChannel(guild);
    if (codesChannelId) {
      const state = await getCodesState();
      for (const post of state.posted ?? []) codeMessageIds.add(post.id);
      await sweepExpiredCodes();
      setInterval(() => sweepExpiredCodes().catch(() => null), 60_000).unref?.();
      startCodeStream({
        onCodes: (codes) => handleIncomingCodes(codes).catch((err) => console.error('Gestione codici fallita:', err.message)),
        onLog: (msg) => console.log(`[codes] ${msg}`),
      });
      console.log(`Code drops attivi in <#${codesChannelId}> per: ${CODES_BRANDS.join(', ')}`);
    }
  }
});

client.on('guildMemberAdd', async (member) => {
  if (member.guild.id !== GUILD_ID) return;

  const user = await freshUser(member.user);
  const created = user.createdAt;
  const ageDays = Math.floor((Date.now() - created.getTime()) / 86_400_000);
  const { global, server } = avatarSources(user, member);

  const embed = baseEmbed(user, member)
    .setColor(0x2ecc71)
    .setTitle('Entrato nel server')
    .setDescription(`${member} — **${user.tag}**`)
    .addFields(
      { name: 'Identita', value: identityField(user, member) },
      { name: 'Account creato', value: `${time(created, 'f')} (${ageDays} giorni fa)`, inline: true },
      { name: 'Membri totali', value: `${member.guild.memberCount}`, inline: true },
      { name: 'Collegamenti', value: socialField(user) },
    );

  if (ageDays < 7) {
    embed.addFields({ name: 'Attenzione', value: 'Account molto recente', inline: true });
  }

  if (VERIFY_ENABLED) {
    const outcome = await startVerification(member);
    embed.addFields({ name: 'Verifica captcha', value: outcome });
  } else if (!member.pending) {
    const auto = await assignAutoRole(member);
    if (auto) {
      embed.addFields({ name: auto.ok ? 'Ruolo automatico' : 'Ruolo automatico fallito', value: auto.text });
    }
  } else {
    embed.addFields({
      name: 'Ruolo automatico',
      value: 'in attesa: deve accettare le regole del server',
    });
  }

  const buttons = [linkButton('Scarica immagine', user.displayAvatarURL(FULL), '⬇️')];
  if (server) buttons.push(linkButton('Scarica avatar server', member.displayAvatarURL(FULL), '⬇️'));
  buttons.push(linkButton('Profilo', `https://discord.com/users/${user.id}`, '👤'));

  await send(embed, buttons);
});

client.on('guildMemberRemove', async (member) => {
  if (member.guild.id !== GUILD_ID) return;

  const user = await freshUser(member.user ?? member.id);
  if (!user) return;

  const roles = member.roles?.cache
    ?.filter((r) => r.id !== member.guild.id)
    .sort((a, b) => b.position - a.position)
    .map((r) => r.name)
    .slice(0, 15);

  const embed = baseEmbed(user, member)
    .setColor(0xe74c3c)
    .setTitle('Uscito dal server')
    .setDescription(`**${user.tag}**`)
    .addFields(
      { name: 'Identita', value: identityField(user, member) },
      { name: 'Membri totali', value: `${member.guild.memberCount}`, inline: true },
    );

  if (member.joinedAt) {
    embed.addFields({ name: 'Era entrato il', value: time(member.joinedAt, 'f'), inline: true });
  }
  if (roles?.length) {
    embed.addFields({ name: 'Ruoli che aveva', value: roles.join(', ').slice(0, 1024) });
  }
  embed.addFields({ name: 'Collegamenti', value: socialField(user) });

  const removal = await findRemovalReason(member.guild, member.id);
  if (removal) {
    embed.addFields({
      name: removal.action,
      value: `da **${removal.executor}**\nMotivo: ${removal.reason}`,
    });
  }

  const buttons = [linkButton('Scarica immagine', user.displayAvatarURL(FULL), '⬇️')];
  if (member.avatar) buttons.push(linkButton('Scarica avatar server', member.displayAvatarURL(FULL), '⬇️'));
  buttons.push(linkButton('Profilo', `https://discord.com/users/${user.id}`, '👤'));

  await send(embed, buttons);
});

client.on('userUpdate', async (oldUser, newUser) => {
  const guild = client.guilds.cache.get(GUILD_ID);
  const member = guild?.members.cache.get(newUser.id);
  if (!member) return;

  const changedName = oldUser.username !== newUser.username;
  const changedGlobal = oldUser.globalName !== newUser.globalName;
  const changedAvatar = oldUser.avatar !== newUser.avatar;
  const changedBanner = oldUser.banner !== newUser.banner;
  if (!changedName && !changedGlobal && !changedAvatar && !changedBanner) return;

  const oldAvatar = oldUser.displayAvatarURL(VIEW);
  const newAvatar = newUser.displayAvatarURL(VIEW);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('Profilo aggiornato')
    .setDescription(`${member} — **${newUser.tag}**`)
    .setAuthor({ name: newUser.tag, iconURL: newAvatar })
    .setThumbnail(oldAvatar)
    .setImage(newAvatar)
    .setFooter({ text: `ID: ${newUser.id} · sinistra = prima, grande = adesso`, iconURL: newAvatar })
    .setTimestamp(new Date());

  const buttons = [];

  if (changedName) {
    embed.addFields({
      name: 'Username cambiato',
      value: `Vecchio: \`@${oldUser.username}\`\nNuovo: \`@${newUser.username}\``,
    });
  }
  if (changedGlobal) {
    embed.addFields({
      name: 'Nome visualizzato cambiato',
      value: `Vecchio: **${oldUser.globalName ?? 'nessuno'}**\nNuovo: **${newUser.globalName ?? 'nessuno'}**`,
    });
  }
  if (changedAvatar) {
    embed.addFields({
      name: 'Immagine profilo cambiata',
      value: `[Vecchia immagine](${oldUser.displayAvatarURL(FULL)})\n[Nuova immagine](${newUser.displayAvatarURL(FULL)})`,
    });
    buttons.push(
      linkButton('Scarica vecchia', oldUser.displayAvatarURL(FULL), '⬅️'),
      linkButton('Scarica nuova', newUser.displayAvatarURL(FULL), '⬇️'),
    );
  }
  if (changedBanner) {
    const before = oldUser.bannerURL?.(FULL);
    const after = newUser.bannerURL?.(FULL);
    embed.addFields({
      name: 'Banner cambiato',
      value: [
        before ? `[Vecchio banner](${before})` : 'Vecchio: nessuno',
        after ? `[Nuovo banner](${after})` : 'Nuovo: rimosso',
      ].join('\n'),
    });
    if (after) buttons.push(linkButton('Scarica banner', after, '🖼️'));
  }

  embed.addFields({ name: 'Collegamenti', value: socialField(newUser) });
  buttons.push(linkButton('Profilo', `https://discord.com/users/${newUser.id}`, '👤'));

  await send(embed, buttons);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  if (newMember.guild.id !== GUILD_ID) return;

  if (oldMember.pending && !newMember.pending) {
    const auto = await assignAutoRole(newMember);
    if (auto) {
      const embed = new EmbedBuilder()
        .setColor(auto.ok ? 0x2ecc71 : 0xe67e22)
        .setTitle(auto.ok ? 'Regole accettate — ruolo assegnato' : 'Regole accettate — ruolo NON assegnato')
        .setDescription(`${newMember} — **${newMember.user.tag}**`)
        .setThumbnail(newMember.displayAvatarURL(VIEW))
        .addFields({ name: 'Esito', value: auto.text })
        .setFooter({ text: `ID: ${newMember.id}` })
        .setTimestamp(new Date());
      await send(embed);
    }
  }

  const changedAvatar = oldMember.avatar !== newMember.avatar;
  const changedNick = oldMember.nickname !== newMember.nickname;
  if (!changedAvatar && !changedNick) return;

  const shown = newMember.displayAvatarURL(VIEW);
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('Profilo del server aggiornato')
    .setDescription(`${newMember} — **${newMember.user.tag}**`)
    .setAuthor({ name: newMember.user.tag, iconURL: shown })
    .setThumbnail(oldMember.displayAvatarURL(VIEW))
    .setImage(shown)
    .setFooter({ text: `ID: ${newMember.id} · sinistra = prima, grande = adesso`, iconURL: shown })
    .setTimestamp(new Date());

  const buttons = [];

  if (changedNick) {
    embed.addFields({
      name: 'Nickname nel server cambiato',
      value: `Vecchio: **${oldMember.nickname ?? 'nessuno'}**\nNuovo: **${newMember.nickname ?? 'nessuno'}**`,
    });
  }
  if (changedAvatar) {
    embed.addFields({
      name: 'Avatar del server cambiato',
      value: `[Vecchia immagine](${oldMember.displayAvatarURL(FULL)})\n[Nuova immagine](${newMember.displayAvatarURL(FULL)})`,
    });
    buttons.push(
      linkButton('Scarica vecchia', oldMember.displayAvatarURL(FULL), '⬅️'),
      linkButton('Scarica nuova', newMember.displayAvatarURL(FULL), '⬇️'),
    );
  }

  embed.addFields({ name: 'Collegamenti', value: socialField(newMember.user) });
  buttons.push(linkButton('Profilo', `https://discord.com/users/${newMember.id}`, '👤'));

  await send(embed, buttons);
});

let kickState = { followers: null, live: false, name: null, updatedAt: null };

async function updateLiveMessage(data) {
  if (!LIVE_CHANNEL_ID) return;

  const channel = await client.channels.fetch(LIVE_CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.error('Canale live non trovato');
    return;
  }

  const payload = buildLiveMessage(data, KICK_SLUG);

  if (!liveMessageId) {
    const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    const mine = recent?.find((m) => m.author.id === client.user.id && m.embeds.length);
    if (mine) liveMessageId = mine.id;
  }

  if (liveMessageId) {
    const existing = await channel.messages.fetch(liveMessageId).catch(() => null);
    if (existing) {
      await existing.edit(payload).catch((err) => console.error('Aggiornamento live fallito:', err.message));
      return;
    }
    liveMessageId = null;
  }

  const sent = await channel.send(payload).catch((err) => {
    console.error('Invio messaggio live fallito:', err.message);
    return null;
  });
  if (sent) {
    liveMessageId = sent.id;
    console.log(`messaggio live creato: ${sent.id}`);
  }
}

function liveMention() {
  if (LIVE_PING_ROLE_ID) return `<@&${LIVE_PING_ROLE_ID}>`;
  if (LIVE_ANNOUNCE_MENTION === 'none') return '';
  if (LIVE_ANNOUNCE_MENTION === 'here') return '@here';
  return '@everyone';
}

function liveAllowedMentions() {
  if (LIVE_PING_ROLE_ID) return { roles: [LIVE_PING_ROLE_ID], parse: [] };
  if (LIVE_ANNOUNCE_MENTION === 'none') return { parse: [] };
  return { parse: ['everyone'] };
}

function liveTopic() {
  return `Automatic notifications when ${KICK_SLUG} goes live on Kick`;
}

async function lockReadOnlyChannel(channel) {
  if (!LIVE_ANNOUNCE_LOCK) return;
  const me = await channel.guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) return;

  await channel.permissionOverwrites
    .edit(channel.guild.id, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: false,
      AddReactions: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
      SendMessagesInThreads: false,
    }, { reason: 'Canale annunci live in sola lettura' })
    .catch((err) => console.error('Blocco canale annunci fallito:', err.message));

  await channel.permissionOverwrites
    .edit(me.id, {
      ViewChannel: true,
      SendMessages: true,
      EmbedLinks: true,
      ManageMessages: true,
      MentionEveryone: true,
    }, { reason: 'Permessi bot canale annunci live' })
    .catch(() => null);
}

async function ensureAnnounceChannel(guild) {
  if (LIVE_ANNOUNCE_CHANNEL_ID) {
    const configured = await guild.channels.fetch(LIVE_ANNOUNCE_CHANNEL_ID).catch(() => null);
    if (configured) {
      announceChannelId = configured.id;
      await lockReadOnlyChannel(configured);
      return;
    }
    console.error('LIVE_ANNOUNCE_CHANNEL_ID non valido:', LIVE_ANNOUNCE_CHANNEL_ID);
  }

  if (!LIVE_ANNOUNCE_AUTOCREATE) {
    announceChannelId = LIVE_CHANNEL_ID ?? null;
    return;
  }

  const state = await readLiveState();
  let channel = state.announceChannelId
    ? await guild.channels.fetch(state.announceChannelId).catch(() => null)
    : null;

  if (!channel) {
    const all = await guild.channels.fetch().catch(() => null);
    channel = all?.find(
      (c) => c?.type === ChannelType.GuildText
        && (c.name === LIVE_ANNOUNCE_CHANNEL_NAME || c.topic === liveTopic()),
    ) ?? null;
  }

  if (!channel) {
    channel = await guild.channels
      .create({
        name: LIVE_ANNOUNCE_CHANNEL_NAME,
        type: ChannelType.GuildText,
        parent: LIVE_ANNOUNCE_CATEGORY_ID || undefined,
        topic: liveTopic(),
        reason: 'Canale dedicato agli annunci live',
      })
      .catch((err) => {
        console.error('Creazione canale annunci fallita:', err.message);
        return null;
      });
    if (channel) console.log(`canale annunci live creato: #${channel.name} (${channel.id})`);
  }

  if (!channel) {
    announceChannelId = LIVE_CHANNEL_ID ?? null;
    return;
  }

  await lockReadOnlyChannel(channel);
  announceChannelId = channel.id;
  if (state.announceChannelId !== channel.id) await writeLiveState({ announceChannelId: channel.id });
}

function trackAnnouncements(refs) {
  liveAnnouncementIds.clear();
  for (const ref of refs ?? []) liveAnnouncementIds.add(ref.id);
}

async function deleteAnnouncement(ref) {
  liveAnnouncementIds.delete(ref.id);
  const channel = await client.channels.fetch(ref.channelId).catch(() => null);
  const message = await channel?.messages?.fetch(ref.id).catch(() => null);
  if (message) await message.delete().catch(() => null);
}

async function pruneAnnouncements(all = false) {
  const state = await readLiveState();
  const refs = state.messages ?? [];
  if (!refs.length) return refs;

  const keep = [];
  for (const ref of refs) {
    const expired = all || (LIVE_ANNOUNCE_TTL_MS > 0 && Date.now() - ref.sentAt >= LIVE_ANNOUNCE_TTL_MS);
    if (expired) await deleteAnnouncement(ref);
    else keep.push(ref);
  }
  if (keep.length !== refs.length) {
    await writeLiveState({ messages: keep });
    console.log(`annunci live rimossi: ${refs.length - keep.length}`);
  }
  trackAnnouncements(keep);
  return keep;
}

async function sendAnnouncement(raw, sessionId, reminder) {
  const channel = await client.channels.fetch(announceChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.error('Canale annuncio live non trovato:', announceChannelId);
    return;
  }

  const expiresAt = LIVE_ANNOUNCE_TTL_MS > 0 ? Date.now() + LIVE_ANNOUNCE_TTL_MS : null;
  const payload = buildLiveAnnouncement(raw, KICK_SLUG, {
    mention: liveMention(),
    pingRoleId: LIVE_PING_ROLE_ID,
    reminder,
    expiresAt,
  });

  const sent = await channel
    .send({ ...payload, allowedMentions: liveAllowedMentions() })
    .catch((err) => {
      console.error('Annuncio live fallito:', err.message);
      return null;
    });
  if (!sent) return;
  if (sent.crosspostable) await sent.crosspost().catch(() => null);

  const state = await readLiveState();
  const ref = { channelId: sent.channelId, id: sent.id, sentAt: Date.now() };
  liveAnnouncementIds.add(sent.id);
  await writeLiveState({
    live: true,
    sessionId,
    messages: [...(state.messages ?? []), ref],
    announcedAt: reminder === 0 ? Date.now() : state.announcedAt,
    lastAnnouncedAt: Date.now(),
    count: reminder + 1,
  });

  if (expiresAt) {
    setTimeout(() => {
      pruneAnnouncements().catch(() => null);
    }, LIVE_ANNOUNCE_TTL_MS + 1000).unref?.();
  }
  console.log(`annuncio live inviato (${reminder + 1}/${LIVE_ANNOUNCE_REPEATS}): ${sent.id}`);
}

async function announceLive(raw) {
  if (!announceChannelId) return;

  const stream = raw.livestream;
  const state = await readLiveState();

  if (!stream) {
    await pruneAnnouncements(true);
    if (state.live) await writeLiveState({ live: false, count: 0 });
    return;
  }

  const sessionId = String(stream.id ?? stream.slug ?? stream.created_at ?? stream.start_time ?? '');
  const newSession = !sessionId || sessionId !== state.sessionId;

  if (newSession) {
    if (Date.now() - (state.announcedAt ?? 0) < LIVE_ANNOUNCE_COOLDOWN_MS) {
      await writeLiveState({ live: true, sessionId });
      return;
    }
    await pruneAnnouncements(true);
    await sendAnnouncement(raw, sessionId, 0);
    return;
  }

  await pruneAnnouncements();

  const count = state.count ?? 1;
  const withinWindow = Date.now() - (state.announcedAt ?? 0) < LIVE_ANNOUNCE_WINDOW_MS;
  const spaced = Date.now() - (state.lastAnnouncedAt ?? state.announcedAt ?? 0) >= LIVE_ANNOUNCE_REPEAT_EVERY_MS;

  if (count < LIVE_ANNOUNCE_REPEATS && withinWindow && spaced) {
    await sendAnnouncement(raw, sessionId, count);
    return;
  }
  if (!state.live) await writeLiveState({ live: true });
}

async function ensureCodesChannel(guild) {
  if (!CODES_ENABLED) return;

  if (CODES_CHANNEL_ID) {
    const configured = await guild.channels.fetch(CODES_CHANNEL_ID).catch(() => null);
    if (configured) {
      codesChannelId = configured.id;
      await lockReadOnlyChannel(configured);
      return;
    }
    console.error('CODES_CHANNEL_ID non valido:', CODES_CHANNEL_ID);
  }

  const state = await getCodesState();
  let channel = state.channelId ? await guild.channels.fetch(state.channelId).catch(() => null) : null;

  if (!channel) {
    const all = await guild.channels.fetch().catch(() => null);
    channel = all?.find(
      (c) => c?.type === ChannelType.GuildText && (c.name === CODES_CHANNEL_NAME || c.topic === CODES_TOPIC),
    ) ?? null;
  }

  if (!channel) {
    channel = await guild.channels
      .create({
        name: CODES_CHANNEL_NAME,
        type: ChannelType.GuildText,
        parent: CODES_CATEGORY_ID || undefined,
        topic: CODES_TOPIC,
        reason: 'Canale dedicato ai code drop',
      })
      .catch((err) => {
        console.error('Creazione canale codici fallita:', err.message);
        return null;
      });
    if (channel) console.log(`canale code drops creato: #${channel.name} (${channel.id})`);
  }

  if (!channel) return;
  await lockReadOnlyChannel(channel);
  codesChannelId = channel.id;
  await setCodesChannel(channel.id);
}

function codesMention() {
  if (CODES_PING_ROLE_ID) return `<@&${CODES_PING_ROLE_ID}>`;
  if (CODES_MENTION === 'everyone') return '@everyone';
  if (CODES_MENTION === 'here') return '@here';
  return '';
}

function codesAllowedMentions() {
  if (CODES_PING_ROLE_ID) return { roles: [CODES_PING_ROLE_ID], parse: [] };
  if (CODES_MENTION === 'everyone' || CODES_MENTION === 'here') return { parse: ['everyone'] };
  return { parse: [] };
}

function casinoEmoji(slug) {
  return client.emojis.cache.find((e) => e.name === slug)?.toString() ?? '';
}

function casinoAvatar(slug) {
  return client.emojis.cache.find((e) => e.name === slug)?.imageURL({ size: 128, extension: 'png' }) ?? null;
}

async function getCodesWebhook(channel) {
  if (!CODES_WEBHOOK_ENABLED) return null;
  if (codesWebhook) return codesWebhook;

  const hooks = await channel.fetchWebhooks().catch((err) => {
    console.error('Lettura webhook fallita:', err.message);
    return null;
  });
  codesWebhook = hooks?.find((h) => h.owner?.id === client.user.id && h.token) ?? null;
  if (codesWebhook) return codesWebhook;

  codesWebhook = await channel
    .createWebhook({
      name: CODES_WEBHOOK_NAME,
      avatar: casinoAvatar(CODES_BRANDS[0]) ?? undefined,
      reason: 'Identita dedicata ai code drop',
    })
    .catch((err) => {
      console.error('Creazione webhook fallita:', err.message);
      return null;
    });
  return codesWebhook;
}

async function postCode(entry) {
  const channel = await client.channels.fetch(codesChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const payload = buildCodeMessage(entry, {
    mention: codesMention(),
    redeemUrl: CODES_REDEEM_URL,
    pingRoleId: CODES_PING_ROLE_ID,
    emoji: casinoEmoji(entry.slug),
  });

  const webhook = await getCodesWebhook(channel);
  const options = { ...payload, allowedMentions: codesAllowedMentions() };

  const sent = webhook
    ? await webhook
      .send({
        ...options,
        username: `${entry.casino} Drops`.slice(0, 80),
        avatarURL: casinoAvatar(entry.slug) ?? undefined,
        withComponents: true,
      })
      .catch((err) => {
        console.error('Invio webhook fallito:', err.message);
        return null;
      })
    : await channel.send(options).catch((err) => {
      console.error('Invio code drop fallito:', err.message);
      return null;
    });
  if (!sent) return;

  codeMessageIds.add(sent.id);
  await addPosted({
    channelId: sent.channel_id ?? sent.channelId ?? channel.id,
    id: sent.id,
    endAt: entry.endAt,
    entry,
    viaWebhook: Boolean(webhook),
  });
  console.log(`code drop pubblicato: ${entry.casino} ${entry.code} ($${entry.value})`);

  if (entry.endAt && entry.endAt > Date.now()) {
    setTimeout(() => {
      sweepExpiredCodes().catch(() => null);
    }, entry.endAt - Date.now() + 2000).unref?.();
  }
}

async function sweepExpiredCodes() {
  const expired = await takeExpiredPosts();
  for (const post of expired) {
    const payload = {
      ...expiredCodeMessage(post.entry, { redeemUrl: CODES_REDEEM_URL, emoji: casinoEmoji(post.entry?.slug) }),
      allowedMentions: { parse: [] },
    };

    if (post.viaWebhook) {
      const channel = await client.channels.fetch(post.channelId).catch(() => null);
      const webhook = channel ? await getCodesWebhook(channel) : null;
      if (webhook) {
        await webhook.editMessage(post.id, payload).catch(() => null);
        continue;
      }
    }

    const channel = await client.channels.fetch(post.channelId).catch(() => null);
    const message = await channel?.messages?.fetch(post.id).catch(() => null);
    if (message) await message.edit(payload).catch(() => null);
  }
}

async function handleIncomingCodes(codes) {
  if (!codesChannelId) return;
  const wanted = codes.filter(
    (c) => CODES_BRANDS.includes(c.slug) && c.value >= CODES_MIN_VALUE,
  );
  const others = codes.filter((c) => !wanted.includes(c));
  if (others.length) await markSeen(others);
  if (!wanted.length) return;

  const fresh = await filterNewCodes(wanted);
  const live = fresh
    .filter((c) => !c.endAt || c.endAt > Date.now())
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const entry of live) await postCode(entry);
}

const KICK_ENDPOINTS = [
  (slug) => `https://kick.com/api/v2/channels/${slug}`,
  (slug) => `https://kick.com/api/v1/channels/${slug}`,
  (slug) => `https://api.kick.com/public/v1/channels?slug=${slug}`,
];

function extractFollowers(data) {
  const node = Array.isArray(data?.data) ? data.data[0] : data;
  const candidates = [
    node?.followers_count,
    node?.followersCount,
    node?.followers,
    node?.user?.followers_count,
    node?.chatroom?.followers_count,
  ];
  return candidates.find((v) => typeof v === 'number') ?? null;
}

async function fetchKickChannel() {
  const errors = [];
  for (const build of KICK_ENDPOINTS) {
    const url = build(KICK_SLUG);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          Referer: `https://kick.com/${KICK_SLUG}`,
        },
      });
      const body = await res.text();
      if (!res.ok) {
        errors.push(`${res.status} su ${url}: ${body.slice(0, 90)}`);
        continue;
      }
      const data = JSON.parse(body);
      const followers = extractFollowers(data);
      if (followers !== null) return { data, followers };
      const node = Array.isArray(data?.data) ? data.data[0] : data;
      errors.push(`campi disponibili su ${url}: ${Object.keys(node ?? {}).join(',')}`);
    } catch (err) {
      errors.push(`${url}: ${err.message.slice(0, 90)}`);
    }
  }
  throw new Error(errors.join(' | '));
}

async function pollKick() {
  if (!KICK_SLUG) return;

  let data;
  try {
    data = await fetchKickChannel();
  } catch (err) {
    console.error('Kick non raggiungibile:', err.message);
    return;
  }

  const { data: raw, followers } = data;
  await updateLiveMessage(raw);
  await announceLive(raw);

  const live = Boolean(raw.livestream ?? raw.stream?.is_live);
  const name = `${live ? '🔴' : '🟢'}・𝗞𝗜𝗖𝗞: ${followers.toLocaleString('en-US')}`;

  const applied = kickState.applied;
  kickState = { followers, live, name, updatedAt: new Date().toISOString(), applied };
  if (!KICK_COUNTER_CHANNEL_ID) return;
  if (name === applied) return;
  if (Date.now() - lastRenameAt < RENAME_MIN_INTERVAL_MS) return;

  const channel = await client.channels.fetch(KICK_COUNTER_CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.error('Canale contatore Kick non trovato');
    return;
  }
  if (channel.name === name) {
    kickState.applied = name;
    return;
  }

  try {
    await channel.setName(name, 'Aggiornamento contatore follower Kick');
    kickState.applied = name;
    lastRenameAt = Date.now();
    console.log(`contatore Kick aggiornato: ${name}`);
  } catch (err) {
    console.error('Rinomina contatore fallita:', err.message);
  }
}

function verificationMessage(link) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Verification required')
    .setDescription(
      'Welcome to **Cousik Community**!\n\nBefore you can access the server you need to complete a quick anti-bot check.\n\nClick the button below, type the code you see on the page and your access will be unlocked instantly.',
    )
    .addFields(
      { name: 'How long is it valid?', value: 'This link expires in 15 minutes', inline: true },
      { name: 'Link expired?', value: 'Use `/verify` in the server', inline: true },
    )
    .setFooter({ text: 'Cousik Community - automated verification' })
    .setTimestamp(new Date());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Verify me').setEmoji('🛡️').setURL(link),
  );
  return { embeds: [embed], components: [row] };
}

function welcomeMessage(member, roleNames, inviteUrl) {
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('Verification complete')
    .setDescription(
      `You are now verified in **${member.guild.name}**.\n\nEnjoy your stay and please follow the server rules.`,
    )
    .setThumbnail(member.guild.iconURL({ size: 256 }) ?? member.displayAvatarURL(VIEW))
    .addFields(
      { name: 'Roles granted', value: roleNames.length ? roleNames.map((n) => `✅ ${n}`).join('\n') : 'none', inline: true },
      { name: 'Verified at', value: time(new Date(), 'f'), inline: true },
    )
    .setFooter({ text: 'Cousik Community' })
    .setTimestamp(new Date());

  const components = inviteUrl
    ? [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel('Go to the server')
            .setEmoji('🏠')
            .setURL(inviteUrl),
        ),
      ]
    : [];

  return { embeds: [embed], components };
}

async function startVerification(member) {
  if (!PUBLIC_URL) return 'non configurata: manca PUBLIC_URL';
  const token = createVerification(member.id, member.user.username);
  const link = `${PUBLIC_URL}/verify/${token}`;
  try {
    await member.send(verificationMessage(link));
    return 'link inviato in messaggio privato';
  } catch {
    return 'MP chiusi: deve usare il comando `/verifica` nel server';
  }
}

async function completeVerification(userId) {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return { ok: false, message: 'server non raggiungibile' };

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return { ok: false, message: 'you are no longer in the server' };

  const results = [
    { label: 'Member', outcome: await grantRole(member, AUTO_ROLE_ID, 'Verifica captcha superata') },
    { label: 'Verified', outcome: await grantRole(member, VERIFIED_ROLE_ID, 'Verifica captcha superata') },
  ].filter((r) => r.outcome);

  const failed = results.filter((r) => !r.outcome.ok);
  const ok = failed.length === 0 && results.length > 0;
  const success = results.filter((r) => r.outcome.ok);
  const grantedNames = success.map((r) => r.outcome.role.name);
  const grantedMentions = success.map((r) => `<@&${r.outcome.role.id}>`);

  const serverUrl = `https://discord.com/channels/${member.guild.id}`;

  let dmStatus = 'non inviata';
  try {
    await member.send(welcomeMessage(member, grantedNames, serverUrl));
    dmStatus = 'inviata in MP';
  } catch {
    dmStatus = 'MP chiusi';
  }

  const embed = new EmbedBuilder()
    .setColor(ok ? 0x22c55e : 0xe67e22)
    .setTitle(ok ? 'Captcha superato' : 'Captcha superato ma con errori')
    .setDescription(`${member} — **${member.user.tag}**`)
    .setThumbnail(member.displayAvatarURL(VIEW))
    .addFields(
      { name: 'Ruoli assegnati', value: grantedMentions.length ? grantedMentions.join(' ') : 'nessuno', inline: true },
      { name: 'Conferma utente', value: dmStatus, inline: true },
    )
    .setFooter({ text: `ID: ${member.id}` })
    .setTimestamp(new Date());

  if (failed.length) {
    embed.addFields({
      name: 'Errori',
      value: failed.map((r) => `${r.label}: ${r.outcome.text}`).join('\n'),
    });
  }
  await send(embed);

  return { ok, message: failed.map((r) => `${r.label}: ${r.outcome.text}`).join(' | ') || 'ok' };
}

function isTicketStaff(member) {
  return member.permissions.has('ManageChannels')
    || TICKET_CONFIG.staffRoles.some((id) => member.roles.cache.has(id));
}

async function ticketLog(embed, files = []) {
  if (!TICKET_CONFIG.logChannelId) return;
  const channel = await client.channels.fetch(TICKET_CONFIG.logChannelId).catch(() => null);
  if (!channel) return;
  await channel.send({ embeds: [embed], files }).catch((err) => console.error('Log ticket fallito:', err.message));
}

async function archiveTicket(interaction, resolved) {
  const channel = interaction.channel;
  const ownerId = channel.topic?.match(/owner:(\d+)/)?.[1];

  const transcript = await buildTranscript(channel);

  if (TICKET_CONFIG.archiveCategoryId) {
    await channel.setParent(TICKET_CONFIG.archiveCategoryId, { lockPermissions: false }).catch(() => null);
  }
  if (ownerId) {
    await channel.permissionOverwrites.edit(ownerId, { SendMessages: false, ViewChannel: true }).catch(() => null);
  }
  await channel.setName(`closed-${channel.name.replace(/^ticket-/, '')}`.slice(0, 100)).catch(() => null);

  await markClosed(channel.id, {
    resolved,
    closedBy: interaction.user.id,
    closedByTag: interaction.user.tag,
    resolution: resolved
      ? `Marked as resolved by ${interaction.user.tag}`
      : `Closed without a solution by ${interaction.user.tag}`,
  });

  const embed = new EmbedBuilder()
    .setColor(resolved ? 0x22c55e : 0xef4444)
    .setTitle('🔒 Ticket chiuso')
    .addFields(
      { name: 'Canale', value: `${channel}`, inline: true },
      { name: 'Chiuso da', value: `${interaction.user}`, inline: true },
      { name: 'Proprietario', value: ownerId ? `<@${ownerId}>` : 'sconosciuto', inline: true },
      { name: 'Esito', value: resolved ? '✅ Risolto' : '❌ Chiuso senza soluzione', inline: true },
    )
    .setTimestamp(new Date());

  await ticketLog(embed, [transcript]);
  await channel.send(archivedMessage(interaction.user, resolved, ownerId));
}

async function handleTicketInteraction(interaction) {
  if (interaction.isButton() && interaction.customId === 'ticket_open') {
    await interaction.reply(categoryChooser());
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith('ticket_history')) {
    const [, rawUser, rawPage] = interaction.customId.split(':');
    const targetId = rawUser || interaction.user.id;
    if (targetId !== interaction.user.id && !isTicketStaff(interaction.member)) {
      await interaction.reply({ content: 'You can only see your own tickets.', ephemeral: true });
      return true;
    }
    const page = Number(rawPage) || 0;
    const payload = await historyMessage(targetId, page, targetId === interaction.user.id);
    if (interaction.message?.flags?.has?.(MessageFlags.Ephemeral)) await interaction.update(payload);
    else await interaction.reply({ ...payload, ephemeral: true });
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_history_view:')) {
    const [, targetId, rawPage] = interaction.customId.split(':');
    if (targetId !== interaction.user.id && !isTicketStaff(interaction.member)) {
      await interaction.reply({ content: 'You can only see your own tickets.', ephemeral: true });
      return true;
    }
    const entry = await getTicket(interaction.values[0]);
    if (!entry) {
      await interaction.reply({ content: 'This ticket is no longer in the history.', ephemeral: true });
      return true;
    }
    if (entry.userId !== interaction.user.id && !isTicketStaff(interaction.member)) {
      await interaction.reply({ content: 'You can only see your own tickets.', ephemeral: true });
      return true;
    }
    await interaction.update(ticketDetailMessage(entry, { userId: targetId, page: Number(rawPage) || 0 }));
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
    const key = interaction.values[0];
    if (!TICKET_TYPES[key]) return true;
    await interaction.showModal(buildModal(key));
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal:')) {
    const key = interaction.customId.split(':')[1];
    await interaction.deferReply({ ephemeral: true });
    const answers = {
      subject: interaction.fields.getTextInputValue('subject'),
      details: interaction.fields.getTextInputValue('details'),
      casino: TICKET_TYPES[key].askCasino ? interaction.fields.getTextInputValue('casino') : '',
      account: interaction.fields.fields.has('account') ? interaction.fields.getTextInputValue('account') : '',
    };
    const result = await createTicket(interaction, TICKET_CONFIG, answers, key);
    if (!result.ok) {
      await interaction.editReply({ content: result.message });
      return true;
    }
    await interaction.editReply({ content: `Your ticket has been created: ${result.channel}` });

    const embed = new EmbedBuilder()
      .setColor(result.type.colour)
      .setTitle('🎫 Ticket aperto')
      .addFields(
        { name: 'Utente', value: `${interaction.user}`, inline: true },
        { name: 'Tipo', value: `${result.type.emoji} ${result.type.label}`, inline: true },
        { name: 'Canale', value: `${result.channel}`, inline: true },
        { name: 'Oggetto', value: answers.subject },
      )
      .setTimestamp(new Date());
    await ticketLog(embed);
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'ticket_claim') {
    if (!isTicketStaff(interaction.member)) {
      await interaction.reply({ content: 'Only staff can claim a ticket.', ephemeral: true });
      return true;
    }
    await interaction.reply({ content: `🙋 ${interaction.user} is handling this ticket.` });
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'ticket_close') {
    await interaction.reply(closeConfirmMessage());
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'ticket_close_cancel') {
    await interaction.update({ content: 'Cancelled.', embeds: [], components: [] });
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith('ticket_close_confirm')) {
    const resolved = interaction.customId.split(':')[1] !== 'unresolved';
    await interaction.update({ content: 'Closing the ticket...', embeds: [], components: [] });
    await archiveTicket(interaction, resolved);
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'ticket_delete') {
    if (!isTicketStaff(interaction.member)) {
      await interaction.reply({ content: 'Only staff can delete a ticket.', ephemeral: true });
      return true;
    }
    const name = interaction.channel.name;
    await markDeleted(interaction.channel.id, interaction.user.id);
    await interaction.reply({ content: 'Deleting in 5 seconds...' });
    setTimeout(() => {
      interaction.channel.delete('Ticket eliminato dallo staff').catch(() => null);
    }, 5000);

    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle('🗑️ Ticket eliminato')
      .addFields(
        { name: 'Canale', value: name, inline: true },
        { name: 'Eliminato da', value: `${interaction.user}`, inline: true },
      )
      .setTimestamp(new Date());
    await ticketLog(embed);
    return true;
  }

  return false;
}

const PAGE_SIZE = 20;

async function membersPage(guild, page) {
  const all = await guild.members.fetch();
  const sorted = [...all.values()].sort(
    (a, b) => (a.joinedTimestamp ?? 0) - (b.joinedTimestamp ?? 0),
  );
  const humans = sorted.filter((m) => !m.user.bot);
  const bots = sorted.filter((m) => m.user.bot);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const slice = sorted.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const lines = slice.map((m, i) => {
    const n = current * PAGE_SIZE + i + 1;
    const name = m.nickname ?? m.user.globalName ?? m.user.username;
    const joined = m.joinedAt ? time(m.joinedAt, 'd') : 'unknown date';
    return `\`${String(n).padStart(4)}\` ${m.user.bot ? '🤖' : '👤'} **${name}** \`@${m.user.username}\` · ${joined}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('All server members')
    .setDescription(lines.join('\n') || 'no members')
    .addFields(
      { name: 'Total', value: `${sorted.length}`, inline: true },
      { name: 'People', value: `${humans.length}`, inline: true },
      { name: 'Bots', value: `${bots.length}`, inline: true },
    )
    .setFooter({ text: `Page ${current + 1} of ${pages} · online and offline included` })
    .setTimestamp(new Date());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`membri:${current - 1}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Previous')
      .setEmoji('⬅️')
      .setDisabled(current === 0),
    new ButtonBuilder()
      .setCustomId(`membri:${current + 1}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Next')
      .setEmoji('➡️')
      .setDisabled(current >= pages - 1),
  );

  return { embeds: [embed], components: [row] };
}

client.on('interactionCreate', async (interaction) => {
  try {
    if (await handleTicketInteraction(interaction)) return;

    if (interaction.isChatInputCommand() && interaction.commandName === 'ticket-panel') {
      if (!interaction.memberPermissions.has('ManageGuild')) {
        await interaction.reply({ content: 'You need the Manage Server permission.', ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const panel = buildPanel(TICKET_BANNER);
      await interaction.channel.send({
        ...panel,
        files: [{ attachment: `./assets/${TICKET_BANNER}`, name: TICKET_BANNER }],
      });
      await interaction.editReply({ content: 'Panel published.' });
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'members') {
      await interaction.deferReply({ ephemeral: true });
      const payload = await membersPage(interaction.guild, 0);
      await interaction.editReply(payload);
      return;
    }
    if (interaction.isChatInputCommand() && interaction.commandName === 'verify') {
      if (!PUBLIC_URL) {
        await interaction.reply({ content: 'Verification is not configured.', ephemeral: true });
        return;
      }
      if (VERIFIED_ROLE_ID && interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
        await interaction.reply({ content: 'You are already verified.', ephemeral: true });
        return;
      }
      const token = createVerification(interaction.user.id, interaction.user.username);
      const payload = verificationMessage(`${PUBLIC_URL}/verify/${token}`);
      await interaction.reply({ ...payload, ephemeral: true });
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('codes_redeem:')) {
      const [, slug, code] = interaction.customId.split(':');
      const entry = { slug, code, casino: slug.replace(/us$/, ' US').replace(/^./, (c) => c.toUpperCase()) };
      await interaction.reply(
        redeemInstructions(entry, { redeemUrl: CODES_REDEEM_URL, emoji: casinoEmoji(slug) }),
      );
      return;
    }

    if (interaction.isButton() && (interaction.customId === 'live_notify_toggle' || interaction.customId === 'codes_notify_toggle')) {
      const isCodes = interaction.customId === 'codes_notify_toggle';
      const roleId = isCodes ? CODES_PING_ROLE_ID : LIVE_PING_ROLE_ID;
      if (!roleId) {
        await interaction.reply({ content: 'These notifications are not configured.', ephemeral: true });
        return;
      }
      const hasRole = interaction.member.roles.cache.has(roleId);
      try {
        if (hasRole) await interaction.member.roles.remove(roleId, 'Notifiche disattivate');
        else await interaction.member.roles.add(roleId, 'Notifiche attivate');
      } catch (err) {
        await interaction.reply({ content: `Could not update your role: ${err.message}`, ephemeral: true });
        return;
      }
      const on = isCodes
        ? '🔔 You will be pinged on every new code drop.'
        : '🔔 You will be pinged every time the stream starts.';
      const off = isCodes
        ? '🔕 You will no longer be pinged on code drops.'
        : '🔕 You will no longer be pinged when the stream starts.';
      await interaction.reply({ content: hasRole ? off : on, ephemeral: true });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('membri:')) {
      await interaction.deferUpdate();
      const page = Number(interaction.customId.split(':')[1]) || 0;
      const payload = await membersPage(interaction.guild, page);
      await interaction.editReply(payload);
    }
  } catch (err) {
    console.error('Interazione fallita:', err.message);
  }
});

const PORT = process.env.PORT || 3000;
const startedAt = new Date();
let pingCount = 0;
let lastPingAt = null;

createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname.startsWith('/verify/')) {
    await handleVerify(req, res, pathname, completeVerification).catch(() => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('errore interno');
    });
    return;
  }

  pingCount += 1;
  lastPingAt = new Date();
  const ready = client.isReady();
  const agent = req.headers['user-agent'] ?? 'sconosciuto';
  console.log(`ping #${pingCount} da ${agent.slice(0, 60)}`);
  res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      status: ready ? 'online' : 'connecting',
      bot: client.user?.tag ?? null,
      guilds: client.guilds.cache.size,
      members: client.guilds.cache.get(GUILD_ID)?.memberCount ?? null,
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt: startedAt.toISOString(),
      pingCount,
      lastPingAt: lastPingAt.toISOString(),
      verifyEnabled: VERIFY_ENABLED,
      verifyPending: pendingCount(),
      kick: KICK_SLUG
        ? {
            slug: KICK_SLUG,
            followers: kickState.followers,
            live: kickState.live,
            updatedAt: kickState.updatedAt,
            liveMessageId,
          }
        : null,
    }),
  );
}).listen(PORT, () => console.log(`Keep-alive HTTP in ascolto sulla porta ${PORT}`));

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  const onBotFeed = liveAnnouncementIds.has(reaction.message.id) || codeMessageIds.has(reaction.message.id);
  if (!onBotFeed && !NO_REACTION_CHANNELS.includes(reaction.message.channelId)) return;

  try {
    if (reaction.partial) await reaction.fetch();
    await reaction.users.remove(user.id);
    console.log(`reazione rimossa: ${user.tag ?? user.id} in ${reaction.message.channelId}`);
  } catch (err) {
    console.error('Rimozione reazione fallita:', err.message);
  }
});

client.on('error', (err) => console.error('Errore client:', err.message));
process.on('unhandledRejection', (err) => console.error('Promise non gestita:', err));

client.login(TOKEN);
