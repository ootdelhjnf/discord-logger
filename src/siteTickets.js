import crypto from 'node:crypto';
import { ChannelType, EmbedBuilder } from 'discord.js';

const BODY_LIMIT = 16 * 1024;
const MAX_SKEW_MS = 5 * 60 * 1000;
const STATE_CACHE_MS = 3000;
const STAFF_SETTLE_MS = 6000;
const SITE_FOOTER = 'Sent from cousik.com';
const LIMITS = { subject: [6, 100], details: [30, 1000], casino: [10, 400], account: [0, 80] };
const seenSignatures = new Map();
const stateCache = new Map();

function reply(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error('too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function validSignature(secret, timestamp, body, signature) {
  if (!secret || !/^\d{13}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > MAX_SKEW_MS) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
  const provided = Buffer.from(signature, 'hex');
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

function rememberSignature(signature) {
  const now = Date.now();
  for (const [key, time] of seenSignatures) if (now - time > MAX_SKEW_MS * 2) seenSignatures.delete(key);
  if (seenSignatures.has(signature)) return false;
  seenSignatures.set(signature, now);
  return true;
}

function cleanAnswers(types, type, answers) {
  if (!Object.hasOwn(types, type)) return null;
  const fields = ['subject', 'details', ...(types[type].askCasino ? ['casino'] : []), 'account'];
  const result = {};
  for (const field of fields) {
    const value = String(answers?.[field] ?? '').trim();
    const [min, max] = LIMITS[field];
    if (value.length < min || value.length > max) return null;
    if (value) result[field] = value;
  }
  return result;
}

function readableContent(text) {
  return String(text ?? '')
    .replace(/<@&\d+>/g, '@staff')
    .replace(/<@!?\d+>/g, '@user')
    .replace(/<#\d+>/g, '#channel')
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .trim();
}

function attachmentsOf(message) {
  return [...message.attachments.values()].slice(0, 4).map((file) => ({ name: file.name, url: file.url, image: /^image\//.test(file.contentType ?? '') }));
}

function toSiteMessage(message, ownerId, botId) {
  const at = message.createdTimestamp;
  if (message.webhookId) {
    const content = readableContent(message.content);
    if (!content && !message.attachments.size) return null;
    return { id: message.id, kind: 'staff', author: message.author.username, content, attachments: attachmentsOf(message), at };
  }
  if (message.author.id === botId) {
    const embed = message.embeds[0];
    if (embed?.footer?.text === SITE_FOOTER) return { id: message.id, kind: 'mine', author: 'You', content: embed.description ?? '', attachments: [], at };
    if (embed?.title && /ticket claimed/i.test(embed.title)) return { id: message.id, kind: 'system', content: 'A staff member is now handling your ticket.', at };
    return null;
  }
  if (message.author.bot) return null;
  const content = readableContent(message.content);
  if (!content && !message.attachments.size) return null;
  if (message.author.id === ownerId) return { id: message.id, kind: 'mine', author: 'You', content, attachments: attachmentsOf(message), at };
  if (Date.now() - at < STAFF_SETTLE_MS) return null;
  return { id: message.id, kind: 'staff', author: message.member?.displayName ?? message.author.globalName ?? message.author.username, content, attachments: attachmentsOf(message), at };
}

export function createSiteHandler({ client, guildId, secret, config, types, createTicket }) {
  const guild = () => client.guilds.cache.get(guildId) ?? null;

  const openTicketOf = (discordId) =>
    guild()?.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildText && channel.parentId === config.categoryId && channel.topic?.includes(`owner:${discordId}`),
    ) ?? null;

  const ticketState = async (channel, ownerId) => {
    const cached = stateCache.get(channel.id);
    if (cached && Date.now() - cached.at < STATE_CACHE_MS) return cached.value;
    const fetched = await channel.messages.fetch({ limit: 50 });
    const messages = [...fetched.values()]
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((message) => toSiteMessage(message, ownerId, client.user.id))
      .filter(Boolean);
    const value = { guildId: channel.guildId, channelId: channel.id, name: channel.name, messages };
    stateCache.set(channel.id, { at: Date.now(), value });
    return value;
  };

  const create = async (res, payload, discordId) => {
    const answers = cleanAnswers(types, String(payload.type ?? ''), payload.answers);
    if (!answers) return reply(res, 400, { error: 'invalid' });
    const server = guild();
    if (!server) return reply(res, 503, { error: 'guild' });

    const existing = openTicketOf(discordId);
    if (existing) return reply(res, 409, { error: 'open_ticket', guildId: server.id, channelId: existing.id, name: existing.name });

    let member = await server.members.fetch(discordId).catch(() => null);
    if (!member && payload.accessToken) {
      member = await server.members.add(discordId, { accessToken: String(payload.accessToken) }).catch((err) => {
        console.error('[site-ticket] aggiunta al server fallita:', err.message);
        return null;
      });
    }
    if (!member) return reply(res, 403, { error: 'join_failed' });

    const result = await createTicket({ guild: server, user: member.user }, config, answers, payload.type);
    if (!result.ok) {
      const open = openTicketOf(discordId);
      return reply(res, 409, { error: 'open_ticket', guildId: server.id, channelId: open?.id ?? null, name: open?.name ?? null });
    }
    await result.channel
      .send({ content: '🌐 Ticket opened from **cousik.com**. The user can read and reply from the website too.', allowedMentions: { parse: [] } })
      .catch(() => null);
    console.log(`[site-ticket] ${member.user.tag} -> #${result.channel.name}`);
    return reply(res, 201, { guildId: server.id, channelId: result.channel.id, name: result.channel.name });
  };

  const state = async (res, discordId) => {
    const channel = openTicketOf(discordId);
    if (!channel) return reply(res, 200, { ticket: null });
    return reply(res, 200, { ticket: await ticketState(channel, discordId) });
  };

  const message = async (res, payload, discordId) => {
    const content = String(payload.content ?? '').replace(/\r\n/g, '\n').trim();
    if (content.length < 1 || content.length > 1000) return reply(res, 400, { error: 'invalid' });
    const channel = openTicketOf(discordId);
    if (!channel) return reply(res, 404, { error: 'no_ticket' });
    const name = String(payload.displayName ?? '').slice(0, 80) || 'User';
    const avatar = /^https:\/\/cdn\.discordapp\.com\//.test(String(payload.avatar ?? '')) ? payload.avatar : undefined;
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name, iconURL: avatar })
      .setDescription(content)
      .setFooter({ text: SITE_FOOTER })
      .setTimestamp(new Date());
    await channel.send({ content: `<@${discordId}>`, embeds: [embed], allowedMentions: { parse: [] } });
    stateCache.delete(channel.id);
    return reply(res, 201, { ok: true });
  };

  return async function handleSite(req, res, pathname) {
    if (req.method !== 'POST') return reply(res, 405, { error: 'method' });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return reply(res, 413, { error: 'too_large' });
    }
    const timestamp = String(req.headers['x-cousik-timestamp'] ?? '');
    const signature = String(req.headers['x-cousik-signature'] ?? '');
    if (!validSignature(secret, timestamp, body, signature) || !rememberSignature(signature)) return reply(res, 401, { error: 'signature' });
    if (!client.isReady()) return reply(res, 503, { error: 'not_ready' });

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return reply(res, 400, { error: 'json' });
    }
    const discordId = String(payload.discordId ?? '');
    if (!/^\d{15,22}$/.test(discordId)) return reply(res, 400, { error: 'invalid' });

    try {
      if (pathname === '/site/ticket') return await create(res, payload, discordId);
      if (pathname === '/site/ticket/state') return await state(res, discordId);
      if (pathname === '/site/ticket/message') return await message(res, payload, discordId);
      return reply(res, 404, { error: 'not_found' });
    } catch (err) {
      console.error(`[site-ticket] ${pathname} fallito:`, err.message);
      return reply(res, 500, { error: 'failed' });
    }
  };
}
