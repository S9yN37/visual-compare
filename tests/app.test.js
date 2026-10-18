import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
// Exercise the actual browser functions without requiring WebGL or changing file:// support.
function load(start, end, exports, context = {}) {
  return vm.runInNewContext(`${source.slice(source.indexOf(start), source.indexOf(end))}\n({${exports}})`, context);
}
const { parseSize } = load('  const UNIT_FACTORS', '  const formatNumber', 'parseSize', {
  isPositive: value => Number.isFinite(value) && value > 0,
});
const definitions = source.slice(source.indexOf('  const cornerRadius'), source.indexOf('  // all state'));
const volume = source.slice(source.indexOf('  function computeVolume'), source.indexOf("  const stage ="));
const { customDefinition, computeVolume } = vm.runInNewContext(`${definitions}\n${volume}\n({customDefinition, computeVolume})`);

test('dimensions preserve supported units, separators and range behavior', () => {
  const cases = [
    ['380 x 158 x 8 mm', 'cm', [380, 158, 8]],
    ['380 X 158 X 8 MM', 'cm', [380, 158, 8]],
    ['12in × 4.5in × 1.2in', 'mm', [304.8, 114.3, 30.48]],
    ['10 20 30 cm', 'mm', [100, 200, 300]],
    ['10; 20; 30', 'cm', [100, 200, 300]],
    ['1,5 x 2,5 x 3,5 cm', 'mm', [15, 25, 35]],
    ['0.41 - 1.09 cm x 2 cm x 3 cm', 'mm', [10.9, 20, 30]],
    ['1 in - 2 cm x 3 cm x 4 cm', 'mm', [25.4, 30, 40]],
    ['2 cm - 1 in x 3 cm x 4 cm', 'mm', [25.4, 30, 40]],
    ['2 - 1 in x 3 cm x 4 cm', 'mm', [50.8, 30, 40]],
    ['1 in x 2 x 3 cm', 'mm', [25.4, 20, 30]],
  ];
  for (const [input, unit, expected] of cases) {
    assert.deepEqual(Array.from(parseSize(input, unit).values), expected, input);
  }
});

test('dimensions reject negative values, unsupported units and unparsed text', () => {
  for (const input of ['-10 x 20 x 30 mm', '10 x -20 x 30', '10--20 x 30 x 40',
    '0 x 20 x 30', '10 km x 20 x 30', '10 x 20 x 30 garbage', '10.2.3 x 20 x 30',
    '10 x 20', '10 x 20 x 30 x 40', 'ten 10 x 20 x 30']) {
    assert.equal(parseSize(input, 'mm'), null, input);
  }
});

test('rounded box volume and saved radius use the rendered radius', () => {
  const definition = customDefinition('Rounded', 100, 100, 100, 1000);
  assert.equal(definition.radius, 50);
  assert.equal(definition.key, 'custom:Rounded:100:100:100:50');
  assert.ok(Math.abs(computeVolume(definition) - Math.PI * 50 ** 2 * 100) < 1e-8);
  assert.equal(computeVolume({ ...definition, radius: 1000 }), computeVolume(definition));
  assert.equal(computeVolume(customDefinition('Box', 10, 20, 30)), 6000);
});

test('saved spacing presets follow updated values while invalid settings use defaults', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const { sanitizeSetting } = load('  const settingValue', '  function parseEntry', 'sanitizeSetting', {
    DEFAULTS: { spacing: 1, opacity: 1 }, CSS: { escape: value => value },
    find: selector => selector.startsWith('[data-setting=') && html.includes(selector.replaceAll('][', ' ').replaceAll('[', '').replaceAll(']', '')),
  });
  for (const [saved, expected] of [['5', 3], ['20', 13], ['3', 3], ['13', 13], ['0', 0], ['1', 1], ['bad', 1]]) {
    assert.equal(sanitizeSetting('spacing', saved), expected);
  }
  assert.equal(sanitizeSetting('opacity', '0.5'), .5);
  assert.equal(sanitizeSetting('opacity', '5'), 1);
});

test('keyboard toggles use option controls and Shift+F opens fullscreen without fitting', () => {
  for (const fullscreenEnabled of [true, false]) {
    let keydown, fits = 0, fullscreens = 0, clears = 0, itemMenus = 0;
    const library = { title: 'Items', setAttribute() {}, click() { itemMenus++; } };
    const help = {}, commits = [], rotations = [], pans = [], selections = [], options = Object.fromEntries(['labels', 'perspective', 'autoRotate', 'grid', 'sort'].map(option => [option, {
      checked: false, dataset: { option }, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, handler) { this.input = handler; },
      click() { this.checked = !this.checked; this.input(); },
    }]));
    const context = {
      document: { fullscreenEnabled, addEventListener(name, handler) { keydown = handler; } }, escapeHtml: value => value,
      fitButton: { title: 'Fit', setAttribute() {}, click() { fits++; } },
      clearButton: { title: 'Clear Scene', setAttribute() {}, click() { clears++; } },
      findAll: selector => selector === '[data-option]' ? Object.values(options) : [],
      find: selector => {
        if (selector === '#shortcuts') return help;
        if (selector === '[data-popover="library"]') return library;
        if (selector === '#fullscreen') return { title: 'Fullscreen', setAttribute() {}, click() { fullscreens++; } };
        return options[selector.match(/data-option="(.*?)"/)?.[1]] || { title: 'Other', setAttribute() {}, click() {} };
      },
      settings: {}, REFIT_SETTINGS: new Set(['labels', 'perspective', 'grid', 'sort']),
      entries: [{}, {}, {}], pickedIndex: null,
      pick(index) { selections.push(index); context.pickedIndex = index; },
      rotateCamera: (...angles) => rotations.push(angles),
      panCamera: (...directions) => pans.push(directions),
      setFitting() {}, fitCamera() {}, fitting: true, commit: refit => commits.push(refit),
    };
    load("  findAll('[data-option]').forEach(input => input.addEventListener", "  find('#reset').addEventListener", '', context);
    load('  const KEY_NAMES', "  matchMedia('(prefers-color-scheme: dark)')", '', context);
    assert.equal(context.fitButton.title, 'Fit (F)');
    assert.equal(context.clearButton.title, 'Clear Scene (Shift+C)');
    assert.equal(options.labels.title, 'Labels (L)');
    assert.equal(options.perspective.title, 'Perspective Camera (P)');
    assert.equal(options.labels.attributes['aria-keyshortcuts'], 'L');
    assert.ok(!help.innerHTML.includes('Fit (F)'));
    assert.equal(library.title, 'Items (I)');
    const press = (key, extras = {}) => {
      let prevented = false;
      keydown({ key, target: { closest: () => false }, preventDefault() { prevented = true; }, ...extras });
      return prevented;
    };
    for (const [key, option] of [['l', 'labels'], ['p', 'perspective'], ['r', 'autoRotate'], ['g', 'grid'], ['s', 'sort']]) {
      assert.equal(press(key), true);
      assert.equal(context.settings[option], 1);
      assert.equal(press(key.toUpperCase(), { shiftKey: true }), true);
      assert.equal(context.settings[option], 0);
    }
    assert.equal(commits.length, 10);
    assert.equal(press('f'), true);
    assert.equal(fits, 1);
    press('F', { shiftKey: true });
    assert.equal(fullscreens, Number(fullscreenEnabled));
    assert.equal(fits, 1);
    assert.equal(help.innerHTML.includes('Shift+F'), fullscreenEnabled);
    assert.equal(press('c'), false);
    assert.equal(clears, 0);
    assert.equal(press('C', { shiftKey: true }), true);
    assert.equal(clears, 1);
    press('C', { shiftKey: true, repeat: true });
    assert.equal(clears, 1);
    press('l', { repeat: true });
    assert.equal(context.settings.labels, 0);
    press('F', { shiftKey: true, repeat: true });
    assert.equal(fullscreens, Number(fullscreenEnabled));
    assert.equal(help.innerHTML.includes('Shift+C'), true);
    assert.equal((help.innerHTML.match(/<section>/g) || []).length, 3);
    for (const group of ['View & Camera', 'Items & Layout', 'Display & Options']) assert.ok(help.innerHTML.includes(group));
    assert.ok(help.innerHTML.includes('<kbd>Space</kbd> <kbd>Shift+Space</kbd></dt><dd>Next / Previous Item</dd>'));
    assert.ok(help.innerHTML.includes('<kbd>+</kbd> <kbd>-</kbd></dt><dd>Zoom In / Out</dd>'));
    assert.ok(!help.innerHTML.includes('<kbd>=</kbd>'));
    for (const label of ['Rotate Left / Right', 'Rotate Up / Down', 'Pan Left / Right', 'Pan Up / Down', 'Zoom In / Out', 'Perspective Camera', 'Align Width', 'Align Depth', 'Opacity', 'Spacing']) {
      assert.equal(help.innerHTML.split(`<dd>${label}</dd>`).length - 1, 1);
    }
    press('i'); assert.equal(itemMenus, 1);
    press(' '); press(' '); press(' '); press(' ');
    press(' ', { shiftKey: true });
    assert.deepEqual(selections, [0, 1, 2, 0, 2]);
    press(' ', { target: { closest: selector => selector.startsWith('button') } });
    press(' ', { defaultPrevented: true });
    assert.equal(selections.length, 5);
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) assert.equal(press(key), true);
    assert.deepEqual(rotations, [[Math.PI / 180, 0], [-Math.PI / 180, 0], [0, Math.PI / 180], [0, -Math.PI / 180]]);
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) assert.equal(press(key, { shiftKey: true }), true);
    assert.deepEqual(pans, [[1, 0], [-1, 0], [0, -1], [0, 1]]);
    assert.equal(rotations.length, 4);
    assert.ok(help.innerHTML.includes('<kbd>Shift+←</kbd> <kbd>Shift+→</kbd>'));
    for (const extras of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { target: { closest: () => true } }, { target: { closest: () => false, isContentEditable: true } }]) {
      assert.equal(press('l', extras), false);
      assert.equal(context.settings.labels, 0);
    }
  }
});

test('keyboard alignment and opacity wrap while spacing stops at preset limits', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const settings = { alignX: 'center', alignZ: 'center', opacity: 1, spacing: 1 }, commits = [], zooms = [];
  const buttons = [...html.matchAll(/data-setting="([^"]+)" data-value="([^"]+)"/g)].map(([, setting, value]) => ({
    dataset: { setting, value }, title: setting, setAttribute() {},
    addEventListener(name, handler) { this.click = handler; },
  }));
  let keydown;
  const context = {
    settings, DEFAULTS: { ...settings }, REFIT_SETTINGS: new Set(['alignX', 'alignZ', 'spacing']),
    setFitting() {}, commit: refit => commits.push(refit),
    zoomCamera: factor => zooms.push(factor),
    findAll: selector => selector === '[data-setting]' ? buttons
      : buttons.filter(button => selector === `[data-setting="${button.dataset.setting}"]`),
    find: () => ({ click() {}, setAttribute() {} }), fitButton: { click() {}, setAttribute() {} }, clearButton: { click() {}, setAttribute() {} },
    document: { addEventListener(name, handler) { keydown = handler; } }, escapeHtml: value => value,
  };
  Object.assign(context, load('  const settingValue', '  function parseEntry', 'settingValue', context));
  load("  findAll('[data-setting]').forEach(button => button.addEventListener", "  findAll('[data-option]').forEach(input => input.addEventListener", '', context);
  load('  const KEY_NAMES', "  matchMedia('(prefers-color-scheme: dark)')", '', context);
  const press = (key, extras = {}) => keydown({ key, target: { closest: () => false }, preventDefault() {}, ...extras });
  press('w'); assert.equal(settings.alignX, 'right');
  press('w'); assert.equal(settings.alignX, 'left');
  press('w'); assert.equal(settings.alignX, 'center');
  press('d'); assert.equal(settings.alignZ, 'front');
  press('d'); assert.equal(settings.alignZ, 'back');
  press('d'); assert.equal(settings.alignZ, 'center');
  for (const opacity of [.25, .5, .75, 1]) {
    press('o'); assert.equal(settings.opacity, opacity);
  }
  for (const alignX of ['left', 'right', 'center']) {
    press('W', { shiftKey: true }); assert.equal(settings.alignX, alignX);
  }
  for (const alignZ of ['back', 'front', 'center']) {
    press('D', { shiftKey: true }); assert.equal(settings.alignZ, alignZ);
  }
  for (const opacity of [.75, .5, .25, 1]) {
    press('O', { shiftKey: true }); assert.equal(settings.opacity, opacity);
  }
  press('-'); press('+'); press('=');
  assert.deepEqual(zooms, [1 / 1.01, 1.01, 1.01]);
  assert.equal(settings.opacity, 1);
  for (const spacing of [3, 13, 13]) {
    press(']'); assert.equal(settings.spacing, spacing);
  }
  for (const spacing of [3, 1, 0, 0]) {
    press('['); assert.equal(settings.spacing, spacing);
  }
  assert.equal(commits.length, 25);
  assert.equal(commits.filter(refit => !refit).length, 8);
});

test('a failed rename preserves the save target and allows a corrected retry', async () => {
  const input = { handlers: {}, focus() {}, select() {}, addEventListener(event, fn) { this.handlers[event] = fn; } };
  const form = { elements: { name: { value: 'A' } } };
  const calls = [], errors = [];
  let rendered;
  const { startRename } = load('  function startRename', "  sessionList.addEventListener", 'startRename', {
    document: { createElement: () => input }, sessionForm: form,
    sessions: { async rename(name, newName) {
      calls.push([name, newName]);
      if (newName === 'B') throw new Error('A session with that name already exists');
      return [{ name: newName }];
    } },
    renderSessions: list => { rendered = list; }, toast: message => errors.push(message),
  });
  startRename({ querySelector: () => ({ replaceWith() {} }) }, 'A');
  input.value = 'B';
  await input.handlers.blur();
  assert.equal(form.elements.name.value, 'A');
  assert.equal(rendered, undefined);
  assert.equal(errors.length, 1);
  input.value = 'C';
  await input.handlers.blur();
  assert.equal(form.elements.name.value, 'C');
  assert.deepEqual(rendered, [{ name: 'C' }]);
  assert.deepEqual(calls, [['A', 'B'], ['A', 'C']]);
});

test('camera movement updates clipping and schedules a render', () => {
  let onChange, clips = 0;
  const { pending, clear } = load('  let renderPending', '  // the browser may drop', 'pending: () => renderPending, clear: () => { renderPending = false; }', {
    controls: { addEventListener: (event, callback) => { if (event === 'change') onChange = callback; } },
    clipToScene: () => clips++,
  });
  clear();
  onChange();
  assert.equal(clips, 1);
  assert.equal(pending(), true);
});

test('keyboard camera rotation preserves radius and uses the orbit interaction lifecycle', () => {
  const events = [], target = {}, offset = {};
  let orbit, origin;
  const context = {
    entries: [{}],
    THREE: {
      Spherical: class {
        setFromVector3(value) { assert.equal(value, offset); this.radius = 100; this.theta = 1; this.phi = .5; return this; }
        makeSafe() { this.phi = Math.max(1e-6, Math.min(Math.PI - 1e-6, this.phi)); }
      },
      Vector3: class { setFromSpherical(value) { orbit = value; return this; } },
    },
    camera: { position: {
      clone: () => ({ sub(value) { assert.equal(value, target); return offset; } }),
      copy(value) { origin = value; return this; }, add() {},
    } },
    controls: { target, dispatchEvent: event => events.push(event.type), update: () => events.push('update') },
  };
  const { rotateCamera } = load('  function rotateCamera(', '  function fitCamera(', 'rotateCamera', context);
  rotateCamera(.1, -.1);
  assert.equal(origin, target);
  assert.equal(orbit.radius, 100);
  assert.equal(orbit.theta, 1.1);
  assert.equal(orbit.phi, .4);
  assert.deepEqual(events, ['start', 'update', 'end']);
  rotateCamera(0, -10);
  assert.ok(orbit.phi > 0);
  rotateCamera(0, 10);
  assert.ok(orbit.phi < Math.PI);
  context.entries = [];
  assert.equal(rotateCamera(.1, .1), false);
});

test('keyboard zoom supports both cameras, respects limits and schedules rendering', () => {
  for (const perspective of [false, true]) {
    const events = [], target = { x: 10 };
    let projections = 0;
    const position = {
      x: 110,
      clone() { return {
        x: this.x, sub(value) { this.x -= value.x; return this; },
        setLength(distance) { this.x = Math.sign(this.x) * distance; return this; },
      }; },
      copy(value) { this.x = value.x; return this; },
      add(value) { this.x += value.x; return this; },
    };
    const camera = { isPerspectiveCamera: perspective, position, zoom: 1, updateProjectionMatrix: () => projections++ };
    const context = {
      entries: [{}], camera,
      controls: {
        target, minDistance: 20, maxDistance: 200, minZoom: .5, maxZoom: 4,
        getDistance: () => Math.abs(position.x - target.x),
        dispatchEvent: event => events.push(event.type), update: () => events.push('update'),
      },
      clipToScene: () => events.push('clip'), requestRender: () => events.push('render'),
    };
    const { zoomCamera } = load('  function zoomCamera(', '  function fitCamera(', 'zoomCamera', context);
    zoomCamera(2);
    assert.equal(perspective ? position.x : camera.zoom, perspective ? 60 : 2);
    assert.deepEqual(events, ['start', 'update', 'clip', 'render', 'end']);
    zoomCamera(100);
    assert.equal(perspective ? position.x : camera.zoom, perspective ? 30 : 4);
    zoomCamera(.001);
    assert.equal(perspective ? position.x : camera.zoom, perspective ? 210 : .5);
    assert.equal(perspective ? camera.zoom : position.x, perspective ? 1 : 110);
    assert.equal(projections, perspective ? 0 : 3);
    context.entries = [];
    assert.equal(zoomCamera(2), false);
    assert.equal(events.length, 15);
  }
});

test('keyboard panning follows screen axes and preserves camera direction and distance', () => {
  class Vector {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    setFromMatrixColumn(matrix, column) { [this.x, this.y, this.z] = matrix[column]; return this; }
    multiplyScalar(scale) { this.x *= scale; this.y *= scale; this.z *= scale; return this; }
    addScaledVector(other, scale) { this.x += other.x * scale; this.y += other.y * scale; this.z += other.z * scale; return this; }
    add(other) { return this.addScaledVector(other, 1); }
  }
  for (const perspective of [false, true]) {
    const events = [], position = new Vector(1, 2, 13), target = new Vector(1, 2, 3);
    const camera = {
      isPerspectiveCamera: perspective, fov: 90, top: 50, bottom: -50, zoom: 2,
      position, matrixWorld: [[0, 0, -1], [0, 1, 0]], updateMatrixWorld: () => events.push('matrix'),
    };
    const context = {
      entries: [{}], camera,
      THREE: { Vector3: Vector, MathUtils: { degToRad: degrees => degrees * Math.PI / 180 } },
      controls: { target, getDistance: () => 10, update: () => events.push('update'), dispatchEvent: event => events.push(event.type) },
      clipToScene: () => events.push('clip'), requestRender: () => events.push('render'),
    };
    const { panCamera } = load('  function panCamera(', '  function fitCamera(', 'panCamera', context);
    panCamera(1, -1);
    const step = perspective ? .2 : .5;
    assert.ok(Math.abs(position.y - (2 - step)) < 1e-10);
    assert.ok(Math.abs(position.z - (13 - step)) < 1e-10);
    assert.equal(position.x - target.x, 0);
    assert.equal(position.y - target.y, 0);
    assert.equal(position.z - target.z, 10);
    assert.deepEqual(events, ['start', 'matrix', 'update', 'clip', 'render', 'end']);
    panCamera(-1, 1);
    assert.ok(Math.abs(position.y - 2) < 1e-10);
    assert.ok(Math.abs(position.z - 13) < 1e-10);
    context.entries = [];
    assert.equal(panCamera(1, 0), false);
    assert.equal(events.length, 12);
  }
});

test('resize schedules rendering even when fitting does nothing', () => {
  let renders = 0;
  const camera = () => ({ updateProjectionMatrix() {} });
  const { resize } = load('  function resize()', '  new ResizeObserver', 'resize', {
    stage: { clientWidth: 800, clientHeight: 600 },
    renderer: { setSize() {} }, labelRenderer: { setSize() {} },
    orthographicCamera: camera(), perspectiveCamera: camera(),
    fitCamera() {}, requestRender: () => renders++,
  });
  resize();
  assert.equal(renders, 1);
});

test('selection refits after the info card opens or closes', () => {
  let visible = false;
  const fitted = [];
  const { pick } = load('  function pick(index)', '  function renderResults()', 'pick', {
    pickedIndex: null,
    highlightPicked() {},
    findAll: () => [],
    renderInfo() { visible = !visible; },
    fitCamera() { fitted.push(visible); },
  });
  pick(0);
  pick(0);
  assert.deepEqual(fitted, [true, false]);
});

test('all mobile cards stay in the scene container above the canvas', () => {
  let mobile = true;
  const panels = Array.from({ length: 6 }, () => ({})), scene = {};
  const stage = {
    before(card) { assert.ok(panels.includes(card)); card.parentElement = scene; },
    append(card) { assert.ok(panels.includes(card)); card.parentElement = stage; },
  };
  const { moveSceneCards } = load('  function moveSceneCards()', '  function resize()', 'moveSceneCards', {
    findAll: () => panels, stage, mobileLayout: { get matches() { return mobile; } },
  });
  moveSceneCards();
  for (const panel of panels) assert.equal(panel.parentElement, scene);
  mobile = false;
  moveSceneCards();
  for (const panel of panels) assert.equal(panel.parentElement, stage);
});

test('canvas selection waits for click and ignores orbit drags', () => {
  const handlers = {}, picks = [];
  load("  renderer.domElement.addEventListener('pointerdown', event => Object.assign(pointerDown", '  function pick(index)', '', {
    renderer: { domElement: { addEventListener(name, handler) { handlers[name] = handler; }, style: {} } },
    pointerDown: { x: 0, y: 0 }, rendered: [],
    requestRender() {},
    objectUnderPointer: () => 2, pick: index => picks.push(index),
  });
  const event = { button: 0, clientX: 50, clientY: 50 };
  handlers.pointerdown(event);
  assert.equal(handlers.pointerup, undefined);
  assert.deepEqual(picks, []);
  handlers.click(event);
  assert.deepEqual(picks, [2]);
  handlers.pointerdown(event);
  handlers.click({ ...event, clientX: 80 });
  assert.deepEqual(picks, [2]);
});

test('info actions reject clicks redirected by layout changes', () => {
  const handlers = {}, actions = [];
  load("  const infoPanel = find('#info');", "  findAll('[data-setting]').forEach(button => button.addEventListener", '', {
    find: () => ({ addEventListener(name, handler) { handlers[name] = handler; } }),
    pickedIndex: 2, applyAction: (index, action) => actions.push([index, action]),
  });
  const remove = { dataset: { action: 'remove' } }, edit = { dataset: { action: 'edit' } };
  const event = (button, detail = 1) => ({ detail, target: { closest: () => button } });
  handlers.click(event(remove));
  handlers.pointerdown(event(edit));
  handlers.click(event(remove));
  assert.deepEqual(actions, []);
  handlers.pointerdown(event(remove));
  handlers.click(event(remove));
  handlers.click(event(edit, 0));
  assert.deepEqual(actions, [[2, 'remove'], [2, 'edit']]);
  handlers.pointerdown(event(remove));
  handlers.pointercancel();
  handlers.click(event(remove));
  assert.equal(actions.length, 2);
});

test('tray drops insert at the indicated side across gaps and wrapped rows', () => {
  const handlers = {}, entries = ['A', 'B', 'C', 'D'];
  const chips = entries.map((_, index) => ({
    dataset: { index },
    getBoundingClientRect: () => ({ left: index % 2 * 108, right: index % 2 * 108 + 100,
      top: Math.floor(index / 2) * 48, bottom: Math.floor(index / 2) * 48 + 40, width: 100 }),
  }));
  let commits = 0, placeholder = null, insertion = null;
  const createPlaceholder = () => ({
    style: {}, setAttribute() {}, remove() { placeholder = null; },
    getBoundingClientRect: () => ({ left: 300, right: 400, top: 0, bottom: 40 }),
  });
  const context = {
    document: { createElement: createPlaceholder },
    tray: {
      addEventListener(name, handler) { handlers[name] = handler; }, querySelectorAll: () => chips,
      contains: () => false,
      insertBefore(element, before) { placeholder = element; insertion = before; },
    },
    entries, pickedIndex: 1, editing: { index: 2 }, settings: { sort: 1 },
    commit: () => commits++,
  };
  load('  let dragIndex = null;', "  const infoPanel = find('#info');", '', context);
  const start = index => handlers.dragstart({ target: { closest: () => chips[index] }, dataTransfer: { setData() {} } });
  const event = (clientX, clientY) => ({ clientX, clientY, preventDefault() {}, dataTransfer: {} });
  start(0);
  handlers.dragover(event(104, 20));
  assert.equal(placeholder.className, 'drop-placeholder');
  assert.equal(placeholder.style.width, '100px');
  assert.equal(chips[0].hidden, true);
  handlers.dragover(event(109, 60));
  assert.equal(insertion, chips[3]);
  handlers.dragover(event(310, 20));
  assert.equal(insertion, chips[3]);
  handlers.drop(event(0, 0));
  assert.deepEqual(entries, ['B', 'C', 'A', 'D']);
  assert.equal(context.pickedIndex, 0);
  assert.equal(context.editing.index, 1);
  assert.equal(context.settings.sort, 0);
  assert.equal(placeholder, null);
  assert.equal(chips[0].hidden, false);
  start(3);
  handlers.drop(event(0, 20));
  assert.deepEqual(entries, ['D', 'B', 'C', 'A']);
  start(0);
  handlers.drop(event(250, 100));
  assert.deepEqual(entries, ['B', 'C', 'A', 'D']);
  assert.equal(commits, 3);
  start(1);
  handlers.drop(event(110, 20));
  assert.equal(commits, 3);
  start(0);
  handlers.dragover(event(180, 60));
  handlers.dragleave({ relatedTarget: null });
  assert.equal(placeholder.style.visibility, 'hidden');
  assert.equal(chips[0].hidden, true);
  handlers.dragend();
  assert.equal(placeholder, null);
  assert.equal(chips[0].hidden, false);
  handlers.drop(event(180, 60));
  assert.equal(commits, 3);
});

function trayWithLayout(widths, trayWidth) {
  const handlers = {}, nodes = [], entries = widths.map(width => ({ width }));
  let commits = 0;
  const makeNode = () => ({
    hidden: false, style: {}, setAttribute() {},
    remove() { nodes.splice(nodes.indexOf(this), 1); },
    getBoundingClientRect() {
      let left = 0, top = 0;
      for (const node of nodes.filter(node => !node.hidden)) {
        const width = parseFloat(node.style.width) || node.width;
        if (left && left + width > trayWidth) { left = 0; top += 48; }
        if (node === this) return { left, right: left + width, top, bottom: top + 40, width, height: 40 };
        left += width + 8;
      }
      return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
    },
    get nextSibling() { return nodes[nodes.indexOf(this) + 1] || null; },
  });
  const chips = widths.map((width, index) => Object.assign(makeNode(), { width, dataset: { index } }));
  nodes.push(...chips);
  const context = {
    document: { createElement: makeNode }, entries, pickedIndex: null, editing: null, settings: { sort: 1 },
    commit: () => commits++,
    tray: {
      addEventListener(name, handler) { handlers[name] = handler; },
      querySelectorAll: () => chips, contains: target => nodes.includes(target),
      insertBefore(node, before) {
        if (nodes.includes(node)) node.remove();
        nodes.splice(before ? nodes.indexOf(before) : nodes.length, 0, node);
      },
    },
  };
  load('  let dragIndex = null;', "  const infoPanel = find('#info');", '', context);
  return { handlers, nodes, chips, context, commits: () => commits,
    start: (index = 0) => handlers.dragstart({ target: { closest: () => chips[index] }, dataTransfer: { setData() {} } }),
  };
}

test('a single-item tray keeps its space when leaving and re-entering a drag', () => {
  const { handlers, nodes, chips: [chip], context, commits, start } = trayWithLayout([100], 220);
  const event = { clientX: 20, clientY: 20, preventDefault() {}, dataTransfer: {} };
  start();
  handlers.dragover(event);
  const placeholder = nodes.find(node => node !== chip);
  assert.equal(placeholder.style.height, '40px');
  assert.equal(chip.hidden, true);
  assert.equal(placeholder.getBoundingClientRect().left, 0);
  handlers.dragleave({ relatedTarget: null });
  assert.equal(placeholder.getBoundingClientRect().height, 40);
  handlers.dragover(event);
  assert.equal(placeholder.style.visibility, '');
  assert.equal(nodes.length, 2);
  handlers.drop(event);
  assert.deepEqual(nodes, [chip]);
  assert.equal(chip.hidden, false);
  assert.equal(context.entries.length, 1);
  assert.equal(commits(), 0);
  assert.equal(context.settings.sort, 1);
  start();
  handlers.dragover(event);
  const { renderTray } = load('  function renderTray()', '  function renderInfo()', 'renderTray', {
    finishDrag: handlers.dragend, rendered: [], find: () => ({}),
  });
  renderTray();
  handlers.drop(event);
  assert.deepEqual(nodes, [chip]);
  assert.equal(chip.hidden, false);
  assert.equal(commits(), 0);
});

test('wrapped drop placeholders stay stable beside row edges and gaps', () => {
  for (const [widths, width, x, y, from = 0] of [
    [[100, 100, 100, 100], 220, 210, 58],
    [[100, 100, 100, 100], 220, 170, 106],
    [[180, 80, 120, 190], 320, 310, 82],
    [[180, 80, 120, 190], 220, 90, 58, 3],
  ]) {
    const { handlers, nodes, start } = trayWithLayout(widths, width);
    start(from);
    const event = { clientX: x, clientY: y, preventDefault() {}, dataTransfer: {} };
    handlers.dragover(event);
    const order = [...nodes];
    for (let repeat = 0; repeat < 5; repeat++) {
      handlers.dragover(event);
      assert.deepEqual(nodes, order);
    }
    handlers.dragover({ ...event, clientX: 5, clientY: 5 });
    assert.equal(nodes.filter(node => !node.hidden)[0].className, 'drop-placeholder');
  }
});

test('labels fit a narrow canvas without clipping or overlapping', () => {
  const rendered = [[-8, 30], [35, 100], [100, 40], [190, 65]].map(([left, top]) => {
    const element = { style: { translate: '' } };
    const rectangle = () => {
      const [x, y] = element.style.translate ? element.style.translate.split(' ').map(parseFloat) : [0, 0];
      return { left: left + x, top: top + y, right: left + x + 120, bottom: top + y + 60, width: 120, height: 60 };
    };
    element.getBoundingClientRect = rectangle;
    element.firstChild = { hidden: false, getBoundingClientRect: rectangle };
    return { labelElement: element };
  });
  const { layoutLabels } = load('  function layoutLabels()', '  function createGeometry(', 'layoutLabels', {
    rendered, getComputedStyle: () => ({ visibility: 'visible' }),
    stage: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 278, bottom: 300 }) },
  });
  for (let frame = 0; frame < 2; frame++) {
    layoutLabels();
    const boxes = rendered.map(item => item.labelElement.getBoundingClientRect());
    for (const [index, box] of boxes.entries()) {
      assert.ok(box.left >= 6 && box.right <= 272 && box.top >= 6 && box.bottom <= 264);
      for (const other of boxes.slice(index + 1))
        assert.ok(box.right <= other.left || box.left >= other.right || box.bottom <= other.top || box.top >= other.bottom);
    }
  }
});

test('invisible rotation controls do not displace a visible control group', () => {
  const rendered = [true, false].map(hidden => {
    const rectangle = { left: 40, top: 40, right: 188, bottom: 88, width: 148, height: 48 };
    return { labelElement: {
      style: { translate: '' }, firstChild: { hidden: true },
      lastElementChild: { hidden, getBoundingClientRect: () => rectangle },
    } };
  });
  const { layoutLabels } = load('  function layoutLabels()', '  function createGeometry(', 'layoutLabels', {
    rendered, getComputedStyle: box => ({ visibility: box.hidden ? 'hidden' : 'visible' }),
    stage: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 278, bottom: 300 }) },
  });
  layoutLabels();
  assert.equal(rendered[0].labelElement.style.translate, '');
  assert.equal(rendered[1].labelElement.style.translate, '0px 0px');
});

test('closing an info card deselects without rebuilding the scene', () => {
  const picked = [];
  const { applyAction } = load('  function applyAction(index, action)', '  function toggle(key)', 'applyAction', {
    pick: index => picked.push(index),
  });
  applyAction(2, 'close');
  assert.deepEqual(picked, [2]);
});

test('removing an edited item cancels the edit before deleting and supports undo', () => {
  const entries = [{ definition: { name: 'A' } }, { definition: { name: 'B' } }];
  const order = [];
  let undo;
  const { removeEntries } = load('  function removeEntries(start, count)', '  const SESSIONS_STORAGE_KEY', 'removeEntries', {
    entries, editing: { index: 0 }, pickedIndex: 0,
    closePopovers() { order.push('cancel'); entries[0].definition.name = 'Original A'; },
    commit() { order.push('commit'); },
    toast(message, callback) { undo = callback; },
  });
  removeEntries(0, 1);
  assert.deepEqual(order, ['cancel', 'commit']);
  assert.equal(entries[0].definition.name, 'B');
  undo();
  assert.deepEqual(entries.map(entry => entry.definition.name), ['Original A', 'B']);
});
