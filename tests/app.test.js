import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { describe } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const categories = vm.runInNewContext(readFileSync(new URL('../items.js', import.meta.url), 'utf8') + '\nCATEGORIES');
// Exercise the actual browser functions without requiring WebGL or changing file:// support.
function load(start, end, exports, context = {}) {
  return vm.runInNewContext(`${source.slice(source.indexOf(start), source.indexOf(end))}\n({${exports}})`, context);
}
const shapes = vm.runInNewContext(`${source.slice(source.indexOf('  const slugify'), source.indexOf('  // all state'))}
${source.slice(source.indexOf('  // meshes are built sweeping'), source.indexOf('  const stage ='))}
({ catalog, catalogByKey, reorder, validRound, customDefinition, placed, sweep, diameter, computeVolume, AXES, AS_DEFINED, TURNS })`, { CATEGORIES: categories });
const { catalog, catalogByKey, customDefinition, placed, computeVolume, AS_DEFINED } = shapes;
const catalogItem = name => catalog.find(definition => definition.name === name);
const { parseSize, UNIT_FACTORS } = load('  const UNIT_FACTORS', '  const formatNumber', 'parseSize, UNIT_FACTORS', {
  isPositive: value => Number.isFinite(value) && value > 0,
});
const isPositive = value => Number.isFinite(value) && value > 0;
const close = (actual, expected, message) => assert.ok(Math.abs(actual / expected - 1) < 1e-9, `${message ?? ''} ${actual} ≠ ${expected}`);

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
  Object.assign(context, load('  // indexes shift', '  const SESSIONS_STORAGE_KEY', 'changeEntries', context));
  return { handlers, nodes, chips, context, commits: () => commits,
    start: (index = 0) => handlers.dragstart({ target: { closest: () => chips[index] }, dataTransfer: { setData() {} } }),
  };
}

describe('Size input', () => {
  test('parses units, separators and ranges', () => {
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

  test('rejects negative values, unknown units and extra text', () => {
    for (const input of ['-10 x 20 x 30 mm', '10 x -20 x 30', '10--20 x 30 x 40',
      '0 x 20 x 30', '10 km x 20 x 30', '10 x 20 x 30 garbage', '10.2.3 x 20 x 30',
      '10 x 20', '10 x 20 x 30 x 40', 'ten 10 x 20 x 30']) {
      assert.equal(parseSize(input, 'mm'), null, input);
    }
  });
});

describe('Shapes', () => {
  test('limit each radius by the sizes it rounds across', () => {
    const round = (size, values) => Array.from(customDefinition('Item', size, values).round);
    assert.deepEqual(round([78, 163.4, 8.75], [1, 1, 12]), [1, 1, 12]);
    assert.deepEqual(round([66, 115, 66], [0, 33, 0]), [0, 33, 0]);
    assert.deepEqual(round([100, 100, 100], [1000, 1000, 1000]), [50, 50, 50]);
    // a ball's radii on a thin slab: the rims stop at half the thickness, the corners do not
    assert.deepEqual(round([100, 100, 20], [1000, 1000, 1000]), [10, 10, 50]);
    // rims may be rounder than the corners
    assert.deepEqual(round([10.5, 44.5, 10.5], [20, 20, 1]), [5.25, 5.25, 1]);
    assert.deepEqual(round([100, 6, 40], [5, 5, 0]), [3, 3, 0]);
    assert.equal(customDefinition('Brick', [215, 65, 102.5]).key, 'custom:Brick:215:65:102.5');
    assert.equal(customDefinition('Can: red', [66, 115, 66], [0, 33, 0]).key, 'custom:Can%3A red:66:115:66:0:33:0');
  });

  test('in the catalog need no limiting', () => {
    for (const category of Object.values(categories)) for (const row of category.items) {
      assert.ok([4, 7].includes(row.length) && row.slice(1).every(value => Number.isFinite(value) && value >= 0), row[0]);
      assert.deepEqual(Array.from(catalogItem(row[0]).round), row.length === 7 ? Array.from(row.slice(4)) : [0, 0, 0], row[0]);
    }
    assert.equal(shapes.diameter(catalogItem('Soda Can (330 ml)')), 66);
    assert.equal(shapes.diameter(catalogItem('Golf Ball')), 42.67);
    assert.equal(shapes.diameter(catalogItem('CD / DVD')), 120);
    assert.equal(shapes.diameter(catalogItem('iPhone 17')), 0);
  });

  test('have volumes matching closed forms on every axis', () => {
    const volumeOf = (size, round) => computeVolume(customDefinition('Item', size, round));
    close(volumeOf([10, 20, 30]), 6000);
    close(volumeOf([120, 120, 1.2], [0, 0, 60]), Math.PI * 60 ** 2 * 1.2);
    close(volumeOf([66, 115, 66], [0, 33, 0]), Math.PI * 33 ** 2 * 115);
    close(volumeOf([115, 66, 66], [33, 0, 0]), Math.PI * 33 ** 2 * 115);
    close(volumeOf([100, 100, 100], [50, 50, 50]), 4 / 3 * Math.PI * 50 ** 3);
    close(volumeOf([100, 150, 100], [50, 50, 50]), Math.PI * 50 ** 2 * 50 + 4 / 3 * Math.PI * 50 ** 3);
    // sharp corners with fully rounded rims make two crossed cylinders: 16r³/3
    close(volumeOf([20, 20, 20], [10, 10, 0]), 16 * 1000 / 3);
    // closed form for rims no rounder than the corners
    const capped = ([width, height, depth], radius, edge) => (width * height - (4 - Math.PI) * radius ** 2) * depth
      - 2 * (2 * (width + height) - 2 * (4 - Math.PI) * radius) * edge ** 2 * (1 - Math.PI / 4) + 2 * Math.PI * edge ** 3 * (5 / 3 - Math.PI / 2);
    for (const [size, radius, edge] of [[[100, 100, 20], 50, 5], [[100, 80, 30], 15, 15], [[78, 163.4, 8.75], 12, 2]]) close(volumeOf(size, [edge, edge, radius]), capped(size, radius, edge));
    // numeric slice integration, independent of the closed form
    for (const [size, round] of [[[100, 60, 40], [10, 10, 0]], [[80, 50, 30], [12, 12, 6]], [[10.5, 44.5, 10.5], [20, 20, 1]], [[100, 100, 100], [50, 50, 10]]]) {
      const [width, height, depth] = size, { round: [edge, , radius] } = customDefinition('Item', size, round), steps = 200000;
      const slice = inset => (width - 2 * inset) * (height - 2 * inset) - (4 - Math.PI) * Math.max(radius - inset, 0) ** 2;
      let rim = 0;
      for (let step = 0; step < steps; step++) rim += slice(edge - Math.sqrt(edge ** 2 - (edge * (step + .5) / steps) ** 2)) * edge / steps;
      assert.ok(Math.abs(volumeOf(size, round) / (slice(0) * (depth - 2 * edge) + 2 * rim) - 1) < 1e-6, String(size));
    }
  });

  test('build meshes with exact sizes, outward normals and no folds', () => {
    class Attribute {
      constructor(values, itemSize) { this.array = Float32Array.from(values); this.itemSize = itemSize; }
    }
    class Geometry {
      attributes = {};
      setAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
      setIndex(indices) { this.index = indices; return this; }
      // matches three.js: rotate positions and normals by -90° about x or y
      rotateX() { return this.remap(([x, y, z]) => [x, z, -y]); }
      rotateY() { return this.remap(([x, y, z]) => [-z, y, x]); }
      remap(turn) {
        for (const { array } of Object.values(this.attributes))
          for (let index = 0; index < array.length; index += 3) array.set(turn(array.slice(index, index + 3)), index);
        return this;
      }
    }
    const { createGeometry } = load('  function createGeometry(', '  const cssVariable', 'createGeometry', {
      sweep: shapes.sweep, THREE: { BufferGeometry: Geometry, Float32BufferAttribute: Attribute },
    });
    for (const [size, round] of [
      [[100, 100, 20], [5, 5, 50]], [[100, 100, 20], [10, 10, 50]], [[100, 100, 100], [50, 50, 50]], [[200, 100, 100], [50, 50, 50]],
      [[100, 80, 30], [5, 5, 15]], [[10.5, 44.5, 10.5], [20, 20, 1]], [[100, 60, 40], [10, 10, 0]], [[100, 100, 100], [50, 50, 10]],
      [[85.6, 53.98, 0.76], [0.38, 0.38, 3.18]], [[120, 120, 1.2], [0.6, 0.6, 60]], [[80, 50, 30], [12, 12, 6]],
      // swept along height and width: a battery with rounded rims, a lying capsule, an upright puck
      [[14.5, 50.5, 14.5], [1, 7.25, 1]], [[50, 20, 20], [10, 10, 10]], [[60, 30, 60], [3, 30, 3]], [[30, 60, 60], [30, 3, 3]],
    ]) {
      const definition = customDefinition('Rounded', size, round), mesh = createGeometry(definition);
      const positions = mesh.attributes.position.array, normals = mesh.attributes.normal.array;
      assert.ok(positions.every(Number.isFinite));
      for (let axis = 0; axis < 3; axis++) {
        const values = positions.filter((_, index) => index % 3 === axis);
        assert.ok(Math.abs(Math.max(...values) - size[axis] / 2) < 1e-5, `${size} max ${axis}`);
        assert.ok(Math.abs(Math.min(...values) + size[axis] / 2) < 1e-5, `${size} min ${axis}`);
      }
      for (let index = 0; index < normals.length; index += 3) assert.ok(Math.abs(Math.hypot(...normals.slice(index, index + 3)) - 1) < 1e-6);
      let volume = 0;
      for (let index = 0; index < mesh.index.length; index += 3) {
        const [a, b, c] = mesh.index.slice(index, index + 3).map(vertex => Array.from(positions.slice(vertex * 3, vertex * 3 + 3)));
        const face = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
          (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
          (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
        const normal = normals.slice(mesh.index[index] * 3, mesh.index[index] * 3 + 3);
        assert.ok(face.reduce((dot, value, axis) => dot + value * normal[axis], 0) > -1e-5);
        volume += a.reduce((dot, value, axis) => dot + value * face[axis], 0) / 6;
        // convex means no vertex lies outside any face plane, so the surface cannot fold or intersect itself
        const length = Math.hypot(...face);
        if (length < 1e-6) continue;
        const [nx, ny, nz] = face.map(value => value / length), offset = nx * a[0] + ny * a[1] + nz * a[2];
        let outside = -Infinity;
        for (let vertex = 0; vertex < positions.length; vertex += 3)
          outside = Math.max(outside, nx * positions[vertex] + ny * positions[vertex + 1] + nz * positions[vertex + 2] - offset);
        assert.ok(outside < Math.max(...size) * 1e-3, `${size} vertex outside by ${outside}`);
      }
      assert.ok(Math.abs(volume / computeVolume(definition) - 1) < .01, `${size} volume`);
    }
  });
});

describe('Links', () => {
  test('store catalog turns as a size order and custom items as seen', () => {
    const context = { catalogByKey, customDefinition, isPositive, URLSearchParams, DEFAULTS: {}, settings: {}, entries: [], ...shapes };
    const { parseEntry } = load('  function parseEntry(', '  function fromQuery(', 'parseEntry', context);
    const { toQuery } = load('  function toQuery()', '  const settingValue', 'toQuery', context);
    const can = parseEntry('common/soda-can-330-ml!wdh');
    assert.deepEqual(Array.from(placed(can).size), [66, 66, 115]);
    assert.deepEqual(Array.from(placed(can).round), [0, 0, 33]);
    for (const order of ['whd', 'wdh', 'hwd', 'hdw', 'dwh', 'dhw']) {
      context.entries = [parseEntry(`common/soda-can-330-ml!${order}`)];
      assert.equal(new URLSearchParams(toQuery()).get('items'), order === 'whd' ? 'common/soda-can-330-ml' : `common/soda-can-330-ml!${order}`);
    }
    for (const key of ['custom:Brick:215:65:102.5', 'custom:Can:66:115:66:0:33:0', 'custom:Phone:78:163.4:8.75:1:1:12']) {
      assert.equal(parseEntry(key).definition.key, key);
      context.entries = [parseEntry(key)];
      assert.equal(new URLSearchParams(toQuery()).get('items'), key);
    }
    assert.equal(parseEntry('custom:Ball:67:67:67:999:999:999').definition.key, 'custom:Ball:67:67:67:33.5:33.5:33.5');
    for (const token of ['custom:Bad:1:2', 'custom:Bad:1:2:3:4', 'custom:Bad:1:2:3:4:5', 'custom:Bad:1:2:3:0:-1:0', 'custom:Bad:1:2:3:0:NaN:0', 'custom:Bad:1:2:3:1:0:12',
      'custom:Bad:0:2:3', 'common/soda-can-330-ml!wwh', 'common/unknown']) assert.equal(parseEntry(token), null, token);
  });
});

describe('Rotation', () => {
  test('swaps sizes with their radii and rewrites custom items', () => {
    const entries = [{ definition: catalogItem('Soda Can (330 ml)'), order: AS_DEFINED }, { definition: customDefinition('Can', [66, 115, 66], [0, 33, 0]), order: AS_DEFINED }];
    const { applyAction } = load('  function applyAction(index, action)', '  function toggle(key)', 'applyAction', {
      ...shapes, entries, editing: null, commit() {}, document: { activeElement: null },
    });
    const seen = index => [Array.from(placed(entries[index]).size), Array.from(placed(entries[index]).round)];
    applyAction(0, 'tip');
    assert.deepEqual(seen(0), [[66, 66, 115], [0, 0, 33]]);
    applyAction(0, 'turn');
    assert.deepEqual(seen(0), [[115, 66, 66], [33, 0, 0]]);
    applyAction(0, 'turn');
    applyAction(0, 'tip');
    assert.deepEqual(Array.from(entries[0].order), [0, 1, 2]);
    applyAction(1, 'roll');
    assert.deepEqual(Array.from(entries[1].order), [0, 1, 2]);
    assert.equal(entries[1].definition.key, 'custom:Can:115:66:66:33:0:0');
    // a turned item is the same solid
    close(computeVolume(placed({ definition: catalogItem('Soda Can (330 ml)'), order: [2, 0, 1] })), Math.PI * 33 ** 2 * 115);
  });
});

describe('Add and Edit', () => {
  test('reads radii in the size unit and links a changed radius to its partner', () => {
    const fields = Object.fromEntries(Object.entries({ name: 'Can', size: '6.6 x 11.5 x 6.6 cm', unit: 'cm', x: '', y: '3.3', z: '' })
      .map(([key, value]) => [key, { value }]));
    const { readCustomForm, customFormDefinition, validCustomSize, linkRound, limitRound } = load('  // radii are in the menu', "  customForm.addEventListener('reset'", 'readCustomForm, customFormDefinition, validCustomSize, linkRound, limitRound', {
      ...shapes, customForm: { elements: fields }, parseSize, UNIT_FACTORS, isPositive,
    });
    const read = round => { if (round) ['x', 'y', 'z'].forEach((axis, index) => fields[axis].value = round[index]); return readCustomForm(); };
    assert.equal(customFormDefinition(read()).key, 'custom:Can:66:115:66:0:33:0');
    assert.deepEqual(Array.from(read(['', '', '']).round), [0, 0, 0]);
    for (const round of [['-1', '-1', '-1'], ['0.1', '0', '1.2']]) assert.equal(validCustomSize(read(round)), false, round.join());
    const change = (axis, value) => { fields[axis].value = value; linkRound(['x', 'y', 'z'].indexOf(axis)); return ['x', 'y', 'z'].map(key => fields[key].value).join(); };
    read(['', '', '']);
    linkRound(-1);
    assert.equal(change('z', '6'), ',,6');
    assert.equal(change('x', '1'), '1,1,6');
    assert.equal(change('x', '6'), '6,6,6');
    assert.equal(change('x', '7'), '7,7,6');
    assert.equal(change('x', '6'), '6,6,6');
    // matching values keep the pair
    assert.equal(change('y', '5'), '5,5,6');
    assert.equal(change('z', '5'), '5,5,5');
    assert.equal(change('x', '4'), '4,4,5');
    // all 0 lets the next change pick the odd radius
    assert.equal(change('z', ''), '4,4,');
    assert.equal(change('x', ''), ',,');
    assert.equal(change('y', '33'), ',33,');
    assert.equal(change('x', '2'), '2,33,2');
    // stepping past the limit stops there: 200 x 330 x 260 mm allows 100 for each radius
    const limited = (axis, value) => { change(axis, value); limitRound(); return ['x', 'y', 'z'].map(key => fields[key].value).join(); };
    Object.assign(fields, { size: { value: '200 x 330 x 260' }, unit: { value: 'mm' } });
    read(['', '', '']);
    linkRound(-1);
    assert.equal(limited('z', '6'), ',,6');
    assert.equal(limited('x', '100'), '100,100,6');
    assert.equal(limited('x', '101'), '100,100,6');
    assert.equal(limited('z', '150'), '100,100,100');
    assert.equal(limited('z', '90'), '100,100,90');
    assert.equal(limited('x', '-5'), '0,0,90');
    assert.equal(limited('x', '-0'), '0,0,90');
    assert.equal(limited('x', '100'), '100,100,90');
    // the odd radius may reach half of the other two sizes, the pair half of the smallest
    Object.assign(fields, { size: { value: '330 x 400 x 260' }, unit: { value: 'cm' } });
    assert.equal(limited('z', '200'), '100,100,165');
    assert.equal(limited('x', '150'), '130,130,165');
  });

  test('moves a typed unit to the menu and converts on a unit change', () => {
    const fields = Object.fromEntries(['size', 'unit', 'x', 'y', 'z'].map(key => [key, { value: '' }]));
    const { takeUnit, setUnit } = load('  // radii are in the menu', "  customForm.addEventListener('reset'", 'takeUnit, setUnit', {
      ...shapes, customForm: { elements: fields }, parseSize, UNIT_FACTORS, isPositive,
    });
    const form = () => [fields.size.value, fields.unit.value, ...['x', 'y', 'z'].map(key => fields[key].value)].join(' | ');
    Object.assign(fields, { size: { value: '200x330 x 260mm' }, unit: { value: 'mm' }, x: { value: '100' }, y: { value: '100' }, z: { value: '6' } });
    takeUnit();
    assert.equal(form(), '200 x 330 x 260 | mm | 100 | 100 | 6');
    setUnit('mm', 'cm');
    assert.equal(form(), '20 x 33 x 26 | cm | 10 | 10 | 0.6');
    setUnit('cm', 'in');
    setUnit('in', 'mm');
    assert.equal(form(), '200 x 330 x 260 | mm | 100 | 100 | 6');
    // radii follow the menu, so a unit typed into the size converts them too
    fields.size.value = '20 x 33 x 26 cm';
    takeUnit();
    assert.equal(form(), '20 x 33 x 26 | cm | 10 | 10 | 0.6');
    // mixed units end in the last one, so a typo stands out
    fields.size.value = '200mm x 330m x 260 mm';
    takeUnit();
    assert.equal(form(), '200 x 330000 x 260 | mm | 100 | 100 | 6');
    fields.size.value = '12in x 4.5in x 30cm';
    takeUnit();
    assert.equal(form(), '30.48 x 11.43 x 30 | cm | 10 | 10 | 0.6');
    fields.size.value = '2 x 3 x 4 feet';
    takeUnit();
    assert.equal(fields.unit.value, 'ft');
    // no unit typed leaves the form alone
    takeUnit();
    assert.equal(fields.unit.value, 'ft');
  });

  test('shows the item as it stands and cancel restores it', () => {
    const entry = { definition: catalogItem('Soda Can (330 ml)'), order: [0, 2, 1] }, original = entry.definition;
    const fields = Object.fromEntries(['name', 'size', 'unit', 'x', 'y', 'z'].map(key => [key, { value: '' }]));
    const context = {
      ...shapes, entries: [entry], editing: null, parseSize, UNIT_FACTORS, isPositive,
      customForm: { elements: fields, reset() {}, dispatchEvent() { entry.definition = context.customFormDefinition(context.readCustomForm()); } },
      closePopovers() {}, find: () => ({ click() {} }), setEditing(state) { context.editing = state; }, Event: class {}, commit() {},
    };
    Object.assign(context, load('  // radii are in the menu', "  customForm.addEventListener('reset'", 'readCustomForm, customFormDefinition, ROUND_AXES', context));
    const { startEditing, cancelEditing } = load('  function startEditing(', "  customForm.addEventListener('submit'", 'startEditing, cancelEditing', context);
    startEditing(0);
    assert.deepEqual(['size', 'x', 'y', 'z'].map(key => fields[key].value), ['66 x 66 x 115', '', '', 33]);
    assert.equal(entry.definition.key, 'custom:Soda Can (330 ml):66:66:115:0:0:33');
    assert.deepEqual(Array.from(entry.order), [0, 1, 2]);
    cancelEditing();
    assert.equal(entry.definition, original);
    assert.deepEqual(Array.from(entry.order), [0, 2, 1]);
    // values survive the form unchanged, e.g. half of 42.67
    Object.assign(entry, { definition: catalogItem('Golf Ball'), order: AS_DEFINED });
    startEditing(0);
    assert.deepEqual(Array.from(entry.definition.round), Array.from(catalogItem('Golf Ball').round));
  });

  test('removing an edited item cancels the edit and supports undo', () => {
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

  test('removing and undoing keep the picked item', () => {
    const entries = ['A', 'B', 'C'].map(name => ({ definition: { name } })), [, , c] = entries;
    let undo;
    const context = { entries, editing: null, pickedIndex: 2, closePopovers() {}, commit() {}, toast(message, callback) { undo = callback; } };
    const { removeEntries } = load('  function removeEntries(start, count)', '  const SESSIONS_STORAGE_KEY', 'removeEntries', context);
    removeEntries(0, 1);
    assert.equal(entries[context.pickedIndex], c);
    undo();
    assert.equal(entries[context.pickedIndex], c);
    removeEntries(2, 1);
    assert.equal(context.pickedIndex, null);
  });

  test('turning the edited item shows its new size in the form', () => {
    const entries = [{ definition: customDefinition('Can', [66, 115, 66], [0, 33, 0]), order: AS_DEFINED }];
    const fields = Object.fromEntries(['name', 'size', 'unit', 'x', 'y', 'z'].map(key => [key, { value: '' }]));
    let previews = 0, commits = 0;
    const context = { ...shapes, entries, editing: { index: 0 }, customForm: { elements: fields, dispatchEvent() { previews++; } }, Event: class {},
      commit() { commits++; }, document: { activeElement: null } };
    Object.assign(context, load('  // radii are in the menu', "  customForm.addEventListener('reset'", 'ROUND_AXES', context));
    Object.assign(context, load('  function fillCustomForm(', '  function cancelEditing(', 'fillCustomForm', context));
    load('  function applyAction(index, action)', '  function toggle(key)', 'applyAction', context).applyAction(0, 'tip');
    assert.deepEqual(['size', 'x', 'y', 'z'].map(key => fields[key].value), ['66 x 66 x 115', '', '', 33]);
    assert.deepEqual([previews, commits], [1, 0]);
  });
});

describe('Settings', () => {
  test('maps old spacing presets and falls back to defaults', () => {
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
});

describe('Keyboard', () => {
  test('toggles options, fullscreen, clearing and selection', () => {
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

  test('cycles alignment and opacity and stops spacing at its limits', () => {
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
});

describe('Camera', () => {
  test('renders after orbiting and resizing', () => {
    let onChange, clips = 0, renders = 0;
    const { pending, clear } = load('  let renderPending', '  // the browser may drop', 'pending: () => renderPending, clear: () => { renderPending = false; }', {
      controls: { addEventListener: (event, callback) => { if (event === 'change') onChange = callback; } },
      clipToScene: () => clips++,
    });
    clear();
    onChange();
    assert.equal(clips, 1);
    assert.equal(pending(), true);
    const camera = () => ({ updateProjectionMatrix() {} });
    const { resize } = load('  function resize()', '  new ResizeObserver', 'resize', {
      stage: { clientWidth: 800, clientHeight: 600 }, renderer: { setSize() {} }, labelRenderer: { setSize() {} },
      orthographicCamera: camera(), perspectiveCamera: camera(), fitCamera() {}, requestRender: () => renders++,
    });
    resize();
    assert.equal(renders, 1);
  });

  test('rotates by keyboard and keeps the radius', () => {
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

  test('zooms both cameras within limits', () => {
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

  test('pans along screen axes and keeps direction and distance', () => {
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
});

describe('Selection', () => {
  test('picks on click and ignores orbit drags', () => {
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

  test('refits after the info card opens or closes', () => {
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

  test('ignores info card clicks redirected by layout changes', () => {
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
});

describe('Layout', () => {
  test('moves cards above the canvas on mobile and back', () => {
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
});

describe('Tray', () => {
  test('drops on the indicated side across gaps and wrapped rows', () => {
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
    Object.assign(context, load('  // indexes shift', '  const SESSIONS_STORAGE_KEY', 'changeEntries', context));
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

  test('keeps the space of a single item when a drag leaves and returns', () => {
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

  test('keeps the placeholder stable beside row edges and gaps', () => {
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
});

describe('Labels', () => {
  test('fit a narrow canvas without clipping or overlapping', () => {
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

  test('ignore hidden control groups', () => {
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
});

describe('Sessions', () => {
  const settle = () => new Promise(resolve => setImmediate(resolve));
  // every store call waits until the test settles it
  function sessionsWith(input) {
    const calls = [], toasts = [], list = { innerHTML: '' };
    const call = (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject }));
    const store = { label: '', list: () => call('list'), save: session => call('save', session.name), rename: (name, newName) => call('rename', name, newName), remove: name => call('remove', name) };
    const context = {
      sessionList: list, sessionForm: { elements: { name: { value: 'A' }, save: {} } }, authForm: {}, signOutButton: {}, find: () => ({}),
      auth: { read: () => null }, localSessions: store, accountSessions: store, toast: message => toasts.push(message),
      escapeHtml: text => text, formatDate: () => '', ICONS: {}, URLSearchParams, document: { createElement: () => input },
    };
    Object.assign(context, load('  // the list shows from memory', '  // PKCE', 'changeSessions', context));
    Object.assign(context, load('  function startRename', '  sessionList.addEventListener', 'startRename', context));
    const shown = () => [...list.innerHTML.matchAll(/data-name="([^"]*)"/g)].map(match => match[1]).join() || list.innerHTML.replace(/<[^>]+>/g, '');
    return { context, calls, toasts, shown };
  }
  const session = name => ({ name, query: '', savedAt: 0 });

  test('show changes at once and keep them over an older load', async () => {
    const { context, calls, toasts, shown } = sessionsWith();
    assert.equal(shown(), 'Loading…');
    context.changeSessions([session('A')], store => store.save(session('A')));
    assert.equal(shown(), 'A');
    await settle();
    calls[0].resolve([]);
    await settle();
    assert.equal(shown(), 'A');
    // the save waits for the load before it, then the list reloads
    assert.deepEqual(calls[1].args, ['save', 'A']);
    calls[1].resolve();
    await settle();
    calls[2].resolve([session('A'), session('B')]);
    await settle();
    assert.equal(shown(), 'A,B');
    // a failed change says why and shows what the store has
    context.changeSessions([session('A')], store => store.remove('B'));
    assert.equal(shown(), 'A');
    await settle();
    calls[3].reject(new Error('offline'));
    await settle();
    calls[4].resolve([session('A'), session('B')]);
    await settle();
    assert.deepEqual(toasts, ['offline']);
    assert.equal(shown(), 'A,B');
  });

  test('rename keeps the save target and refuses a taken name', async () => {
    const input = { handlers: {}, focus() {}, select() {}, addEventListener(event, handler) { this.handlers[event] = handler; } };
    const { context, calls, toasts, shown } = sessionsWith(input);
    await settle();
    calls[0].resolve([session('A'), session('B')]);
    await settle();
    context.startRename({ querySelector: () => ({ replaceWith() {} }) }, 'A');
    input.value = 'B';
    input.handlers.blur();
    assert.deepEqual([toasts, context.sessionForm.elements.name.value, calls.length], [['A session with that name already exists'], 'A', 1]);
    input.value = 'C';
    input.handlers.blur();
    assert.equal(context.sessionForm.elements.name.value, 'C');
    assert.equal(shown(), 'C,B');
    await settle();
    assert.deepEqual(calls[1].args, ['rename', 'A', 'C']);
  });
});
