const ID_URL = 'https://id.kick.com/oauth/token';
const API_URL = 'https://api.kick.com/public/v1';
const LEGACY_URL = 'https://kick.com/api/v2/channels/';
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

let appToken = null;
let lastFollowers = null;

export function kickApiConfigured() {
  return Boolean(process.env.KICK_CLIENT_ID && process.env.KICK_CLIENT_SECRET);
}

async function getAppToken() {
  if (appToken && appToken.expiresAt > Date.now()) return appToken.value;
  const res = await fetch(ID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.KICK_CLIENT_ID,
      client_secret: process.env.KICK_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`token Kick rifiutato (${res.status})`);
  const data = await res.json();
  appToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60_000 };
  return appToken.value;
}

async function officialGet(path) {
  const token = await getAppToken();
  const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (res.status === 401) appToken = null;
  if (!res.ok) throw new Error(`API Kick ${path} (${res.status})`);
  return res.json();
}

async function legacyFollowers(slug) {
  try {
    const res = await fetch(`${LEGACY_URL}${slug}`, { headers: { ...BROWSER_HEADERS, Referer: `https://kick.com/${slug}` } });
    if (!res.ok) return null;
    const data = await res.json();
    const value = data?.followers_count ?? data?.followersCount;
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

export async function fetchOfficialChannel(slug, knownFollowers = null) {
  const channel = (await officialGet(`/channels?slug=${encodeURIComponent(slug)}`)).data?.[0];
  if (!channel) throw new Error(`canale Kick ${slug} non trovato`);
  const user = (await officialGet(`/users?id=${channel.broadcaster_user_id}`).catch(() => null))?.data?.[0];
  const stream = channel.stream ?? {};
  const followers = (await legacyFollowers(slug)) ?? lastFollowers ?? knownFollowers;
  if (typeof followers === 'number') lastFollowers = followers;
  const category = channel.category?.name ? [{ name: channel.category.name }] : [];
  const data = {
    slug: channel.slug,
    followers_count: typeof followers === 'number' ? followers : undefined,
    user: { username: user?.name ?? channel.slug, profile_pic: user?.profile_picture ?? null },
    banner_image: channel.banner_picture ? { url: channel.banner_picture } : null,
    recent_categories: category,
    livestream: stream.is_live
      ? {
          id: stream.start_time,
          start_time: stream.start_time,
          session_title: channel.stream_title || null,
          viewer_count: stream.viewer_count ?? 0,
          thumbnail: stream.thumbnail ? { url: stream.thumbnail } : null,
          categories: category,
        }
      : null,
  };
  return { data, followers: typeof followers === 'number' ? followers : null };
}
