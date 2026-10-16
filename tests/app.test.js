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
