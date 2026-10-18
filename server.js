// node:sqlite needs Node 22.13+; no other dependencies
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = process.env.PORT === undefined ? 8765 : Number(process.env.PORT);
const root = import.meta.dirname;
const database = new DatabaseSync(process.env.DATABASE || join(root, 'sessions.sqlite'));
database.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS sessions (name TEXT PRIMARY KEY, query TEXT NOT NULL, count INTEGER NOT NULL, savedAt INTEGER NOT NULL)`);
const statements = {
  list: database.prepare('SELECT name, query, count, savedAt FROM sessions ORDER BY savedAt DESC'),
  save: database.prepare('INSERT INTO sessions (name, query, count, savedAt) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET query = excluded.query, count = excluded.count, savedAt = excluded.savedAt'),
  rename: database.prepare('UPDATE sessions SET name = ? WHERE name = ?'),
  remove: database.prepare('DELETE FROM sessions WHERE name = ?'),
};
const cleanName = name => typeof name === 'string' && name.trim().slice(0, 100);

// only the app's own files, so the database, server code and .git stay private
const PUBLIC_FILES = { '/index.html': 'text/html; charset=utf-8', '/app.js': 'text/javascript', '/items.js': 'text/javascript', '/style.css': 'text/css',
  '/manifest.webmanifest': 'application/manifest+json', '/icon-192.png': 'image/png', '/icon-512.png': 'image/png' };
const sendJson = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
};
const readBody = request => new Promise(resolve => {
  let data = '';
  request.on('data', chunk => { data += chunk; });
  request.on('end', () => resolve(data));
});

async function handleSessions(request, response, pathname) {
  if (pathname === '/api/sessions' && request.method === 'GET') return sendJson(response, 200, statements.list.all());
  if (pathname === '/api/sessions' && request.method === 'POST') {
    const { name, query, count } = JSON.parse(await readBody(request)), cleanedName = cleanName(name);
    if (!cleanedName || typeof query !== 'string') return sendJson(response, 400, { error: 'Name and query are required' });
    statements.save.run(cleanedName, query, count | 0, Date.now());
    return sendJson(response, 200, statements.list.all());
  }
  const single = pathname.match(/^\/api\/sessions\/(.+)$/), name = single && decodeURIComponent(single[1]);
  if (single && request.method === 'DELETE') {
    statements.remove.run(name);
    return sendJson(response, 200, statements.list.all());
  }
  if (single && request.method === 'PATCH') {
    const newName = cleanName(JSON.parse(await readBody(request)).name);
    if (!newName) return sendJson(response, 400, { error: 'Name is required' });
    try { statements.rename.run(newName, name); }
    catch (error) { if (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE/.test(error.message)) return sendJson(response, 409, { error: 'A session with that name already exists' }); throw error; }
    return sendJson(response, 200, statements.list.all());
  }
  sendJson(response, 404, { error: 'Not found' });
}

async function handleStatic(response, pathname) {
  const file = pathname === '/' ? '/index.html' : pathname, type = PUBLIC_FILES[file];
  if (!type) return sendJson(response, 404, { error: 'Not found' });
  response.writeHead(200, { 'Content-Type': type });
  response.end(await readFile(join(root, file)));
}

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost');
  try {
    await (pathname.startsWith('/api/') ? handleSessions(request, response, pathname) : handleStatic(response, pathname));
  } catch (error) {
    console.error(error);
    const badRequest = error instanceof SyntaxError || error instanceof URIError;
    sendJson(response, badRequest ? 400 : 500, { error: badRequest ? 'Invalid request' : 'Server error' });
  }
});
server.listen(PORT, () => console.log(`Visual Compare running at http://localhost:${server.address().port}`));
