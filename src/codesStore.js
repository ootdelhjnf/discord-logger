import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const FILE = resolve(process.env.CODES_STATE_FILE || './data/codes-state.json');
const SEEN_TTL_MS = 24 * 60 * 60 * 1000;
const HISTORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const EMPTY_STATS = { totalValue: 0, totalCount: 0, perCasino: {}, biggest: null, lastAt: null, history: [] };

let cache = null;
let writing = Promise.resolve();

async function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'));
    cache = {
      channelId: parsed.channelId ?? null,
      statsChannelId: parsed.statsChannelId ?? null,
      statsMessageId: parsed.statsMessageId ?? null,
      seen: Array.isArray(parsed.seen) ? parsed.seen : [],
      posted: Array.isArray(parsed.posted) ? parsed.posted : [],
      stats: { ...EMPTY_STATS, ...(parsed.stats ?? {}) },
    };
  } catch {
    cache = { channelId: null, statsChannelId: null, statsMessageId: null, seen: [], posted: [], stats: { ...EMPTY_STATS } };
  }
  return cache;
}

async function persist() {
  writing = writing.then(async () => {
    await mkdir(dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8');
    await rename(tmp, FILE);
  }).catch((err) => console.error('Salvataggio stato codici fallito:', err.message));
  return writing;
}

export async function getCodesState() {
  return load();
}

export async function setCodesChannel(channelId) {
  const state = await load();
  if (state.channelId === channelId) return;
  state.channelId = channelId;
  await persist();
}

export async function filterNewCodes(codes) {
  const state = await load();
  const cutoff = Date.now() - SEEN_TTL_MS;
  state.seen = state.seen.filter((s) => s.ts >= cutoff);
  const known = new Set(state.seen.map((s) => s.key));
  const fresh = codes.filter((c) => !known.has(c.key));
  if (!fresh.length) return [];
  state.seen.push(...fresh.map((c) => ({ key: c.key, ts: Date.now() })));
  await persist();
  return fresh;
}

export async function markSeen(codes) {
  const state = await load();
  const known = new Set(state.seen.map((s) => s.key));
  const added = codes.filter((c) => !known.has(c.key));
  if (!added.length) return;
  state.seen.push(...added.map((c) => ({ key: c.key, ts: Date.now() })));
  await persist();
}

export async function setStatsChannel(channelId, messageId) {
  const state = await load();
  if (state.statsChannelId === channelId && state.statsMessageId === messageId) return;
  state.statsChannelId = channelId;
  state.statsMessageId = messageId;
  await persist();
}

export async function recordDrop(entry) {
  const state = await load();
  const stats = state.stats;
  const value = Number(entry.value) || 0;

  stats.history.push({ slug: entry.slug, casino: entry.casino, code: entry.code, value, ts: Date.now() });
  stats.history = stats.history.filter((h) => Date.now() - h.ts < HISTORY_TTL_MS);
  stats.totalValue += value;
  stats.totalCount += 1;
  stats.lastAt = Date.now();

  const perCasino = stats.perCasino[entry.slug] ?? { casino: entry.casino, count: 0, value: 0 };
  perCasino.casino = entry.casino;
  perCasino.count += 1;
  perCasino.value += value;
  stats.perCasino[entry.slug] = perCasino;

  if (!stats.biggest || value > stats.biggest.value) {
    stats.biggest = { casino: entry.casino, slug: entry.slug, code: entry.code, value, ts: Date.now() };
  }

  await persist();
  return stats;
}

export async function getDropStats() {
  const state = await load();
  const stats = state.stats;
  const windowSum = (ms) => {
    const since = Date.now() - ms;
    const rows = stats.history.filter((h) => h.ts >= since);
    return { count: rows.length, value: rows.reduce((acc, h) => acc + h.value, 0) };
  };
  return {
    ...stats,
    last24h: windowSum(24 * 60 * 60 * 1000),
    last7d: windowSum(7 * 24 * 60 * 60 * 1000),
    statsChannelId: state.statsChannelId,
    statsMessageId: state.statsMessageId,
  };
}

export async function addPosted(ref) {
  const state = await load();
  state.posted.push(ref);
  await persist();
}

export async function takeExpiredPosts(now = Date.now()) {
  const state = await load();
  const expired = state.posted.filter((p) => !p.expiredHandled && p.endAt && p.endAt <= now);
  if (!expired.length) return [];
  for (const post of expired) post.expiredHandled = true;
  state.posted = state.posted.filter((p) => now - (p.endAt ?? 0) < SEEN_TTL_MS);
  await persist();
  return expired;
}
