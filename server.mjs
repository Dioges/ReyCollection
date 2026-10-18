import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// Read local configuration without adding a runtime dependency.
const envFile = path.join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !Object.hasOwn(process.env, match[1])) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const PORT = Number(process.env.PORT || 3000);

let cachedToken = '';
let tokenExpiresAt = 0;
let cachedFilters = null;
let filtersExpiresAt = 0;
let filtersRequest = null;
const mimeTypes = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  response.end(JSON.stringify(data));
}

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw Object.assign(new Error('Configure TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET no arquivo .env.'), { status:503 });

  const body = new URLSearchParams({ client_id:clientId, client_secret:clientSecret, grant_type:'client_credentials' });
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body, signal:AbortSignal.timeout(12000)
  });
  if (!response.ok) throw Object.assign(new Error('A autenticação da IGDB falhou. Confira as credenciais da Twitch.'), { status:502 });
  const token = await response.json();
  cachedToken = token.access_token;
  tokenExpiresAt = Date.now() + Math.max(0, Number(token.expires_in || 0) - 120) * 1000;
  return cachedToken;
}

async function igdbPost(endpoint, body) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId || !process.env.TWITCH_CLIENT_SECRET) throw Object.assign(new Error('Configure TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET no arquivo .env.'), { status:503 });
  const token = await getAccessToken();
  const response = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method:'POST',
    headers:{ 'Client-ID':clientId, 'Authorization':`Bearer ${token}`, 'Accept':'application/json', 'Content-Type':'text/plain' },
    body, signal:AbortSignal.timeout(15000)
  });
  if (response.status === 429) throw Object.assign(new Error('A IGDB limitou as pesquisas por alguns instantes. Tente novamente em breve.'), { status:429 });
  if (!response.ok) throw Object.assign(new Error('A IGDB não conseguiu concluir a pesquisa. Tente novamente.'), { status:502 });
  return response.json();
}

async function getFilterOptions() {
  if (cachedFilters && Date.now() < filtersExpiresAt) return cachedFilters;
  if (filtersRequest) return filtersRequest;
  filtersRequest = (async () => {
    const [platforms, genres, themes] = await Promise.all([
      igdbPost('platforms', 'fields id, name, generation, platform_type.name; sort name asc; limit 500;'),
      igdbPost('genres', 'fields id, name; sort name asc; limit 500;'),
      igdbPost('themes', 'fields id, name; sort name asc; limit 500;')
    ]);
    cachedFilters = {
      platforms:platforms.map(({ id, name, generation, platform_type }) => ({ id, name, generation, platformType:platform_type?.name || '' })).filter(item => item.name),
      genres:genres.map(({ id, name }) => ({ id, name })).filter(item => item.name),
      themes:themes.map(({ id, name }) => ({ id, name })).filter(item => item.name)
    };
    filtersExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
    return cachedFilters;
  })();
  try { return await filtersRequest; } finally { filtersRequest = null; }
}

async function searchGames(query, platformId, genreId) {
  const safeQuery = query.replace(/[\\"\r\n]/g, character => ({ '\\':'\\\\', '"':'\\"', '\r':' ', '\n':' ' })[character]);
  const constraints = ['version_parent = null'];
  let resolvedPlatformId=/^\d+$/.test(platformId)?platformId:'';
  let resolvedGenre=genreId.match(/^(genre|theme):(\d+)$/);
  const platformName=platformId.startsWith('platform-name:')?decodeURIComponent(platformId.slice('platform-name:'.length)):'';
  const genreName=genreId.match(/^(genre|theme)-name:(.+)$/);
  if(platformName||genreName)await getFilterOptions();
  if(platformName){const match=cachedFilters.platforms.find(item=>item.name.toLocaleLowerCase('pt-BR')===platformName.toLocaleLowerCase('pt-BR'));if(match)resolvedPlatformId=String(match.id)}
  if(genreName){const kind=genreName[1],name=decodeURIComponent(genreName[2]),items=kind==='genre'?cachedFilters.genres:cachedFilters.themes,match=items.find(item=>item.name.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR'));if(match)resolvedGenre=[kind,String(match.id)]}
  if(resolvedPlatformId)constraints.push(`platforms = ${resolvedPlatformId}`);
  if(resolvedGenre?.[1])constraints.push(`${resolvedGenre[1]}s = ${resolvedGenre[2]}`);
  const body = `fields name, first_release_date, genres.name, platforms.name, cover.image_id, summary; search "${safeQuery}"; where ${constraints.join(' & ')}; limit 12;`;
  const games = await igdbPost('games', body);
  return games.map(game => ({
    id:game.id,
    name:game.name,
    first_release_date:game.first_release_date || null,
    genres:(game.genres || []).map(genre => genre.name).filter(Boolean),
    platforms:(game.platforms || []).map(platform => platform.name).filter(Boolean),
    coverImage:game.cover?.image_id || null,
    summary:game.summary || ''
  }));
}

async function serveStatic(request, response, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { response.writeHead(400).end('Caminho inválido.'); return; }
  if (pathname === '/') pathname = '/index.html';
  const publicFiles = {
    '/index.html':path.join(ROOT, 'index.html'),
    '/styles.css':path.join(ROOT, 'styles.css'),
    '/app.js':path.join(ROOT, 'app.js')
  };
  const filePath = publicFiles[pathname];
  if (!filePath) { response.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }).end('Arquivo não encontrado.'); return; }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { 'Content-Type':mimeTypes[path.extname(filePath)] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff', 'Cache-Control':'no-cache' });
    response.end(content);
  } catch {
    response.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }).end('Arquivo não encontrado.');
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${PORT}`);
  if (request.method === 'GET' && url.pathname === '/api/igdb/filters') {
    try { sendJson(response, 200, await getFilterOptions()); }
    catch (error) { sendJson(response, error.status || 502, { error:error.status ? error.message : 'Não foi possível carregar os filtros da IGDB.' }); }
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/igdb/search') {
    const query = (url.searchParams.get('q') || '').trim().slice(0, 100);
    if (query.length < 2) { sendJson(response, 400, { error:'Digite pelo menos 2 caracteres para pesquisar.' }); return; }
    const platformId = url.searchParams.get('platform') || '';
    const genreId = url.searchParams.get('genre') || '';
    try { sendJson(response, 200, { games:await searchGames(query, platformId, genreId) }); }
    catch (error) { sendJson(response, error.status || 502, { error:error.status ? error.message : 'Não foi possível acessar a IGDB. Verifique sua conexão e tente novamente.' }); }
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { 'Allow':'GET, HEAD' }).end(); return; }
  await serveStatic(request, response, url);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Rey Collection disponível em http://127.0.0.1:${PORT}`);
});
