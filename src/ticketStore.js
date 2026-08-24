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
    cache = {
      tickets: Array.isArray(parsed?.tickets) ? parsed.tickets : [],
      anonModes: parsed?.anonModes && typeof parsed.anonModes === 'object' ? parsed.anonModes : {},
    };
  } catch {
    cache = { tickets: [], anonModes: {} };
  }
  return cache;
}

async function loadTickets() {
  return (await load()).tickets;
}

async function persist() {
  const snapshot = cache ?? { tickets: [], anonModes: {} };
  writing = writing.then(async () => {
    await mkdir(dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
    await rename(tmp, FILE);
  }).catch((err) => console.error('Salvataggio storico ticket fallito:', err.message));
  return writing;
}

function normalizeAnonEntry(raw) {
  if (Array.isArray(raw)) return Object.fromEntries(raw.map((id) => [id, null]));
  return raw && typeof raw === 'object' ? raw : {};
}

export async function getAnonStaff(channelId) {
  const state = await load();
  return normalizeAnonEntry(state.anonModes[channelId]);
}

export async function setAnonStaff(channelId, userId, enabled, alias = null) {
  const state = await load();
  const current = normalizeAnonEntry(state.anonModes[channelId]);

  if (enabled) current[userId] = alias;
  else delete current[userId];

  if (Object.keys(current).length) state.anonModes[channelId] = current;
  else delete state.anonModes[channelId];
  await persist();
  return enabled;
}

export async function toggleAnonStaff(channelId, userId, alias = null) {
  const current = await getAnonStaff(channelId);
  const enabled = !(userId in current);
  await setAnonStaff(channelId, userId, enabled, alias);
  return enabled;
}

export async function clearAnonStaff(channelId) {
  const state = await load();
  if (!state.anonModes[channelId]) return;
  delete state.anonModes[channelId];
  await persist();
}

export async function recordTicket(entry) {
  const tickets = await loadTickets();
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
  const tickets = await loadTickets();
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
  const tickets = await loadTickets();
  return tickets.find((t) => t.id === id) ?? null;
}

export async function listUserTickets(userId) {
  const tickets = await loadTickets();
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
