import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const FILE = resolve(process.env.LIVE_STATE_FILE || './data/live-state.json');

let cache = null;

export async function readLiveState() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    cache = { live: false, sessionId: null, announcedAt: 0, messageId: null };
  }
  return cache;
}

export async function writeLiveState(patch) {
  const current = await readLiveState();
  cache = { ...current, ...patch };
  try {
    await mkdir(dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8');
    await rename(tmp, FILE);
  } catch (err) {
    console.error('Salvataggio stato live fallito:', err.message);
  }
  return cache;
}
