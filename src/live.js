import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

function pickThumbnail(data) {
  const live = data.livestream;
  return (
    live?.thumbnail?.url
    ?? live?.thumbnail?.src
    ?? data.offline_banner_image?.src
    ?? data.banner_image?.url
    ?? null
  );
}

function categoryName(data) {
  const live = data.livestream;
  return (
    live?.categories?.[0]?.name
    ?? data.recent_categories?.[0]?.name
    ?? null
  );
}

function streamStartedAt(live) {
  const raw = live?.start_time ?? live?.created_at;
  const ms = raw ? Date.parse(String(raw).replace(' ', 'T') + (String(raw).endsWith('Z') ? '' : 'Z')) : NaN;
  return Number.isNaN(ms) ? Date.now() : ms;
}

export function buildLiveAnnouncement(data, slug, { mention = '', pingRoleId = null } = {}) {
  const url = `https://kick.com/${slug}`;
  const live = data.livestream;
  const displayName = data.user?.username ?? slug;
  const avatar = data.user?.profile_pic ?? null;
  const startedAt = streamStartedAt(live);

  const embed = new EmbedBuilder()
    .setColor(0xff3131)
    .setAuthor({ name: displayName, url, iconURL: avatar ?? undefined })
    .setTitle(`🔴 ${displayName} is LIVE on Kick!`.slice(0, 250))
    .setURL(url)
    .setDescription(
      [
        live?.session_title ? `**${live.session_title}**` : '**The stream just started.**',
        '',
        'Jump in now, chat with us and do not miss the drops and the giveaways.',
      ].join('\n'),
    )
    .addFields({ name: 'Started', value: `<t:${Math.floor(startedAt / 1000)}:R>`, inline: true });

  const cat = categoryName(data);
  if (cat) embed.addFields({ name: 'Category', value: cat, inline: true });
  if (typeof data.followers_count === 'number') {
    embed.addFields({ name: 'Followers', value: data.followers_count.toLocaleString('en-US'), inline: true });
  }

  const thumb = pickThumbnail(data);
  if (thumb) embed.setImage(thumb);
  embed.setFooter({ text: 'Kick live notification' }).setTimestamp(new Date());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Watch the stream').setEmoji('🔴').setURL(url),
  );
  if (pingRoleId) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('live_notify_toggle')
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Notify me / stop notifying me')
        .setEmoji('🔔'),
    );
  }

  return { content: mention || undefined, embeds: [embed], components: [row] };
}

export function buildLiveMessage(data, slug) {
  const url = `https://kick.com/${slug}`;
  const live = data.livestream;
  const isLive = Boolean(live);
  const followers = Number(data.followers_count ?? 0).toLocaleString('en-US');
  const avatar = data.user?.profile_pic ?? null;
  const displayName = data.user?.username ?? slug;

  const embed = new EmbedBuilder()
    .setColor(isLive ? 0xff3131 : 0x2b2d31)
    .setAuthor({ name: displayName, url, iconURL: avatar ?? undefined })
    .setURL(url);

  if (isLive) {
    embed
      .setTitle(`🔴 LIVE NOW — ${live.session_title ?? 'Live stream'}`.slice(0, 250))
      .setDescription(`**${displayName}** is streaming right now. Click the button below to join the stream.`)
      .addFields(
        { name: 'Viewers', value: `${Number(live.viewer_count ?? 0).toLocaleString('en-US')}`, inline: true },
        { name: 'Followers', value: followers, inline: true },
      );
    const cat = categoryName(data);
    if (cat) embed.addFields({ name: 'Category', value: cat, inline: true });
  } else {
    embed
      .setTitle('⚫ Currently offline')
      .setDescription(
        `**${displayName}** is not live at the moment.\n\nFollow the channel on Kick so you get notified the second the stream starts.`,
      )
      .addFields({ name: 'Followers', value: followers, inline: true });
    const cat = categoryName(data);
    if (cat) embed.addFields({ name: 'Last category', value: cat, inline: true });
  }

  const thumb = pickThumbnail(data);
  if (thumb) embed.setImage(thumb);
  embed.setFooter({ text: 'Updated automatically' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(isLive ? 'Watch the stream' : 'Follow on Kick')
      .setEmoji(isLive ? '🔴' : '💚')
      .setURL(url),
  );

  return { embeds: [embed], components: [row] };
}
