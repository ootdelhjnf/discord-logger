import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const CODES_API = 'https://api.fairgambling.com/api/codes';
const CODES_SSE = 'https://api.fairgambling.com/api/codes/live';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function normalizeCode(raw) {
  const slug = String(raw.casinoSlug ?? '').toLowerCase();
  return {
    key: `${slug}:${raw.code}`,
    code: String(raw.code ?? ''),
    casino: raw.casinoName ?? raw.casino ?? slug,
    slug,
    value: Number(raw.codeValue ?? raw.value ?? 0),
    claims: Number(raw.numberOfClaims ?? raw.claims ?? 0),
    wager: Number(raw.wagerRequirement ?? 0),
    wagerTimeframe: raw.wagerRequirementTimeframe ?? raw.wagerTimeframe ?? null,
    endAt: raw.endAt ? Date.parse(raw.endAt) : null,
    createdAt: raw.createdAt ? Date.parse(raw.createdAt) : Date.now(),
  };
}

function money(value) {
  if (!value) return '—';
  if (value >= 1000) return `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`;
  return `$${value.toFixed(2)}`;
}

function valuePer1k(entry) {
  if (!entry.wager || !entry.value) return '—';
  return `$${(entry.value / (entry.wager / 1000)).toFixed(2)}`;
}

export async function fetchCodes(slugs = []) {
  const query = slugs.length === 1 ? `?casinoSlug=${encodeURIComponent(slugs[0])}` : '';
  const res = await fetch(`${CODES_API}${query}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`fairgambling ${res.status}`);
  const body = await res.json();
  return (body?.data ?? []).map(normalizeCode);
}

export function startCodeStream({ onCodes, onLog = () => {}, pollMs = 60_000 }) {
  let stopped = false;
  let controller = null;
  let attempt = 0;

  const emit = (list) => {
    const codes = (list ?? []).map(normalizeCode).filter((c) => c.code);
    if (codes.length) onCodes(codes);
  };

  const poll = async () => {
    if (stopped) return;
    try {
      const codes = await fetchCodes();
      if (codes.length) onCodes(codes);
    } catch (err) {
      onLog(`polling codici fallito: ${err.message}`);
    }
  };

  const connect = async () => {
    if (stopped) return;
    controller = new AbortController();
    try {
      const res = await fetch(CODES_SSE, {
        headers: { 'User-Agent': UA, Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
      attempt = 0;
      onLog('stream codici connesso');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split;
        while ((split = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const data = chunk
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('');
          if (!data) continue;
          try {
            const payload = JSON.parse(data);
            emit(payload?.codes ?? (Array.isArray(payload) ? payload : [payload]));
          } catch {
            onLog('payload SSE non valido');
          }
        }
      }
    } catch (err) {
      if (!stopped) onLog(`stream codici interrotto: ${err.message}`);
    }

    if (stopped) return;
    attempt += 1;
    const wait = Math.min(30_000, 2000 * attempt);
    setTimeout(connect, wait).unref?.();
  };

  connect();
  poll();
  const timer = setInterval(poll, pollMs);
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
    controller?.abort();
  };
}

export function buildCodeMessage(entry, { mention = '', redeemUrl = null, pingRoleId = null, emoji = '' } = {}) {
  const badge = emoji ? `${emoji} ` : '';
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle(`🎁 New ${entry.casino} code drop`)
    .setDescription(`${badge}**${entry.casino}** just dropped a code\n## \`${entry.code}\`\nCopy it and redeem it **right now**, these drops last only a few minutes.`)
    .addFields(
      { name: '💰 Value', value: money(entry.value), inline: true },
      { name: '🎫 Total claims', value: entry.claims ? entry.claims.toLocaleString('en-US') : '—', inline: true },
      { name: '🎯 Wager req', value: entry.wager ? `${money(entry.wager)}${entry.wagerTimeframe ? ` · ${entry.wagerTimeframe}` : ''}` : '—', inline: true },
      { name: '📊 Value per 1K', value: valuePer1k(entry), inline: true },
      { name: '⏳ Expires', value: entry.endAt ? `<t:${Math.floor(entry.endAt / 1000)}:R>` : 'unknown', inline: true },
      { name: '🏷️ Casino', value: `${badge}${entry.casino}`, inline: true },
    )
    .setFooter({ text: 'Source: fairgambling.com/livecodes' })
    .setTimestamp(new Date(entry.createdAt));

  const row = new ActionRowBuilder();
  if (redeemUrl) {
    row.addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(`Redeem on ${entry.casino}`).setEmoji(emoji || '🎰').setURL(redeemUrl),
    );
  }
  row.addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Live codes feed').setEmoji('📡').setURL('https://www.fairgambling.com/livecodes'),
  );
  if (pingRoleId) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('codes_notify_toggle')
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Notify me / stop')
        .setEmoji('🔔'),
    );
  }

  return { content: mention || undefined, embeds: [embed], components: [row] };
}

export function expiredCodeMessage(entry, { redeemUrl = null, emoji = '' } = {}) {
  const badge = emoji ? `${emoji} ` : '';
  const embed = new EmbedBuilder()
    .setColor(0x4b5563)
    .setTitle(`⌛ ${entry.casino} code expired`)
    .setDescription(`${badge}~~\`${entry.code}\`~~\nThis drop is over. Stay tuned, a new one lands soon.`)
    .addFields(
      { name: '💰 Value', value: money(entry.value), inline: true },
      { name: '🎫 Total claims', value: entry.claims ? entry.claims.toLocaleString('en-US') : '—', inline: true },
      { name: '⏳ Ended', value: entry.endAt ? `<t:${Math.floor(entry.endAt / 1000)}:R>` : 'unknown', inline: true },
    )
    .setFooter({ text: 'Source: fairgambling.com/livecodes' })
    .setTimestamp(new Date());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Live codes feed').setEmoji('📡').setURL('https://www.fairgambling.com/livecodes'),
  );
  if (redeemUrl) {
    row.addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(`Go to ${entry.casino}`).setEmoji(emoji || '🎰').setURL(redeemUrl),
    );
  }

  return { content: '', embeds: [embed], components: [row] };
}
