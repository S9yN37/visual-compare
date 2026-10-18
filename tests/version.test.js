import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const script = new URL('../scripts/build.js', import.meta.url);
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const check = source.slice(source.indexOf('  async function checkForUpdate()'), source.indexOf('  if (await checkForUpdate())'));

describe('Versioning', () => {
  test('builds deterministic versions without changing sources', () => {
    const directory = mkdtempSync(join(tmpdir(), 'visualcompare-version-'));
    try {
      for (const file of ['index.html', 'app.js', 'items.js', 'style.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']) copyFileSync(new URL(`../${file}`, import.meta.url), join(directory, file));
      const run = () => execFileSync(process.execPath, [fileURLToPath(script), directory]);
      const read = file => readFileSync(join(directory, '_site', file), 'utf8');
      run();
      const original = read('version.json'), html = read('index.html'), version = JSON.parse(original).version;
      assert.equal(readFileSync(join(directory, 'index.html'), 'utf8'), readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
      for (const file of ['app.js', 'items.js', 'style.css']) assert.equal(read(file), readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
      assert.match(version, /^[a-f0-9]{12}$/);
      for (const file of ['app.js', 'items.js', 'style.css']) assert.ok(html.includes(`${file}?v=${version}`));
      writeFileSync(join(directory, '_site', 'obsolete.js'), 'old asset');
      run();
      assert.equal(read('version.json'), original);
      assert.equal(read('index.html'), html);
      assert.deepEqual(readdirSync(join(directory, '_site')).sort(), ['app.js', 'icon-192.png', 'icon-512.png', 'index.html', 'items.js', 'manifest.webmanifest', 'style.css', 'version.json']);
      writeFileSync(join(directory, 'style.css'), read('style.css') + '\nbody { color: red; }\n');
      run();
      assert.notEqual(read('version.json'), original);
      writeFileSync(join(directory, 'index.html'), readFileSync(join(directory, 'index.html'), 'utf8').replace('<title>', '<title>Updated '));
      const previous = read('version.json');
      run();
      assert.notEqual(read('version.json'), previous);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  function loadCheck({ latest = 'bbbbbbbbbbbb', href = 'https://example.com/compare/?items=audio/kef-r3&unit=in#scene', failure, ok = true, version = 'aaaaaaaaaaaa', timeout = false } = {}) {
    const requests = [], redirects = [];
    let expire, cleared = false;
    const location = { protocol: new URL(href).protocol, href, replace: url => redirects.push(url) };
    const checkForUpdate = vm.runInNewContext(`${check}\ncheckForUpdate`, {
      find: () => ({ content: version }), location,
      document: { baseURI: href }, URL, AbortController,
      setTimeout: timeout ? (callback, delay) => { assert.equal(delay, 3000); expire = callback; return 1; } : setTimeout,
      clearTimeout: timeout ? () => { cleared = true; } : clearTimeout,
      fetch: async (url, options) => {
        requests.push({ url, options });
        if (timeout) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('Timed out'))));
        if (failure) throw new Error('Offline');
        return { ok, json: async () => ({ version: latest }) };
      },
    });
    return { checkForUpdate, requests, redirects, expire: () => expire(), timerCleared: () => cleared };
  }

  test('reloads an update without cache and keeps the comparison', async () => {
    const { checkForUpdate, requests, redirects } = loadCheck();
    assert.equal(await checkForUpdate(), true);
    assert.equal(requests[0].options.cache, 'no-store');
    assert.equal(requests[0].url.pathname, '/compare/version.json');
    assert.ok(requests[0].url.searchParams.has('_'));
    const page = new URL(redirects[0]);
    assert.equal(page.searchParams.get('items'), 'audio/kef-r3');
    assert.equal(page.searchParams.get('unit'), 'in');
    assert.equal(page.hash, '#scene');
    assert.equal(page.searchParams.get('_v'), 'bbbbbbbbbbbb');
  });

  test('continues on failures, unchanged versions and repeated reloads', async () => {
    for (const options of [{ failure: true }, { ok: false }, { latest: 'aaaaaaaaaaaa' }, { latest: 'invalid' }, { latest: 123456789012 }, { latest: null }, { version: null },
      { href: 'https://example.com/compare/?_v=bbbbbbbbbbbb' }, { href: 'file:///tmp/index.html' }]) {
      const { checkForUpdate, redirects, requests } = loadCheck(options);
      assert.equal(await checkForUpdate(), false);
      assert.deepEqual(redirects, []);
      if (options.href?.startsWith('file:') || options.version === null) assert.equal(requests.length, 0);
    }
  });

  test('aborts an unresponsive update check without blocking startup', async () => {
    const { checkForUpdate, expire, requests, redirects, timerCleared } = loadCheck({ timeout: true });
    const result = checkForUpdate();
    assert.equal(requests[0].options.signal.aborted, false);
    expire();
    assert.equal(await result, false);
    assert.equal(requests[0].options.signal.aborted, true);
    assert.deepEqual(redirects, []);
    assert.equal(timerCleared(), true);
  });
});
