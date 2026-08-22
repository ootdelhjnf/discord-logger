import { randomBytes } from 'node:crypto';
import { generateCaptcha } from './captcha.js';

const TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const pending = new Map();

function cleanup() {
  const now = Date.now();
  for (const [token, entry] of pending) {
    if (entry.expiresAt < now) pending.delete(token);
  }
}

export function createVerification(userId, username) {
  cleanup();
  for (const [token, entry] of pending) {
    if (entry.userId === userId) pending.delete(token);
  }
  const token = randomBytes(24).toString('hex');
  const captcha = generateCaptcha();
  pending.set(token, {
    userId,
    username,
    code: captcha.text,
    svg: captcha.svg,
    expiresAt: Date.now() + TTL_MS,
    attempts: 0,
    done: false,
  });
  return token;
}

export function pendingCount() {
  cleanup();
  return pending.size;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function shell(title, body, accent = '#5865f2') {
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 30% 20%,#1e2233,#0b0d14 70%);color:#e5e7eb;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px}
.card{background:#171a24;border:1px solid #2b3040;border-radius:18px;padding:32px;max-width:420px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,.55);text-align:center}
h1{margin:0 0 6px;font-size:22px}
p{color:#9ca3af;font-size:14px;line-height:1.6;margin:0 0 20px}
.badge{display:inline-block;background:${accent}22;color:${accent};border:1px solid ${accent}55;border-radius:999px;padding:5px 14px;font-size:12px;font-weight:600;margin-bottom:16px}
.captcha{background:#0b0d14;border:1px solid #2b3040;border-radius:12px;padding:12px;margin-bottom:18px}
.captcha svg{width:100%;height:auto;display:block;user-select:none;pointer-events:none}
input{width:100%;padding:14px;border-radius:10px;border:1px solid #2b3040;background:#0b0d14;color:#fff;font-size:22px;text-align:center;letter-spacing:8px;text-transform:uppercase;font-weight:700;outline:none}
input:focus{border-color:${accent}}
button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:10px;background:${accent};color:#fff;font-size:15px;font-weight:700;cursor:pointer}
button:hover{filter:brightness(1.12)}
.err{background:#7f1d1d33;border:1px solid #ef444455;color:#fca5a5;border-radius:10px;padding:10px;font-size:13px;margin-bottom:16px}
.ok{font-size:56px;margin-bottom:8px}
.foot{margin-top:20px;font-size:12px;color:#6b7280}
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

function challengePage(entry, token, error) {
  const left = MAX_ATTEMPTS - entry.attempts;
  return shell(
    'Verifica account',
    `<div class="badge">Cousik Community</div>
     <h1>Verifica che non sei un bot</h1>
     <p>Ciao <strong>${escapeHtml(entry.username)}</strong>, digita il codice che vedi qui sotto per ottenere l'accesso al server.</p>
     ${error ? `<div class="err">${escapeHtml(error)} — tentativi rimasti: ${left}</div>` : ''}
     <div class="captcha">${entry.svg}</div>
     <form method="POST" action="/verify/${token}">
       <input name="code" maxlength="5" autocomplete="off" autocapitalize="characters" autofocus required placeholder="CODICE">
       <button type="submit">Verifica</button>
     </form>
     <div class="foot">Il link scade 15 minuti dopo l'ingresso nel server.</div>`,
  );
}

function resultPage(ok, title, message) {
  return shell(
    title,
    `<div class="ok">${ok ? '✅' : '⚠️'}</div>
     <h1>${escapeHtml(title)}</h1>
     <p>${escapeHtml(message)}</p>
     ${ok ? '<div class="foot">Puoi chiudere questa pagina e tornare su Discord.</div>' : '<div class="foot">Torna su Discord e usa il comando /verifica per un nuovo link.</div>'}`,
    ok ? '#22c55e' : '#ef4444',
  );
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    if (chunks.reduce((n, c) => n + c.length, 0) > 4096) break;
  }
  return Buffer.concat(chunks).toString('utf8');
}

function html(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

export async function handleVerify(req, res, pathname, onVerified) {
  cleanup();
  const token = pathname.slice('/verify/'.length).replace(/[^a-f0-9]/gi, '');
  const entry = pending.get(token);

  if (!entry || entry.expiresAt < Date.now()) {
    html(res, 404, resultPage(false, 'Link non valido o scaduto', 'Questo link di verifica non esiste piu.'));
    return;
  }
  if (entry.done) {
    html(res, 200, resultPage(true, 'Gia verificato', 'Il tuo account risulta gia verificato.'));
    return;
  }

  if (req.method === 'GET') {
    html(res, 200, challengePage(entry, token));
    return;
  }
  if (req.method !== 'POST') {
    html(res, 405, resultPage(false, 'Metodo non consentito', 'Usa il modulo della pagina.'));
    return;
  }

  const body = await readBody(req);
  const answer = (new URLSearchParams(body).get('code') || '').trim().toUpperCase();
  entry.attempts += 1;

  if (answer !== entry.code) {
    if (entry.attempts >= MAX_ATTEMPTS) {
      pending.delete(token);
      html(res, 429, resultPage(false, 'Troppi tentativi', 'Hai sbagliato troppe volte.'));
      return;
    }
    const fresh = generateCaptcha();
    entry.code = fresh.text;
    entry.svg = fresh.svg;
    html(res, 200, challengePage(entry, token, 'Codice errato'));
    return;
  }

  entry.done = true;
  pending.delete(token);
  const outcome = await onVerified(entry.userId);
  html(
    res,
    outcome.ok ? 200 : 500,
    outcome.ok
      ? resultPage(true, 'Verifica completata', 'Accesso sbloccato, benvenuto nel server!')
      : resultPage(false, 'Verifica riuscita ma ruolo non assegnato', outcome.message),
  );
}
