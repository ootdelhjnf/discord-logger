import { Client, GatewayIntentBits } from 'discord.js';

const ID = '1540805512734703696';
const candidates = [
  '💰・ᴅʀᴏᴘᴘᴇᴅ: $124.50',
  '💰・$124-ᴅʀᴏᴘᴘᴇᴅ',
  '💰・124-ᴜsᴅ-ᴅʀᴏᴘᴘᴇᴅ',
  '💰・ᴅʀᴏᴘs-sᴛᴀᴛs',
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  const channel = await client.channels.fetch(ID);
  for (const name of candidates) {
    const updated = await channel.setName(name).catch((e) => ({ name: 'ERR ' + e.message.slice(0, 50) }));
    console.log(JSON.stringify(name), '->', JSON.stringify(updated.name));
    await new Promise((r) => setTimeout(r, 1500));
  }
  await client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
