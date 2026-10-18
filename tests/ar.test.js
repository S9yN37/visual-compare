import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { describe } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
// Replace only the module-loading boundary; run the app's actual AR event handlers.
const arSource = source.slice(source.indexOf('  const arButton ='), source.indexOf("  find('#fullscreen').hidden"))
  .replaceAll('import(', 'importARModule(');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(options = {}) {
  let query = 'items=custom:Test:100:200:300', freshTap = false, nextURL = 0;
  const listeners = new Map(), timers = new Map(), revoked = [], messages = [], activations = [];
  const stats = { imports: 0, exports: 0, conversions: 0, scale: null };
  let handler, importFailure = options.importFailure;
  const button = {
    label: null, attributes: {},
    append(label) { this.label = label; },
    addEventListener(type, callback) { if (type === 'click') handler = callback; },
    setAttribute(key, value) { this.attributes[key] = value; },
  };
  const viewer = {
    _src: null, iosSrc: null, canActivateAR: options.supported !== false,
    updateComplete: Promise.resolve(),
    classList: { active: false, toggle(name, value) { this.active = value; } },
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    emit(type, detail) { for (const callback of [...(listeners.get(type) ?? [])]) callback({ detail }); },
    get src() { return this._src; },
    set src(value) {
      this._src = value;
      if (value && options.autoLoad !== false) queueMicrotask(() => this.emit('load'));
    },
    async prepareUSDZ() {
      stats.conversions++;
      return options.conversion ? options.conversion.promise : 'blob:usdz';
    },
    activateAR() {
      activations.push({ freshTap, iosSrc: this.iosSrc });
      return options.launch ? options.launch.promise : Promise.resolve();
    },
  };
  class Group {
    scale = { setScalar(value) { stats.scale = value; } };
    add() {}
  }
  class GLTFExporter {
    parse(copy, resolve, reject) {
      stats.exports++;
      if (options.exportFailure) reject(new Error('export failed'));
      else resolve(new ArrayBuffer(8));
    }
  }
  const { invalidatePreparedAR } = vm.runInNewContext(`${arSource}\n({ invalidatePreparedAR })`, {
    find: selector => selector === '#ar' ? button : viewer,
    document: { createElement: () => ({ textContent: '', hidden: false }) },
    navigator: options.ios ? { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5 } : { userAgent: 'Android' },
    matchMedia: () => ({ matches: true }),
    importARModule: async () => {
      stats.imports++;
      if (importFailure) { importFailure = false; throw new Error('import failed'); }
      return { GLTFExporter };
    },
    THREE: { Group }, world: { children: [] }, entries: [{}], toQuery: () => query,
    Blob, URL: {
      createObjectURL: () => `blob:model-${++nextURL}`,
      revokeObjectURL: url => revoked.push(url),
    },
    setTimeout: callback => { const id = Symbol(); timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    console: { error() {} }, toast: message => messages.push(message),
  });
  return {
    button, viewer, stats, messages, activations, revoked,
    click() { freshTap = true; const result = handler(); freshTap = false; return result; },
    change(value = 'items=custom:Changed:200:200:200') { query = value; invalidatePreparedAR(query); },
    timeout() { for (const callback of [...timers.values()]) callback(); },
    pendingListeners() { return (listeners.get('load')?.size ?? 0) + (listeners.get('error')?.size ?? 0); },
    timerCount: () => timers.size,
  };
}

describe('AR', () => {
  test('prepares lazily, then launches synchronously from a fresh second tap', async () => {
    const app = setup();
    assert.equal(app.stats.imports, 0);
    await app.click();
    assert.equal(app.stats.exports, 1);
    assert.equal(app.stats.scale, .001);
    assert.equal(app.activations.length, 0);
    assert.equal(app.button.label.hidden, true);
    assert.equal(app.button.title, 'Start AR');
    assert.equal(app.button.disabled, false);
    assert.equal(app.pendingListeners(), 0);
    assert.equal(app.timerCount(), 0);
    await app.click();
    assert.equal(app.activations.length, 1);
    assert.equal(app.activations[0].freshTap, true);
    assert.equal(app.stats.exports, 1);
  });

  test('converts for Quick Look before the fresh launch tap', async () => {
    const conversion = deferred(), app = setup({ ios: true, conversion });
    const preparing = app.click();
    await flush();
    assert.equal(app.button.disabled, true);
    assert.equal(app.stats.conversions, 1);
    await app.click();
    assert.equal(app.activations.length, 0);
    conversion.resolve('blob:prepared-usdz');
    await preparing;
    await app.click();
    assert.deepEqual(app.activations, [{ freshTap: true, iosSrc: 'blob:prepared-usdz' }]);
  });

  test('ignores repeated taps while the model loads', async () => {
    const app = setup({ autoLoad: false });
    const first = app.click(), second = app.click();
    await flush();
    await second;
    assert.equal(app.stats.exports, 1);
    assert.deepEqual(app.revoked, []);
    assert.equal(app.button.disabled, true);
    app.viewer.emit('load');
    await first;
    assert.equal(app.activations.length, 0);
  });

  for (const failure of ['error', 'timeout']) {
    test(`reports a load ${failure}, cleans up and permits retry`, async () => {
      const app = setup({ autoLoad: false });
      const first = app.click();
      await flush();
      if (failure === 'error') app.viewer.emit('error'); else app.timeout();
      await first;
      assert.match(app.messages.at(-1), /Tap AR to retry/);
      assert.equal(app.button.disabled, false);
      assert.equal(app.pendingListeners(), 0);
      assert.equal(app.timerCount(), 0);
      assert.equal(app.viewer.src, null);
      assert.deepEqual(app.revoked, ['blob:model-1']);
      const retry = app.click();
      await flush();
      app.viewer.emit('load');
      await retry;
      assert.equal(app.button.label.hidden, true);
      assert.equal(app.button.title, 'Start AR');
      assert.equal(app.stats.exports, 2);
    });
  }

  test('reports a rejected launch and permits retry', async () => {
    const launch = deferred(), app = setup({ launch });
    await app.click();
    const starting = app.click();
    assert.equal(app.button.disabled, true);
    await app.click();
    assert.equal(app.activations.length, 1);
    launch.reject(new Error('USDZ launch failed'));
    await starting;
    assert.match(app.messages.at(-1), /could not start/);
    assert.equal(app.button.disabled, false);
    assert.equal(app.button.label.hidden, true);
    assert.equal(app.button.title, 'Start AR');
  });

  test('keeps the viewer active until the session ends', async () => {
    const app = setup();
    await app.click();
    for (const status of ['session-started', 'object-placed']) {
      app.viewer.emit('ar-status', { status });
      assert.equal(app.viewer.classList.active, true);
      assert.equal(app.button.disabled, true);
      await app.click();
    }
    assert.equal(app.activations.length, 0);
    app.viewer.emit('ar-status', { status: 'not-presenting' });
    assert.equal(app.viewer.classList.active, false);
    assert.equal(app.button.disabled, false);
  });

  test('discards prepared files when the comparison changes', async () => {
    const app = setup({ ios: true });
    await app.click();
    app.change();
    assert.equal(app.button.label.textContent, '');
    assert.deepEqual(app.revoked.sort(), ['blob:model-1', 'blob:usdz']);
    assert.equal(app.viewer.src, null);
    assert.equal(app.viewer.iosSrc, null);
    await app.click();
    assert.equal(app.stats.exports, 2);
    assert.equal(app.activations.length, 0);
  });

  test('discards a stale model when the comparison changes during preparation', async () => {
    const app = setup({ autoLoad: false });
    const first = app.click();
    await flush();
    app.change();
    app.viewer.emit('load');
    await first;
    assert.equal(app.button.label.textContent, '');
    assert.equal(app.viewer.src, null);
    assert.match(app.messages.at(-1), /Comparison changed/);
  });

  test('retries loading modules after a failure', async () => {
    const app = setup({ importFailure: true });
    await app.click();
    assert.match(app.messages.at(-1), /could not prepare/);
    assert.equal(app.button.disabled, false);
    await app.click();
    assert.equal(app.stats.imports, 4);
    assert.equal(app.button.label.hidden, true);
    assert.equal(app.button.title, 'Start AR');
  });

  test('cleans up without launching in unsupported browsers', async () => {
    const app = setup({ supported: false });
    await app.click();
    assert.match(app.messages.at(-1), /not available/);
    assert.equal(app.viewer.src, null);
    assert.equal(app.button.disabled, false);
    assert.equal(app.activations.length, 0);
  });
});
