import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] || dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, '_site');
const assets = ['app.js', 'items.js', 'style.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
let html = readFileSync(join(root, 'index.html'), 'utf8');
const hash = createHash('sha256').update(html);
for (const asset of assets) hash.update(asset).update(readFileSync(join(root, asset)));
const version = hash.digest('hex').slice(0, 12);
// only the deployed page gets a CSP, so opening index.html from disk keeps working
const supabase = readFileSync(join(root, 'app.js'), 'utf8').match(/SUPABASE_URL = '([^']+)'/)[1];
const inlineScripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map(([, code]) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`).join(' ');
const policy = `default-src 'self'; script-src 'self' https://cdn.jsdelivr.net ${inlineScripts}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; `
  + `font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' ${supabase} blob: data:; object-src 'none'; base-uri 'none'; form-action 'none'`;
html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${policy}">\n<meta name="app-version" content="${version}">`)
  .replace(/((?:src|href)="(?:app\.js|items\.js|style\.css|manifest\.webmanifest))"/g, `$1?v=${version}"`);
rmSync(output, { recursive: true, force: true });
mkdirSync(output);
for (const asset of assets) copyFileSync(join(root, asset), join(output, asset));
writeFileSync(join(output, 'index.html'), html);
writeFileSync(join(output, 'version.json'), JSON.stringify({ version }) + '\n');
console.log(`App version: ${version}`);
