import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const FILE = resolve(process.env.TICKET_DATA_FILE || './data/tickets.json');

let cache = null;
let writing = Promise.resolve();

async function load() {
  if (cache) return cache;
  try {
    const raw = await readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed?.tickets) ? parsed.tickets : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function persist() {
  const tickets = cache ?? [];
  writing = writing.then(async () => {
    await mkdir(dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    await writeFile(tmp, JSON.stringify({ tickets }, null, 2), 'utf8');
    await rename(tmp, FILE);
  }).catch((err) => console.error('Salvataggio storico ticket fallito:', err.message));
  return writing;
}

export async function recordTicket(entry) {
  const tickets = await load();
  const existing = tickets.findIndex((t) => t.id === entry.id);
  const record = {
    status: 'open',
    closedAt: null,
    closedBy: null,
    closedByTag: null,
    resolution: null,
    ...entry,
  };
  if (existing >= 0) tickets[existing] = { ...tickets[existing], ...record };
  else tickets.push(record);
  await persist();
  return record;
}

export async function updateTicket(id, patch) {
  const tickets = await load();
  const index = tickets.findIndex((t) => t.id === id);
  if (index < 0) return null;
  tickets[index] = { ...tickets[index], ...patch };
  await persist();
  return tickets[index];
}

export async function markClosed(id, { resolved, closedBy, closedByTag, resolution }) {
  return updateTicket(id, {
    status: resolved ? 'resolved' : 'unresolved',
    closedAt: Date.now(),
    closedBy: closedBy ?? null,
    closedByTag: closedByTag ?? null,
    resolution: resolution ?? null,
  });
}

export async function markDeleted(id, deletedBy) {
  return updateTicket(id, { channelDeleted: true, deletedBy: deletedBy ?? null });
}

export async function getTicket(id) {
  const tickets = await load();
  return tickets.find((t) => t.id === id) ?? null;
}

export async function listUserTickets(userId) {
  const tickets = await load();
  return tickets
    .filter((t) => t.userId === userId)
    .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0));
}

export async function userStats(userId) {
  const tickets = await listUserTickets(userId);
  return {
    total: tickets.length,
    open: tickets.filter((t) => t.status === 'open').length,
    resolved: tickets.filter((t) => t.status === 'resolved').length,
    unresolved: tickets.filter((t) => t.status === 'unresolved').length,
  };
}
