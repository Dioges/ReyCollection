import { withSupabase } from 'npm:@supabase/server@1';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

let accessToken = '';
let tokenExpiresAt = 0;
let cachedFilters: { platforms: any[]; genres: any[]; themes: any[] } | null = null;
let filtersExpiresAt = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
  const clientId = Deno.env.get('TWITCH_CLIENT_ID');
  const clientSecret = Deno.env.get('TWITCH_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Configure os secrets TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET no Supabase.');
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' });
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!response.ok) throw new Error('A autenticação da IGDB falhou. Confira as credenciais da Twitch.');
  const token = await response.json();
  accessToken = token.access_token;
  tokenExpiresAt = Date.now() + Math.max(0, Number(token.expires_in || 0) - 120) * 1000;
  return accessToken;
}

async function igdbPost(endpoint: string, body: string) {
  const clientId = Deno.env.get('TWITCH_CLIENT_ID');
  const token = await getAccessToken();
  const response = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: 'POST',
    headers: { 'Client-ID': clientId!, 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'Content-Type': 'text/plain' },
    body,
  });
  if (response.status === 429) throw new Error('A IGDB limitou as pesquisas por alguns instantes. Tente novamente em breve.');
  if (!response.ok) throw new Error('A IGDB não conseguiu concluir a pesquisa. Tente novamente.');
  return response.json();
}

async function getFilterOptions() {
  if (cachedFilters && Date.now() < filtersExpiresAt) return cachedFilters;
  const [platforms, genres, themes] = await Promise.all([
    igdbPost('platforms', 'fields id, name, generation, platform_type.name; sort name asc; limit 500;'),
    igdbPost('genres', 'fields id, name; sort name asc; limit 500;'),
    igdbPost('themes', 'fields id, name; sort name asc; limit 500;'),
  ]);
  cachedFilters = {
    platforms: platforms.map(({ id, name, generation, platform_type }: any) => ({ id, name, generation, platformType: platform_type?.name || '' })).filter((item: any) => item.name),
    genres: genres.map(({ id, name }: any) => ({ id, name })).filter((item: any) => item.name),
    themes: themes.map(({ id, name }: any) => ({ id, name })).filter((item: any) => item.name),
  };
  filtersExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
  return cachedFilters;
}

async function searchGames(query: string, platformId = '', genreId = '') {
  const escapedCharacters: Record<string, string> = { '\\': '\\\\', '"': '\\"', '\r': ' ', '\n': ' ' };
  const safeQuery = query.replace(/[\\"\r\n]/g, (character) => escapedCharacters[character]);
  const constraints = ['version_parent = null'];
  let resolvedPlatformId = /^\d+$/.test(platformId) ? platformId : '';
  const genreIdMatch = genreId.match(/^(genre|theme):(\d+)$/);
  let resolvedGenre: [string, string] | null = genreIdMatch ? [genreIdMatch[1], genreIdMatch[2]] : null;
  const platformName = platformId.startsWith('platform-name:') ? decodeURIComponent(platformId.slice('platform-name:'.length)) : '';
  const genreName = genreId.match(/^(genre|theme)-name:(.+)$/);
  if (platformName || genreName) await getFilterOptions();
  if (platformName) {
    const match = cachedFilters!.platforms.find((item) => item.name.toLocaleLowerCase('pt-BR') === platformName.toLocaleLowerCase('pt-BR'));
    if (match) resolvedPlatformId = String(match.id);
  }
  if (genreName) {
    const kind = genreName[1];
    const name = decodeURIComponent(genreName[2]);
    const match = (kind === 'genre' ? cachedFilters!.genres : cachedFilters!.themes).find((item) => item.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));
    if (match) resolvedGenre = [kind, String(match.id)];
  }
  if (resolvedPlatformId) constraints.push(`platforms = ${resolvedPlatformId}`);
  if (resolvedGenre?.[1]) constraints.push(`${resolvedGenre[1]}s = ${resolvedGenre[2]}`);
  const body = `fields name, first_release_date, genres.name, platforms.name, cover.image_id, summary; search "${safeQuery}"; where ${constraints.join(' & ')}; limit 12;`;
  const games = await igdbPost('games', body);
  return games.map((game: any) => ({
    id: game.id,
    name: game.name,
    first_release_date: game.first_release_date || null,
    genres: (game.genres || []).map((genre: any) => genre.name).filter(Boolean),
    platforms: (game.platforms || []).map((platform: any) => platform.name).filter(Boolean),
    coverImage: game.cover?.image_id || null,
    summary: game.summary || '',
  }));
}

Deno.serve(withSupabase({ auth: 'user' }, async (request) => {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  try {
    const body = await request.json();
    if (body.action === 'filters') return json(await getFilterOptions());
    if (body.action === 'search') {
      const query = String(body.q || '').trim().slice(0, 100);
      if (query.length < 2) return json({ error: 'Digite pelo menos 2 caracteres para pesquisar.' }, 400);
      return json({ games: await searchGames(query, String(body.platform || ''), String(body.genre || '')) });
    }
    return json({ error: 'Ação inválida.' }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Não foi possível acessar a IGDB.' }, 502);
  }
}));
