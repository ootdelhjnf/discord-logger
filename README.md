# Bot log entrate/uscite Discord

Logga in un canale ogni membro che entra o esce dal server, con avatar, data creazione account, ruoli posseduti e (se disponibile) se è stato kickato/bannato e da chi.

## Cosa serve

1. **Token del bot** — https://discord.com/developers/applications → New Application → Bot → Reset Token
2. **ID del server** (GUILD_ID) — Discord → Impostazioni → Avanzate → Modalità sviluppatore ON → tasto destro sul server → Copia ID server
3. **ID del canale di log** (LOG_CHANNEL_ID) — tasto destro sul canale testuale → Copia ID canale

## Configurazione obbligatoria nel Developer Portal

Nella sezione **Bot** attiva:

- `SERVER MEMBERS INTENT` (obbligatorio, senza questo non arrivano gli eventi di entrata/uscita)

## Invito del bot nel server

Nella sezione **OAuth2 → URL Generator**:

- Scopes: `bot`
- Permissions: `View Channels`, `Send Messages`, `Embed Links`, `Read Message History`, `View Audit Log`

Apri l'URL generato e aggiungi il bot al server. Serve il permesso "Gestisci server" su quel server (o un admin che approvi l'invito).

## Avvio

```
npm install
copy .env.example .env
npm start
```

Compila `.env` con i tre valori prima di avviare.
