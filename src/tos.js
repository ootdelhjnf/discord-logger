import { EmbedBuilder } from 'discord.js';

const PART_ONE = [
  '**By joining and staying in this server you automatically accept every rule below.**',
  'Not reading them is not an excuse. These terms apply in every channel, in voice chats and in direct messages between members of this community.',
  '',
  '**1 · AGE & RESPONSIBLE GAMBLING**',
  '> • This server is strictly **18+**, or the legal gambling age in your country if higher. Underage users are **permanently banned**, no appeal.',
  '> • Gambling is **entertainment, not a source of income**. Never play with money you cannot afford to lose.',
  '> • Nothing posted here is financial advice. Every bet you place is **your own decision and your own responsibility**.',
  '> • If gambling stops being fun, stop playing and use the self-exclusion tools of your operator or a national help line.',
  '> • Promoting gambling to minors, or encouraging someone to chase losses, results in an immediate ban.',
  '',
  '**2 · GENERAL CONDUCT**',
  '> • Treat everyone with respect. Insults, racism, sexism, homophobia, hate speech and personal attacks are not tolerated.',
  '> • No harassment, threats, stalking, doxxing or sharing anyone\'s private information.',
  '> • No NSFW, gore, shock content or anything illegal.',
  '> • No spam, flooding, wall of emojis, caps abuse, copypasta or mass mentions.',
  '> • **One account per person.** Alternate accounts used to evade a sanction lead to a permanent ban on every account.',
  '> • Do not impersonate the streamer, the staff, other members or any brand.',
  '',
  '**3 · GAMBLING & THE SITES WE PROMOTE**',
  '> • **We are not a casino.** We do not hold your funds and we have no access to your account, balance, deposits, withdrawals, bonuses or KYC verification.',
  '> • Any problem with your account on a gambling site must go to **that site\'s official support first**. Only after they fail to solve it, open a ticket here and attach their reply.',
  '> • **Never** ask for money, tips, loans, free bonuses or "a small deposit" from the streamer or from other members.',
  '> • Selling, buying, trading or renting accounts, bonus codes or gambling services is forbidden.',
  '> • Sharing "guaranteed win" systems, predictors, bots, cheats or hacked apps results in an **instant permanent ban**.',
  '> • Do not post other people\'s referral or affiliate links.',
].join('\n');

const PART_TWO = [
  '**4 · ADVERTISING & SELF-PROMOTION**',
  '> • No advertising of other streamers, servers, channels, referral links or services without written permission from the staff.',
  '> • **Advertising in direct messages** to our members is forbidden and gets you banned on sight. Report anyone who does it.',
  '> • Only official Cousik links are allowed. If you are not sure whether a link is official, ask the staff first.',
  '',
  '**5 · GIVEAWAYS, LEADERBOARDS & REWARDS**',
  '> • You must meet **all** the stated requirements at the moment the winner is drawn.',
  '> • Multi-accounting, fake entries or any attempt to manipulate a leaderboard means **disqualification from every future event** plus a ban.',
  '> • **Edited, fake or stolen screenshots and winning slips lead to a permanent ban.** No second chance.',
  '> • Winners must claim their prize within the announced deadline, otherwise the prize is rerolled.',
  '> • Prizes are not transferable, not exchangeable and not convertible into cash unless stated otherwise.',
  '> • Staff decisions on any event are **final**.',
  '',
  '**6 · SUPPORT & TICKETS**',
  '> • Use the ticket panel. **Do not direct message the staff** for support, you will be ignored.',
  '> • Every ticket must have a clear and legitimate reason, with details and proof from the first message.',
  '> • One ticket at a time. Duplicate or empty tickets are deleted.',
  '',
  '**7 · SAFETY & SCAM PREVENTION**',
  '> • **The staff will never contact you first** asking for money, passwords, account details, payment data or a "verification deposit". Anyone who does is a scammer.',
  '> • Never share passwords, one time codes, documents or payment information with anyone, staff included.',
  '> • Report suspicious direct messages immediately through a ticket, with screenshots.',
  '',
  '**8 · ENFORCEMENT**',
  '> • Sanctions escalate as warning → mute → kick → ban, but the staff may skip straight to a ban for serious violations.',
  '> • The staff may act on the spirit of these rules even in situations not listed here.',
  '> • Appeals are handled **only** through a ticket, calmly and once. Arguing publicly makes it worse.',
  '',
  '**9 · CHANGES**',
  '> • These terms can be updated at any time. The version published in this channel is always the one in force.',
  '> • Staying in the server after an update means you accept the new version.',
].join('\n');

export function buildTos(imageName, guildName = 'Cousik Community') {
  const head = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📜 Terms of Service & Server Rules')
    .setDescription(PART_ONE)
    .setImage(`attachment://${imageName}`);

  const tail = new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription(PART_TWO)
    .setFooter({ text: `${guildName} · 18+ · Play responsibly` });

  return { embeds: [head, tail] };
}
