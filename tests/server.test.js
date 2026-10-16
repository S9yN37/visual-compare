import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('server saves and reloads a complete comparison longer than 4,000 characters', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'visualcompare-test-'));
  const child = spawn(process.execPath, [new URL('../server.js', import.meta.url).pathname], {
    env: { ...process.env, PORT: '0', DATABASE: join(directory, 'sessions.sqlite') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  });
  const url = await new Promise((resolve, reject) => {
    let output = '', errors = '';
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${errors}`)), 5000);
    child.stderr.on('data', chunk => { errors += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(errors)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/localhost:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  const query = new URLSearchParams({
    items: Array.from({ length: 100 }, (_, index) => `custom:Review test object ${index}:100:200:300`).join(','),
    view: 'front', unit: 'in',
  }).toString();
  assert.ok(query.length > 4000);
  const response = await fetch(`${url}/api/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Large comparison', query, count: 100 }),
  });
  assert.equal(response.status, 200);
  const saved = (await response.json())[0];
  assert.equal(saved.query, query);
  const reloaded = (await (await fetch(`${url}/api/sessions`)).json())[0];
  assert.equal(reloaded.query, query);
  assert.equal(reloaded.count, 100);
  assert.equal(new URLSearchParams(reloaded.query).get('items').split(',').length, 100);
  assert.equal(new URLSearchParams(reloaded.query).get('unit'), 'in');
});
