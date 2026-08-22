import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const FILE = resolve(process.env.CODES_STATE_FILE || './data/codes-state.json');
const SEEN_TTL_MS = 24 * 60 * 60 * 1000;

let cache = null;
let writing = Promise.resolve();

async function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'));
    cache = {
      channelId: parsed.channelId ?? null,
      seen: Array.isArray(parsed.seen) ? parsed.seen : [],
      posted: Array.isArray(parsed.posted) ? parsed.posted : [],
    };
  } catch {
    cache = { channelId: null, seen: [], posted: [] };
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
