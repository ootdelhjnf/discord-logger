import crypto from 'node:crypto';

const BODY_LIMIT = 16 * 1024;
const MAX_SKEW_MS = 5 * 60 * 1000;
const LIMITS = { subject: [6, 100], details: [30, 1000], casino: [10, 400], account: [0, 80] };
const seenSignatures = new Map();

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

export function createSiteTicketHandler({ client, guildId, secret, config, types, createTicket, findOpenTicket }) {
  return async function handleSiteTicket(req, res) {
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
    const answers = cleanAnswers(types, String(payload.type ?? ''), payload.answers);
    if (!/^\d{15,22}$/.test(discordId) || !answers) return reply(res, 400, { error: 'invalid' });

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return reply(res, 503, { error: 'guild' });

    const existing = await findOpenTicket(guild, discordId, config.categoryId).catch(() => null);
    if (existing) return reply(res, 409, { error: 'open_ticket', guildId: guild.id, channelId: existing.id });

    let member = await guild.members.fetch(discordId).catch(() => null);
    if (!member && payload.accessToken) {
      member = await guild.members.add(discordId, { accessToken: String(payload.accessToken) }).catch((err) => {
        console.error('[site-ticket] aggiunta al server fallita:', err.message);
        return null;
      });
    }
    if (!member) return reply(res, 403, { error: 'join_failed' });

    try {
      const result = await createTicket({ guild, user: member.user }, config, answers, payload.type);
      if (!result.ok) {
        const open = await findOpenTicket(guild, discordId, config.categoryId).catch(() => null);
        return reply(res, 409, { error: 'open_ticket', guildId: guild.id, channelId: open?.id ?? null });
      }
      await result.channel.send({ content: '🌐 Ticket opened from **cousik.com**.', allowedMentions: { parse: [] } }).catch(() => null);
      console.log(`[site-ticket] ${member.user.tag} -> #${result.channel.name}`);
      return reply(res, 201, { guildId: guild.id, channelId: result.channel.id });
    } catch (err) {
      console.error('[site-ticket] creazione fallita:', err.message);
      return reply(res, 500, { error: 'create_failed' });
    }
  };
}
