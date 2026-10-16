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

test('mobile info and edit cards stay in the scene container above the canvas', () => {
  let mobile = true;
  const panels = [{}, {}], scene = {};
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
