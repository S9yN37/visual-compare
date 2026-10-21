// import() instead of type=module, so the page also works when opened from disk (file://)
(async () => {
  const find = selector => document.querySelector(selector);
  const findAll = selector => document.querySelectorAll(selector);
  const escapeHtml = text => String(text).replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
  const isPositive = value => Number.isFinite(value) && value > 0;

  async function checkForUpdate() {
    const version = find('meta[name="app-version"]')?.content;
    if (!version || !/^https?:$/.test(location.protocol)) return false;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
    try {
      const url = new URL('version.json', document.baseURI);
      url.searchParams.set('_', Date.now());
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) return false;
      const latest = (await response.json()).version, page = new URL(location.href);
      if (typeof latest !== 'string' || !/^[a-f0-9]{12}$/.test(latest) || latest === version || page.searchParams.get('_v') === latest) return false;
      page.searchParams.set('_v', latest);
      location.replace(page.href);
      return true;
    } catch {
      return false;
    } finally { clearTimeout(timer); }
  }
  if (await checkForUpdate()) return;

  const [THREE, { OrbitControls }, { CSS2DRenderer, CSS2DObject }, { RoomEnvironment }] = await Promise.all([
    import('three'), import('three/addons/controls/OrbitControls.js'), import('three/addons/renderers/CSS2DRenderer.js'),
    import('three/addons/environments/RoomEnvironment.js')]);

  const icon = paths => `<svg viewBox="0 0 24 24">${paths}</svg>`;
  const ICONS = {
    plus: icon('<path d="M12 5l0 14" /> <path d="M5 12l14 0" />'),
    check: icon('<path d="M5 12l5 5l10 -10" />'),
    close: icon('<path d="M18 6l-12 12" /> <path d="M6 6l12 12" />'),
    turn: icon('<path d="M12 3v18M19 9c2 1 3 2 3 3 0 3-4 5-10 5S2 15 2 12c0-2 2-3 5-4M4 5l3 3-3 3"/>'),
    tip: icon('<path d="M3 12h18M9 5c1-2 2-3 3-3 3 0 5 4 5 10s-2 10-5 10c-2 0-3-2-4-5M5 20l3-3 3 3"/>'),
    roll: icon('<path d="M9 9h6v6H9zM21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>'),
    pencil: icon('<path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" /> <path d="M13.5 6.5l4 4" />'),
  };
  // golden-angle hues never repeat; chroma drops until the color fits sRGB
  function objectColor(index) {
    const lightness = .55, hue = (265 + index * 137.508) % 360, radians = hue * Math.PI / 180;
    for (let chroma = .16; ; chroma -= .005) {
      const a = chroma * Math.cos(radians), b = chroma * Math.sin(radians);
      const long = (lightness + .3963377774 * a + .2158037573 * b) ** 3, medium = (lightness - .1055613458 * a - .0638541728 * b) ** 3, short = (lightness - .0894841775 * a - 1.291485548 * b) ** 3;
      const rgb = [4.0767416621 * long - 3.3077115913 * medium + .2309699292 * short, -1.2684380046 * long + 2.6097574011 * medium - .3413193965 * short, -.0041960863 * long - .7034186147 * medium + 1.707614701 * short];
      if (chroma < .005 || rgb.every(channel => channel >= 0 && channel <= 1))
        return { css: `oklch(${lightness} ${chroma.toFixed(3)} ${hue.toFixed(1)})`, rgb: new THREE.Color().setRGB(...rgb, THREE.LinearSRGBColorSpace) };
    }
  }

  const slugify = text => text.toLowerCase().replace(/"/g, 'in').replace(/\+/g, '-plus').replace(/€/g, 'eur-').replace(/£/g, 'gbp-').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // a shape is size [width, height, depth] plus round [x, y, z]: the radius of the edges running along each axis
  const reorder = (values, order) => order.map(index => values[index]);
  // the odd radius rounds the outline around its axis and the matching pair rounds that outline's rims
  const sweepAxis = ([x, y, z], size) => x === y ? (y === z ? size.indexOf(Math.min(...size)) : 2) : x === z ? 1 : 0;
  const validRound = round => round.every(value => Number.isFinite(value) && value >= 0) && new Set(round).size < 3;
  // radii are limited here, so every label, mesh and volume uses the same effective values
  function defineShape(size, round = [0, 0, 0]) {
    round = round.map(value => Math.max(0, value));
    const axis = sweepAxis(round, size), others = [0, 1, 2].filter(index => index !== axis);
    const corner = Math.min(round[axis], ...reorder(size, others).map(value => value / 2));
    const rim = Math.min(...reorder(round, others), ...size.map(value => value / 2));
    return { size, round: round.map((_, index) => index === axis ? corner : rim) };
  }
  const catalog = Object.entries(CATEGORIES).flatMap(([category, { label, items }]) =>
    items.map(([name, width, height, depth, x = 0, y = 0, z = 0]) =>
      ({ key: `${category}/${slugify(name)}`, category, label, name, ...defineShape([width, height, depth], [x, y, z]) })));
  const catalogByKey = new Map(catalog.map(definition => [definition.key, definition]));
  const customDefinition = (name, size, round) => {
    const shape = defineShape(size, round), values = shape.round.some(Boolean) ? [...shape.size, ...shape.round] : shape.size;
    return { key: `custom:${name.replace(/[%:,]/g, encodeURIComponent)}:${values.join(':')}`, category: 'custom', label: 'Custom', name, ...shape };
  };
  // an entry's order says which of its item's axes now runs along width, height and depth
  const placed = ({ definition, order }) => ({ ...definition, size: reorder(definition.size, order), round: reorder(definition.round, order) });
  const AXES = 'whd', AS_DEFINED = [0, 1, 2];
  // a quarter-turn swaps the two sizes, and their radii, across its axis
  const TURNS = { tip: [0, 2, 1], turn: [2, 1, 0], roll: [1, 0, 2] };
  // all state is in the URL, so a link and a saved session are the same thing
  const DEFAULTS = { view: 'isometric', layout: 'row', alignX: 'center', alignZ: 'center', unit: 'cm', labels: 1, grid: 1, opacity: 1, spacing: 1, sort: 0, autoRotate: 0, perspective: 0 };
  const REFIT_SETTINGS = new Set(['view', 'layout', 'alignX', 'alignZ', 'perspective', 'spacing', 'sort', 'labels']);
  const ARRANGE_AXIS = { row: 'x', line: 'z', stack: 'y' };
  const ALIGNMENTS = { left: 'min', back: 'min', center: 'center', right: 'max', front: 'max' };
  const SAMPLE_QUERY = 'items=audio/kef-r3,audio/edifier-r1280dbs,audio/buchardt-e50-s,audio/arendal-1528-bookshelf-8,audio/cambridge-audio-l-r-x';
  let settings = { ...DEFAULTS }, entries = [], pickedIndex = null, rendered = [], editing = null;

  function toQuery() {
    const parameters = new URLSearchParams();
    if (entries.length) parameters.set('items', entries.map(entry =>
      entry.definition.key + (entry.order.join() === AS_DEFINED.join() ? '' : '!' + reorder(AXES, entry.order).join(''))).join(','));
    for (const key in DEFAULTS) if (settings[key] !== DEFAULTS[key]) parameters.set(key, settings[key]);
    return parameters.toString().replace(/%2F/g, '/').replace(/%2C/g, ',').replace(/%21/g, '!').replace(/%3A/g, ':');
  }

  const settingValue = (key, raw) => typeof DEFAULTS[key] === 'string' ? raw : +raw;
  function sanitizeSetting(key, raw) {
    // Older links and sessions used 5% and 20% for Normal and Wide.
    if (key === 'spacing') raw = ({ 5: '3', 20: '13' })[raw] ?? raw;
    if (find(`[data-setting="${key}"][data-value="${CSS.escape(raw)}"]`)) return settingValue(key, raw);
    if (find(`[data-option="${key}"]`) && Number.isFinite(+raw)) return +raw ? 1 : 0;
    return DEFAULTS[key];
  }

  function parseEntry(token) {
    const [, key, order = AXES] = token.match(/^(.*?)(?:!([whd]{3}))?$/);
    let definition = catalogByKey.get(key);
    if (!definition && key.startsWith('custom:')) {
      const [, name, ...values] = key.split(':'), [width, height, depth, x = 0, y = 0, z = 0] = values.map(Number);
      if (![3, 6].includes(values.length) || ![width, height, depth].every(isPositive) || !validRound([x, y, z])) return null;
      try { definition = customDefinition(decodeURIComponent(name), [width, height, depth], [x, y, z]); } catch { return null; }
    }
    if (!definition || new Set(order).size < 3) return null;
    return { definition, order: [...order].map(letter => AXES.indexOf(letter)) };
  }

  function fromQuery(query) {
    const parameters = new URLSearchParams(query);
    settings = { ...DEFAULTS };
    for (const key in DEFAULTS) if (parameters.has(key)) settings[key] = sanitizeSetting(key, parameters.get(key));
    entries = (parameters.get('items') || '').split(',').filter(Boolean).map(parseEntry).filter(Boolean);
    pickedIndex = null;
    setFitting(true);
  }

  function commit(refit) {
    const query = toQuery();
    invalidatePreparedAR(query);
    // an edit's live preview is kept only once saved
    if (!editing) {
      history.replaceState(null, '', query ? '?' + query : location.pathname);
      try { localStorage.setItem('visualCompare.last', query); } catch {}
    }
    if (!rendered.length) setFitting(true);
    build();
    renderResults(); renderTray(); renderInfo(); syncControls();
    if (refit) fitCamera();
  }

  const UNIT_FACTORS = { mm: 1, cm: 10, m: 1000, in: 25.4, inch: 25.4, inches: 25.4, '"': 25.4, '″': 25.4, ft: 304.8, foot: 304.8, feet: 304.8, "'": 304.8, '′': 304.8 };
  const SIZE_PATTERN = /(\d*\.?\d+)(?:\s*(mm|cm|m|inches|inch|in|feet|foot|ft|"|″|'|′))?(?:\s*[-–—]\s*(\d*\.?\d+)(?:\s*(mm|cm|m|inches|inch|in|feet|foot|ft|"|″|'|′))?)?/gi;

  // accepts "380 x 158 x 8 mm", "12in x 4.5in x 1.2in", "0.41 - 1.09 cm" (ranges keep the larger value); a bare number takes the next unit to its right
  function parseSize(text, fallbackUnit) {
    const cleaned = text.replace(/(\d),(\d)/g, '$1.$2');
    const matches = [...cleaned.matchAll(SIZE_PATTERN)];
    if (matches.length !== 3) return null;
    let end = 0;
    for (const [index, match] of matches.entries()) {
      const separator = cleaned.slice(end, match.index);
      if (!(index === 0 ? /^\s*$/ : /^(?:\s*[x×*;,]\s*|\s+)$/i).test(separator)) return null;
      end = match.index + match[0].length;
    }
    if (cleaned.slice(end).trim()) return null;
    const lastUnit = matches.findLast(match => match[4] || match[2]);
    const detectedUnit = (lastUnit?.[4] || lastUnit?.[2])?.toLowerCase();
    let unit = detectedUnit ?? fallbackUnit;
    const values = matches.toReversed().map(([, value, explicitUnit, upper, upperUnit]) => {
      const highUnit = upperUnit?.toLowerCase() ?? explicitUnit?.toLowerCase() ?? unit;
      unit = explicitUnit?.toLowerCase() ?? highUnit;
      const millimeters = Math.max(value * UNIT_FACTORS[unit], upper === undefined ? 0 : upper * UNIT_FACTORS[highUnit]);
      return +millimeters.toFixed(2);
    }).toReversed();
    if (!values.every(isPositive)) return null;
    return { values, detectedUnit };
  }

  const formatNumber = value => +value.toFixed(value < 10 ? 2 : 1);
  const unitFor = millimeters => settings.unit === 'in'
    ? (millimeters >= 120 * 25.4 ? [304.8, 'ft'] : [25.4, 'in'])
    : millimeters >= 2000 ? [1000, 'm']
    : settings.unit === 'cm' ? [10, 'cm'] : [1, 'mm'];
  const formatDimensions = values => {
    const [factor, unit] = unitFor(Math.max(...values));
    return values.map(value => formatNumber(value / factor)).join(' × ') + ' ' + unit;
  };
  const formatLength = millimeters => formatDimensions([millimeters]);
  const formatVolume = cubicMillimeters => settings.unit === 'in'
    ? (cubicMillimeters >= 1728 * 16387.064 ? formatNumber(cubicMillimeters / 28316846.6) + ' ft³' : formatNumber(cubicMillimeters / 16387.064) + ' in³')
    : cubicMillimeters >= 1e9 ? formatNumber(cubicMillimeters / 1e9) + ' m³'
    : cubicMillimeters >= 1e6 ? formatNumber(cubicMillimeters / 1e6) + ' L'
    : formatNumber(cubicMillimeters / 1e3) + ' mL';
  const formatArea = squareMillimeters => settings.unit === 'in'
    ? (squareMillimeters >= 144 * 645.16 ? formatNumber(squareMillimeters / 92903) + ' ft²' : formatNumber(squareMillimeters / 645.16) + ' in²')
    : squareMillimeters >= 1e6 ? formatNumber(squareMillimeters / 1e6) + ' m²' : formatNumber(squareMillimeters / 100) + ' cm²';
  const formatDate = time => new Date(time - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' ');
  const formatRatio = value => value >= 100 ? Math.round(value).toLocaleString() + '×' : formatNumber(value) + '×';

  // meshes are built sweeping along z, from the outline across the two other axes
  const OUTLINES = [[2, 1], [0, 2], [0, 1]];
  function sweep({ size, round }) {
    const axis = sweepAxis(round, size), [across, up] = OUTLINES[axis];
    return { axis, width: size[across], height: size[up], depth: size[axis], radius: round[axis], edge: round[across] };
  }
  const diameter = shape => { const { width, height, radius } = sweep(shape); return width === height && radius === width / 2 ? width : 0; };

  // integrates the slice areas: a rim slice at height t is the outline shrunk by e − s, with s = √(e² − t²)
  function computeVolume(shape) {
    const { width, height, depth, radius, edge } = sweep(shape);
    const area = width * height - (4 - Math.PI) * radius ** 2;
    if (!edge) return area * depth;
    // slice corners stay round only while s > k, i.e. for t < reach
    const k = edge - radius, reach = k > 0 ? Math.sqrt(edge ** 2 - k ** 2) : edge, s = Math.sqrt(edge ** 2 - reach ** 2);
    const cornerLoss = (4 - Math.PI) * (edge ** 2 * reach - reach ** 3 / 3 - k * (reach * s + edge ** 2 * Math.asin(reach / edge)) + k ** 2 * reach);
    const rim = (width - 2 * edge) * (height - 2 * edge) * edge + (width + height - 4 * edge) * Math.PI * edge ** 2 / 2 + 8 * edge ** 3 / 3 - cornerLoss;
    return area * (depth - 2 * edge) + 2 * rim;
  }

  const stage = find('#stage');
  const mobileLayout = matchMedia('(max-width: 860px)');
  const labelsVisible = () => settings.labels && !mobileLayout.matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'labels';
  stage.prepend(renderer.domElement, labelRenderer.domElement);

  const scene = new THREE.Scene();
  // soft studio reflections make rounded edges readable without outlines
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture;
  scene.environmentIntensity = .5;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6), SUN_DIRECTION = new THREE.Vector3(-1, 3, 1).normalize();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // only the floor receives shadows, so items never show shadow acne
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: .3 }));
  floor.receiveShadow = true;
  scene.add(sun, sun.target, floor);
  const world = new THREE.Group();
  scene.add(world);
  let grid = null;

  const orthographicCamera = new THREE.OrthographicCamera();
  const perspectiveCamera = new THREE.PerspectiveCamera(35, 1, 1, 1e7);
  let camera = orthographicCamera;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  // render only when something changed or the camera is still moving
  let renderPending = true;
  const requestRender = () => { renderPending = true; };
  controls.addEventListener('change', () => { clipToScene(); requestRender(); });
  // the browser may drop the canvas while the tab is in the background
  document.addEventListener('visibilitychange', requestRender);
  renderer.domElement.addEventListener('webglcontextrestored', requestRender);
  renderer.setAnimationLoop(() => {
    if (!controls.update() && !renderPending) return;
    renderPending = false;
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    layoutLabels();
  });

  function layoutLabels() {
    const stageBox = stage.getBoundingClientRect(), taken = [];
    const elements = rendered.map(item => item.labelElement).filter(Boolean);
    for (const element of elements) element.style.translate = '';
    const labels = elements.flatMap(labelElement => {
      const box = labelElement.firstChild.hidden ? labelElement.lastElementChild : labelElement.firstChild;
      const rectangle = box.getBoundingClientRect();
      return rectangle.width && rectangle.height && getComputedStyle(box).visibility !== 'hidden' ? [{ labelElement, rectangle }] : [];
    }).sort((a, b) => a.rectangle.top - b.rectangle.top);
    for (const { labelElement, rectangle } of labels) {
      const left = stageBox.left + 6, right = stageBox.right - rectangle.width - 6;
      const top = stageBox.top + 6, bottom = stageBox.bottom - rectangle.height - 36;
      let x = Math.max(left, Math.min(rectangle.left, right)), y = Math.max(top, Math.min(rectangle.top, bottom));
      const fits = point => taken.every(other => point.left >= other.right + 4 || point.left + rectangle.width + 4 <= other.left
        || point.top >= other.bottom + 4 || point.top + rectangle.height + 4 <= other.top);
      if (!fits({ left: x, top: y })) {
        const xs = [x, left, right, ...taken.flatMap(other => [other.right + 4, other.left - rectangle.width - 4])];
        const ys = [y, top, bottom, ...taken.flatMap(other => [other.bottom + 4, other.top - rectangle.height - 4])];
        const candidates = xs.flatMap(left => ys.map(top => ({ left, top })))
          .filter(point => point.left >= left && point.left <= right && point.top >= top && point.top <= bottom)
          .sort((a, b) => (a.left - x) ** 2 + (a.top - y) ** 2 - (b.left - x) ** 2 - (b.top - y) ** 2);
        const free = candidates.find(fits);
        if (free) { x = free.left; y = free.top; }
      }
      labelElement.style.translate = `${x - rectangle.left}px ${y - rectangle.top}px`;
      taken.push({ left: x, right: x + rectangle.width, top: y, bottom: y + rectangle.height });
    }
  }

  function createGeometry(shape) {
    const { axis, width, height, depth, radius, edge } = sweep(shape), geometry = createSweptGeometry(width, height, depth, radius, edge);
    return axis === 0 ? geometry.rotateY(-Math.PI / 2) : axis === 1 ? geometry.rotateX(-Math.PI / 2) : geometry;
  }

  function createSweptGeometry(width, height, depth, radius, edge) {
    if (edge) return createBeveledGeometry(width, height, depth, radius, edge);
    if (!radius) return new THREE.BoxGeometry(width, height, depth);
    const outline = new THREE.Shape(), left = -width / 2, bottom = -height / 2;
    outline.moveTo(left + radius, bottom);
    outline.absarc(left + width - radius, bottom + radius, radius, -Math.PI / 2, 0);
    outline.absarc(left + width - radius, bottom + height - radius, radius, 0, Math.PI / 2);
    outline.absarc(left + radius, bottom + height - radius, radius, Math.PI / 2, Math.PI);
    outline.absarc(left + radius, bottom + radius, radius, Math.PI, Math.PI * 1.5);
    return new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: false, curveSegments: 10 }).translate(0, 0, -depth / 2);
  }

  function createBeveledGeometry(width, height, depth, radius, edge) {
    const positions = [], normals = [], indices = [], cornerSegments = 16, edgeSegments = 12;
    const corners = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
    const stride = 4 * (cornerSegments + 1);
    // each ring is the outline shrunk by the inset; its corners turn sharp (a miter) once the inset exceeds the corner radius
    function ring(angle, front) {
      const radial = Math.sin(angle), axial = Math.cos(angle), inset = edge * (1 - radial);
      const z = (front ? -1 : 1) * (depth / 2 - edge * (1 - axial)), round = Math.max(radius - inset, 0), reach = Math.max(radius, inset);
      corners.forEach(([sx, sy], corner) => {
        for (let step = 0; step <= cornerSegments; step++) {
          const theta = (corner - 1 + step / cornerSegments) * Math.PI / 2;
          const nx = Math.cos(theta), ny = Math.sin(theta);
          positions.push(sx * (width / 2 - reach) + round * nx, sy * (height / 2 - reach) + round * ny, z);
          normals.push(radial * nx, radial * ny, (front ? -1 : 1) * axial);
        }
      });
    }
    for (let step = 0; step <= edgeSegments; step++) ring(step / edgeSegments * Math.PI / 2, true);
    for (let step = depth === 2 * edge ? edgeSegments - 1 : edgeSegments; step >= 0; step--) ring(step / edgeSegments * Math.PI / 2, false);
    const rings = positions.length / 3 / stride;
    for (let layer = 0; layer < rings - 1; layer++) {
      for (let point = 0; point < stride; point++) {
        const a = layer * stride + point, b = layer * stride + (point + 1) % stride;
        indices.push(a, b, a + stride, b, b + stride, a + stride);
      }
    }
    const front = positions.length / 3, back = front + 1, last = (rings - 1) * stride;
    positions.push(0, 0, -depth / 2, 0, 0, depth / 2);
    normals.push(0, 0, -1, 0, 0, 1);
    for (let point = 0; point < stride; point++) {
      const next = (point + 1) % stride;
      indices.push(front, next, point, back, last + point, last + next);
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      .setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)).setIndex(indices);
  }

  const cssVariable = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function build() {
    world.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); object.element?.remove(); });
    world.clear();
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); grid = null; }
    find('#empty').hidden = entries.length > 0;
    find('#scale').textContent = '';
    controls.autoRotate = !!settings.autoRotate;
    requestRender();

    const isNested = settings.layout === 'nest';
    const opacity = settings.opacity * (isNested ? .5 : 1);
    rendered = entries.map((entry, index) => {
      const { css: color, rgb } = objectColor(index), shape = placed(entry), volume = computeVolume(shape);
      const mesh = new THREE.Mesh(createGeometry(shape), new THREE.MeshStandardMaterial({
        color: rgb, roughness: .5, metalness: .05, transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
        emissiveIntensity: .35, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      }));
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 20),
        new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: opacity * .5, depthWrite: false })));
      mesh.userData = { index, volume };
      mesh.castShadow = true;
      mesh.updateMatrixWorld();
      const bounds = new THREE.Box3().setFromObject(mesh);
      return { entry, shape, index, color, rgb, volume, mesh, bounds, size: bounds.getSize(new THREE.Vector3()), labelElement: null };
    });
    if (!rendered.length) return;

    const byVolume = [...rendered].sort((first, second) => second.volume - first.volume);
    byVolume.forEach((item, rank) => item.mesh.renderOrder = rank);
    const arrangeAxis = ARRANGE_AXIS[settings.layout], isStacked = arrangeAxis === 'y';
    // stacks: largest at the bottom; other layouts: small to large
    const order = settings.sort ? (isStacked ? byVolume : byVolume.toReversed()) : rendered;
    const largestDimension = Math.max(...rendered.map(item => Math.max(item.size.x, item.size.y, item.size.z)));
    const spacing = isStacked ? 0 : largestDimension * settings.spacing / 100;
    const alignment = { x: ALIGNMENTS[settings.alignX], y: 'min', z: ALIGNMENTS[settings.alignZ] };
    let cursor = 0;
    for (const item of order) {
      const { min, max } = item.bounds, holder = new THREE.Group();
      holder.add(item.mesh);
      for (const axis of ['x', 'y', 'z']) {
        // lines run away from the viewer, so the first item stands in front
        if (axis === arrangeAxis) { holder.position[axis] = axis === 'z' ? -cursor - max[axis] : cursor - min[axis]; cursor += item.size[axis] + spacing; }
        else holder.position[axis] = alignment[axis] === 'min' ? -min[axis] : alignment[axis] === 'max' ? -max[axis] : -(min[axis] + max[axis]) / 2;
      }
      item.labelElement = document.createElement('div');
      item.labelElement.className = labelsVisible() ? 'label' : 'label controls-only';
      item.labelElement.style.setProperty('--color', item.color);
      item.labelElement.innerHTML = `<div role="button" tabindex="0" aria-label="Select ${escapeHtml(item.entry.definition.name)}"><b>${escapeHtml(item.entry.definition.name)}</b><span>${formatDimensions(item.shape.size)}</span></div>
        <div class="label-actions" role="group" aria-label="Item orientation">
          <button data-action="tip" title="Tip: rotate forwards (X when selected)" aria-label="Tip forwards">${ICONS.tip}</button>
          <button data-action="turn" title="Turn around the vertical axis (Y when selected)" aria-label="Turn around the vertical axis">${ICONS.turn}</button>
          <button data-action="roll" title="Roll: rotate in the front plane (Z when selected)" aria-label="Roll in the front plane">${ICONS.roll}</button>
        </div>`;
      item.labelElement.firstChild.hidden = !labelsVisible();
      item.labelElement.addEventListener('click', event => {
        const button = event.target.closest('[data-action]');
        if (button) applyAction(item.index, button.dataset.action);
        else if (event.target.closest('[role=button]')) pick(item.index);
      });
      item.labelElement.firstChild.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        pick(item.index);
      });
      for (const event of ['pointerenter', 'pointerleave', 'focusin', 'focusout']) item.labelElement.addEventListener(event, requestRender);
      const label = new CSS2DObject(item.labelElement);
      if (isNested) { label.position.set(max.x, max.y, max.z); label.center.set(0, 1); }
      else if (isStacked) { label.position.set(max.x, (min.y + max.y) / 2, (min.z + max.z) / 2); label.center.set(0, .5); }
      else { label.position.set((min.x + max.x) / 2, max.y, (min.z + max.z) / 2); label.center.set(.5, 1); }
      holder.add(label);
      world.add(holder);
    }
    clipToScene();
    highlightPicked();

    const worldBounds = new THREE.Box3().setFromObject(world);
    const size = worldBounds.getSize(new THREE.Vector3()), center = worldBounds.getCenter(new THREE.Vector3());
    // the sun follows the scene, so its shadow camera always covers every item
    const extent = size.length(), radius = extent / 2;
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(SUN_DIRECTION, extent);
    Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 0, far: extent * 2 });
    sun.shadow.camera.updateProjectionMatrix();
    floor.position.set(center.x, -largestDimension * 2e-4, center.z);
    floor.scale.setScalar(extent * 4);
    if (settings.grid) {
      const span = Math.max(size.x, size.z);
      const [factor] = unitFor(span), step = 10 ** Math.floor(Math.log10(span / factor / 5)) * factor;
      const divisions = 2 * Math.ceil((span * .7 + largestDimension * .2) / step);
      grid = new THREE.GridHelper(divisions * step, divisions, cssVariable('--grid-strong'), cssVariable('--grid'));
      grid.position.set(Math.round(center.x / step) * step, -largestDimension * 1e-4, Math.round(center.z / step) * step);
      scene.add(grid);
      find('#scale').textContent = `Grid: ${formatLength(step)} squares`;
    }
  }

  function highlightPicked() {
    for (const item of rendered) {
      const picked = item.index === pickedIndex;
      item.mesh.material.emissive.set(picked ? item.rgb : 0);
      item.labelElement?.classList.toggle('picked', picked);
      item.labelElement?.firstChild.setAttribute('aria-pressed', picked);
    }
    requestRender();
  }

  const VIEW_DIRECTIONS = { isometric: [1, .75, 1.35], front: [0, 0, 1], side: [1, 0, 0], top: [0, 1, 1e-4] };
  const corners = ({ min, max }) => [0, 1, 2, 3, 4, 5, 6, 7].map(bits =>
    new THREE.Vector3(bits & 1 ? max.x : min.x, bits & 2 ? max.y : min.y, bits & 4 ? max.z : min.z));

  let fittedView, fitting;
  const fitButton = find('#fit');
  const setFitting = on => { fitting = on; fitButton.classList.toggle('active', on); };
  setFitting(true);
  // Fit is a toggle: on, the camera follows every scene change; a real zoom, pan or orbit turns it off, a click (pick) does not
  const direction = () => controls.object.position.clone().sub(controls.target).normalize();
  const cameraState = () => [...direction(), controls.getDistance(), controls.object.zoom, ...controls.target].join();
  let directionBefore, stateBefore;
  controls.addEventListener('start', () => { directionBefore = direction(); stateBefore = cameraState(); });
  controls.addEventListener('end', () => {
    if (cameraState() !== stateBefore) setFitting(false);
    // orbiting away from Top, Front or Side leaves a free 3D view
    if (!controls.autoRotate && direction().distanceTo(directionBefore) > .001 && settings.view !== 'isometric') { settings.view = fittedView = 'isometric'; commit(false); }
  });
  function rotateCamera(horizontal, vertical) {
    if (!entries.length) return false;
    controls.dispatchEvent({ type: 'start' });
    const orbit = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    orbit.theta += horizontal;
    orbit.phi += vertical;
    orbit.makeSafe();
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(orbit));
    controls.update();
    controls.dispatchEvent({ type: 'end' });
  }
  function zoomCamera(factor) {
    if (!entries.length) return false;
    controls.dispatchEvent({ type: 'start' });
    if (camera.isPerspectiveCamera) {
      const offset = camera.position.clone().sub(controls.target);
      offset.setLength(Math.max(controls.minDistance, Math.min(controls.maxDistance, controls.getDistance() / factor)));
      camera.position.copy(controls.target).add(offset);
    } else {
      camera.zoom = Math.max(controls.minZoom, Math.min(controls.maxZoom, camera.zoom * factor));
      camera.updateProjectionMatrix();
    }
    controls.update();
    clipToScene();
    requestRender();
    controls.dispatchEvent({ type: 'end' });
  }
  function panCamera(horizontal, vertical) {
    if (!entries.length) return false;
    controls.dispatchEvent({ type: 'start' });
    const height = camera.isPerspectiveCamera
      ? 2 * controls.getDistance() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      : (camera.top - camera.bottom) / camera.zoom;
    camera.updateMatrixWorld();
    const offset = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(horizontal * height * .01);
    offset.addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1), vertical * height * .01);
    camera.position.add(offset);
    controls.target.add(offset);
    controls.update();
    clipToScene();
    requestRender();
    controls.dispatchEvent({ type: 'end' });
  }
  function fitCamera(force = false) {
    if (!fitting && !force) return;
    // keep the orbit the user dragged to, unless the view preset changed
    const direction = fittedView === settings.view
      ? camera.position.clone().sub(controls.target).normalize()
      : new THREE.Vector3(...VIEW_DIRECTIONS[settings.view]).normalize();
    camera = settings.perspective ? perspectiveCamera : orthographicCamera;
    controls.object = camera;
    const bounds = new THREE.Box3().setFromObject(world);
    if (bounds.isEmpty()) return;
    fittedView = settings.view;
    const center = bounds.getCenter(new THREE.Vector3()), radius = bounds.getSize(new THREE.Vector3()).length() / 2 || 1;
    camera.up.set(0, 1, 0);
    camera.position.copy(center).addScaledVector(direction, radius * 4);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    const points = corners(bounds).map(point => point.applyMatrix4(camera.matrixWorldInverse));
    const extent = axis => Math.max(...points.map(point => point[axis])) - Math.min(...points.map(point => point[axis]));
    const info = find('#info'), popover = find('.popover:not([hidden])');
    const mobile = mobileLayout.matches;
    let padLeft = info.hidden || mobile ? 0 : info.offsetWidth + 28, padRight = popover?.parentElement === stage ? popover.offsetWidth + 28 : 0;
    if (stage.clientWidth - padLeft - padRight < 240) padLeft = padRight = 0;
    const labelRoom = labelsVisible() ? Math.max(100, ...rendered.map(item => (item.labelElement?.offsetHeight || 0) + 20)) : 60;
    const width = stage.clientWidth - padLeft - padRight, height = stage.clientHeight;
    let unitsPerPixel;
    if (settings.perspective) {
      const tangent = Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov / 2));
      const distance = Math.max(extent('x') * height / width, extent('y') * height / Math.max(1, height - labelRoom)) / 2 / tangent * 1.2 + extent('z') / 2;
      camera.position.copy(center).addScaledVector(direction, distance);
      unitsPerPixel = 2 * distance * tangent / height;
    } else {
      orthographicCamera.zoom = Math.min(width / extent('x'), Math.max(1, height - labelRoom) / extent('y')) * .85;
      unitsPerPixel = 1 / orthographicCamera.zoom;
    }
    camera.updateProjectionMatrix();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), shift = (padRight - padLeft) / 2 * unitsPerPixel;
    controls.target.copy(center).addScaledVector(right, shift);
    camera.position.addScaledVector(right, shift);
    if (labelsVisible()) {
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1), shiftDown = labelRoom / 2 * unitsPerPixel;
      controls.target.addScaledVector(up, shiftDown);
      camera.position.addScaledVector(up, shiftDown);
    }
    clipToScene();
    controls.update();
    requestRender();
  }

  // with Fit off the camera stays put, so the planes follow the scene instead
  function clipToScene() {
    const bounds = new THREE.Box3().setFromObject(world);
    if (bounds.isEmpty()) return;
    const radius = bounds.getSize(new THREE.Vector3()).length() / 2 || 1, distance = camera.position.distanceTo(bounds.getCenter(new THREE.Vector3()));
    camera.near = camera.isPerspectiveCamera ? Math.max(distance - radius * 2, distance / 100) : distance - radius * 2;
    camera.far = distance + radius * 4;
    camera.updateProjectionMatrix();
  }

  function moveSceneCards() {
    const mobile = mobileLayout.matches;
    for (const panel of findAll('.scene .card')) {
      if (mobile) stage.before(panel);
      else if (panel.parentElement !== stage) stage.append(panel);
    }
  }

  function resize() {
    const width = stage.clientWidth, height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    labelRenderer.setSize(width, height);
    Object.assign(orthographicCamera, { left: -width / 2, right: width / 2, top: height / 2, bottom: -height / 2 });
    perspectiveCamera.aspect = width / height;
    orthographicCamera.updateProjectionMatrix();
    perspectiveCamera.updateProjectionMatrix();
    fitCamera();
    requestRender();
  }
  new ResizeObserver(resize).observe(stage);
  moveSceneCards();
  mobileLayout.addEventListener('change', () => { moveSceneCards(); build(); resize(); });

  // a click (not a drag) picks the smallest object under the pointer, so nested ones stay reachable
  const raycaster = new THREE.Raycaster(), pointerDown = { x: 0, y: 0 };
  function objectUnderPointer(event) {
    const rectangle = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(
      (event.clientX - rectangle.left) / rectangle.width * 2 - 1,
      -(event.clientY - rectangle.top) / rectangle.height * 2 + 1), camera);
    const hits = raycaster.intersectObjects(world.children, true).filter(intersection => intersection.object.isMesh);
    const hit = hits.sort((first, second) => first.object.userData.volume - second.object.userData.volume)[0];
    return hit ? hit.object.userData.index : null;
  }
  renderer.domElement.addEventListener('pointerdown', event => Object.assign(pointerDown, { x: event.clientX, y: event.clientY }));
  renderer.domElement.addEventListener('click', event => {
    if (event.button !== 0 || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 4) return;
    pick(objectUnderPointer(event));
  });
  renderer.domElement.addEventListener('pointermove', event => {
    const index = event.buttons ? null : objectUnderPointer(event);
    for (const item of rendered) item.labelElement?.classList.toggle('hovered', item.index === index);
    renderer.domElement.style.cursor = index === null ? '' : 'pointer';
    requestRender();
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    for (const item of rendered) item.labelElement?.classList.remove('hovered');
    renderer.domElement.style.cursor = '';
    requestRender();
  });

  function pick(index) {
    pickedIndex = pickedIndex === index ? null : index;
    highlightPicked();
    findAll('#selected .chip').forEach(chip => {
      const picked = +chip.dataset.index === pickedIndex;
      chip.classList.toggle('picked', picked);
      chip.setAttribute('aria-pressed', picked);
    });
    renderInfo();
    fitCamera();
  }

  function renderResults() {
    const words = find('#search').value.toLowerCase().split(/\s+/).filter(Boolean), category = find('#category').value;
    const selectedKeys = new Set(entries.map(entry => entry.definition.key));
    const matches = catalog.filter(definition => (!category || definition.category === category)
      && words.every(word => `${definition.name} ${definition.label}`.toLowerCase().includes(word)));
    find('#results').innerHTML = matches.map(definition => {
      const selected = selectedKeys.has(definition.key);
      return `<li><button data-key="${definition.key}" class="${selected ? 'selected' : ''}">
        <span><b>${escapeHtml(definition.name)}</b><small>${escapeHtml(definition.label)} · ${formatDimensions(definition.size)}</small></span>
        ${selected ? ICONS.check : ICONS.plus}</button></li>`;
    }).join('') || '<li class="none">No matches. Use + in the toolbar to add your own dimensions.</li>';
  }

  function renderTray() {
    finishDrag();
    find('#selected').innerHTML = rendered.map(item => `<li class="chip ${pickedIndex === item.index ? 'picked' : ''}" data-index="${item.index}" style="--color:${item.color}" draggable="true" role="button" tabindex="0" aria-pressed="${pickedIndex === item.index}" title="Drag to reorder">
      <i></i><div><b>${escapeHtml(item.entry.definition.name)}</b><small>${formatDimensions(item.shape.size)}</small></div></li>`).join('');
  }

  function renderInfo() {
    const item = rendered[pickedIndex], panel = find('#info');
    panel.hidden = !item;
    if (!item) return;
    const definition = item.entry.definition, [width, height, depth] = item.size.toArray();
    const comparisons = rendered.filter(other => other !== item)
      .map(other => `<li><span>vs ${escapeHtml(other.entry.definition.name)}</span><b>${formatRatio(item.volume / other.volume)}</b></li>`).join('');
    panel.style.setProperty('--color', item.color);
    panel.innerHTML = `<header><i></i><h3>${escapeHtml(definition.name)}</h3><button data-action="close" title="Close (Esc)" aria-keyshortcuts="Escape">${ICONS.close}</button></header>
      <dl>
        <dt>Category</dt><dd>${escapeHtml(definition.label)}</dd>
        <dt>Size (W × H × D)</dt><dd>${formatDimensions([width, height, depth])}</dd>
        <dt>Volume</dt><dd>${formatVolume(item.volume)}</dd>
        <dt>Front Area</dt><dd>${formatArea(width * height)}</dd>
        <dt>Footprint</dt><dd>${formatArea(width * depth)}</dd>
        ${diameter(item.shape) ? `<dt>Diameter</dt><dd>${formatLength(diameter(item.shape))}</dd>` : ''}
      </dl>
      ${comparisons ? `<ul class="comparisons">${comparisons}</ul>` : ''}
      <div class="actions">
        <button class="ghost" data-action="edit" title="Change name or size (E)" aria-keyshortcuts="E">Edit</button>
        <button class="ghost remove" data-action="remove" title="Remove Selected (Delete / Backspace)" aria-keyshortcuts="Delete Backspace">Remove</button>
      </div>`;
  }

  function syncControls() {
    findAll('[data-setting]').forEach(button => {
      const active = String(settings[button.dataset.setting]) === button.dataset.value;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active);
    });
    findAll('[data-option]').forEach(input => input.checked = !!settings[input.dataset.option]);
  }

  function applyAction(index, action) {
    if (action === 'edit') return startEditing(index);
    if (action === 'remove') return removeEntries(index, 1);
    if (action === 'close') return pick(index);
    const focused = document.activeElement?.closest('.label-actions button'), entry = entries[index];
    entry.order = reorder(entry.order, TURNS[action]);
    // custom items keep their values as seen, so the turn is written into them
    if (entry.definition.category === 'custom') {
      const { name, size, round } = placed(entry);
      Object.assign(entry, { definition: customDefinition(name, size, round), order: AS_DEFINED });
    }
    // the edit form previews and commits the turned item
    if (editing?.index === index) fillCustomForm(placed(entry));
    else commit(true);
    if (focused) {
      const button = rendered[index]?.labelElement.querySelector(`[data-action="${action}"]`);
      requestAnimationFrame(() => button?.focus({ preventScroll: true }));
    }
  }

  function toggle(key) {
    const index = entries.findIndex(entry => entry.definition.key === key);
    if (index >= 0) changeEntries(() => entries.splice(index, 1));
    else entries.push({ definition: catalogByKey.get(key), order: AS_DEFINED });
    commit(true);
  }

  let toastTimer;
  function toast(message, undo) {
    const element = find('#toast');
    element.textContent = message;
    if (undo) {
      const button = document.createElement('button');
      button.textContent = 'Undo';
      button.addEventListener('click', () => { element.hidden = true; undo(); });
      element.append(button);
    }
    element.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.hidden = true, undo ? 6000 : 1800);
  }
  function removeEntries(start, count) {
    if (editing) closePopovers();
    const removed = changeEntries(() => entries.splice(start, count));
    commit(true);
    toast(removed.length === 1 ? `Removed ${removed[0].definition.name}` : `Removed ${removed.length} items`, () => {
      changeEntries(() => entries.splice(start, 0, ...removed));
      commit(true);
    });
  }
  // indexes shift, so the picked and edited items are found again by identity
  function changeEntries(change) {
    const picked = entries[pickedIndex], edited = editing && entries[editing.index], result = change();
    pickedIndex = entries.includes(picked) ? entries.indexOf(picked) : null;
    if (editing) editing.index = entries.indexOf(edited);
    return result;
  }

  const SESSIONS_STORAGE_KEY = 'visualCompare.sessions';
  const localSessions = {
    label: 'Saved in this browser only',
    read() { try { return JSON.parse(localStorage.getItem(SESSIONS_STORAGE_KEY)) || []; } catch { return []; } },
    write(list) {
      try { localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(list)); } catch { throw new Error('Browser storage is unavailable'); }
    },
    async list() { return this.read(); },
    async save(session) { this.write([session, ...this.read().filter(other => other.name !== session.name)]); },
    async rename(name, newName) {
      const list = this.read();
      if (list.some(session => session.name === newName)) throw new Error('A session with that name already exists');
      this.write(list.map(session => session.name === name ? { ...session, name: newName } : session));
    },
    async remove(name) { this.write(this.read().filter(session => session.name !== name)); },
  };
  // the publishable key is public by design; row level security keeps each account's rows private
  const SUPABASE_URL = 'https://cspfxytrzezcngqptsnl.supabase.co', SUPABASE_KEY = 'sb_publishable_Q18YqbHlLuRjTyCBI6cUkQ_xkGpjhhk';
  async function supabase(path, { method = 'GET', body, token, prefer } = {}) {
    // a paused free project also fails here, not with an http error
    const response = await fetch(SUPABASE_URL + path, { method, body: body && JSON.stringify(body), headers: {
      apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }), ...(prefer && { Prefer: prefer }) } })
      .catch(() => { throw new Error('Can’t reach Supabase, check your connection'); });
    const result = await response.json().catch(() => null);
    if (response.ok) return result;
    const error = new Error(result?.code === '23505' ? 'A session with that name already exists' : result?.msg || result?.message || `Supabase replied ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const AUTH_STORAGE_KEY = 'visualCompare.auth';
  const auth = {
    read() { try { return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)); } catch { return null; } },
    write(session) { try { session ? localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session)) : localStorage.removeItem(AUTH_STORAGE_KEY); } catch {} },
  };
  async function accessToken() {
    let session = auth.read();
    if (session?.expires_at * 1000 < Date.now() + 60000) {
      try { session = await supabase('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } }); }
      catch (error) {
        // a rejected refresh token ends the sign-in; a network error keeps it for the next try
        if (!(error.status >= 400 && error.status < 500)) throw error;
        session = null;
      }
      auth.write(session);
    }
    // also signed out from another tab
    if (!session) { chooseSessions(); throw new Error('Signed out, please sign in again'); }
    return session.access_token;
  }
  const byName = name => '?name=eq.' + encodeURIComponent(name);
  const accountSessions = {
    get label() { return `Saved to your account: ${auth.read()?.user.email}`; },
    async request(filter, options) { return supabase('/rest/v1/visualcompare_sessions' + filter, { ...options, token: await accessToken() }); },
    list() { return this.request('?select=name,query,savedAt:saved&order=saved.desc'); },
    save({ name, query, savedAt }) {
      return this.request('?on_conflict=owner,name', { method: 'POST', body: { name, query, saved: savedAt }, prefer: 'resolution=merge-duplicates' });
    },
    rename(name, newName) { return this.request(byName(name), { method: 'PATCH', body: { name: newName } }); },
    remove(name) { return this.request(byName(name), { method: 'DELETE' }); },
  };

  const sessionForm = find('#sessionForm'), sessionList = find('#sessionList'), authForm = find('#authForm'), signOutButton = find('#signOut');
  // the list shows from memory at once and loads in the background; changes reach the store one at a time, in order
  let sessions, savedSessions = null, sessionNames = new Set(), sessionsVersion = 0, sessionsQueue = Promise.resolve();
  const queueSessions = work => sessionsQueue = sessionsQueue.catch(() => {}).then(work);
  // a load started before a later change would undo it on screen, so it is dropped
  function loadSessions() {
    const version = sessionsVersion, store = sessions;
    if (!savedSessions) renderSessions();
    queueSessions(() => store.list()).then(
      list => { if (version === sessionsVersion) { savedSessions = list; renderSessions(); } },
      error => { if (version === sessionsVersion && !savedSessions) renderSessions(error.message); });
  }
  function changeSessions(list, work) {
    const store = sessions;
    savedSessions = list;
    sessionsVersion++;
    renderSessions();
    queueSessions(() => work(store)).then(loadSessions, error => { toast(error.message); loadSessions(); });
  }
  function chooseSessions() {
    sessions = auth.read() ? accountSessions : localSessions;
    authForm.hidden = sessions === accountSessions;
    signOutButton.hidden = !authForm.hidden;
    find('#sessionStore').textContent = sessions.label;
    savedSessions = null;
    sessionsVersion++;
    renderSessions();
    loadSessions();
  }
  const syncSessionButton = () => { sessionForm.elements.save.textContent = sessionNames.has(sessionForm.elements.name.value.trim()) ? 'Update' : 'Save'; };
  function renderSessions(empty = 'Loading…') {
    const list = savedSessions ?? [];
    sessionNames = new Set(list.map(session => session.name));
    sessionList.innerHTML = list.map(session => {
      const count = (new URLSearchParams(session.query).get('items') || '').split(',').filter(Boolean).length;
      return `<li data-name="${escapeHtml(session.name)}">
      <button class="load" data-action="load" title="Load"><b>${escapeHtml(session.name)}</b>
      <small>${count} item${count === 1 ? '' : 's'} · ${formatDate(session.savedAt)}</small></button>
      <button class="rename" data-action="rename" title="Rename">${ICONS.pencil}</button>
      <button class="delete" data-action="delete" title="Delete">${ICONS.close}</button></li>`;
    }).join('')
      || `<li class="none">${escapeHtml(savedSessions ? 'No saved sessions yet.' : empty)}</li>`;
    syncSessionButton();
  }
  chooseSessions();
  // PKCE: a link only signs in the browser that asked for it, so nobody can slip in a link to their own account
  const VERIFIER_STORAGE_KEY = 'visualCompare.verifier';
  const signIn = new URLSearchParams(location.search), authCode = signIn.get('code'), authError = signIn.get('error_description');
  if (authCode || authError) {
    for (const key of ['code', 'error', 'error_code', 'error_description']) signIn.delete(key);
    history.replaceState(null, '', location.pathname + (signIn.size ? '?' + signIn : '') + location.hash);
    let verifier = null;
    try { verifier = localStorage.getItem(VERIFIER_STORAGE_KEY); localStorage.removeItem(VERIFIER_STORAGE_KEY); } catch {}
    if (authError) toast(authError);
    else if (!verifier) toast('Open the link in the browser that asked for it, or type the code');
    else supabase('/auth/v1/token?grant_type=pkce', { method: 'POST', body: { auth_code: authCode, code_verifier: verifier } })
      .then(session => { auth.write(session); chooseSessions(); toast(`Signed in as ${session.user.email}`); }, error => toast(error.message));
  }
  async function pkceChallenge() {
    const verifier = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(VERIFIER_STORAGE_KEY, verifier);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }


  // the email has a link and a code; the code also works where the link opens elsewhere, like an installed app
  authForm.addEventListener('submit', async event => {
    event.preventDefault();
    const { code, submit } = authForm.elements, email = authForm.elements.email.value.trim();
    submit.disabled = true;
    try {
      if (code.hidden) {
        // the link returns to this page, comparison included
        await supabase('/auth/v1/otp?redirect_to=' + encodeURIComponent(location.href.split('#')[0]), { method: 'POST',
          body: { email, code_challenge: await pkceChallenge(), code_challenge_method: 's256' } });
        code.hidden = false;
        code.focus();
        submit.textContent = 'Sign In';
        toast(`Sign-in email sent to ${email}`);
      } else {
        auth.write(await supabase('/auth/v1/verify', { method: 'POST', body: { type: 'email', email, token: code.value.trim() } }));
        authForm.reset();
        resetAuthForm();
        chooseSessions();
        toast(`Signed in as ${email}`);
      }
    } catch (error) { toast(error.message); }
    submit.disabled = false;
  });
  function resetAuthForm() {
    authForm.elements.code.hidden = true;
    authForm.elements.submit.textContent = 'Send Email';
  }
  authForm.elements.email.addEventListener('input', resetAuthForm);
  signOutButton.addEventListener('click', () => {
    // revokes only this device's refresh token; signing out doesn't wait for it
    supabase('/auth/v1/logout?scope=local', { method: 'POST', token: auth.read()?.access_token }).catch(() => {});
    auth.write(null);
    chooseSessions();
  });

  sessionForm.addEventListener('input', syncSessionButton);
  sessionForm.addEventListener('submit', event => {
    event.preventDefault();
    const name = sessionForm.elements.name.value.trim(), session = { name, query: toQuery(), savedAt: Date.now() };
    if (!name) return;
    toast(`${sessionNames.has(name) ? 'Updated' : 'Saved'} “${name}”`);
    changeSessions([session, ...(savedSessions ?? []).filter(other => other.name !== name)], store => store.save(session));
  });

  function startRename(row, name) {
    const input = document.createElement('input');
    input.className = 'rename-field';
    input.value = name;
    row.querySelector('.load').replaceWith(input);
    input.focus();
    input.select();
    // a background load would redraw the list and drop the field
    sessionsVersion++;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      const newName = input.value.trim();
      if (!newName || newName === name) return renderSessions();
      if (sessionNames.has(newName)) { finished = false; return toast('A session with that name already exists'); }
      if (sessionForm.elements.name.value.trim() === name) sessionForm.elements.name.value = newName;
      changeSessions(savedSessions.map(session => session.name === name ? { ...session, name: newName } : session), store => store.rename(name, newName));
    };
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') finish();
      if (event.key === 'Escape') { event.stopPropagation(); input.value = name; finish(); }
    });
    input.addEventListener('blur', finish);
  }

  sessionList.addEventListener('click', event => {
    const action = event.target.closest('[data-action]');
    if (!action) return;
    const row = action.closest('[data-name]'), name = row.dataset.name;
    switch (action.dataset.action) {
      case 'rename': return startRename(row, name);
      case 'delete':
        // permanent, so it takes a second click
        if (!action.classList.contains('confirm')) { sessionsVersion++; action.classList.add('confirm'); action.textContent = 'Delete?'; return; }
        return changeSessions(savedSessions.filter(session => session.name !== name), store => store.remove(name));
      default:
        fromQuery(savedSessions.find(session => session.name === name).query);
        commit(true);
        sessionForm.elements.name.value = name;
        syncSessionButton();
        toast(`Loaded “${name}”`);
    }
  });

  const customForm = find('#customForm');
  // radii are in the menu's unit; a blank field is 0
  const ROUND_AXES = ['x', 'y', 'z'], readRound = () => ROUND_AXES.map(axis => +customForm.elements[axis].value);
  function readCustomForm() {
    const fields = customForm.elements, size = parseSize(fields.size.value, fields.unit.value);
    if (!size) return null;
    const factor = UNIT_FACTORS[fields.unit.value];
    return { ...size, round: readRound().map(value => +(value * factor).toFixed(6)), unit: fields.unit.value };
  }
  // the odd radius moves alone and the other two move together, also while all three match; all 0 frees the next change to be odd
  let oddRound = -1;
  function linkRound(changed) {
    const fields = customForm.elements;
    if (oddRound < 0) oddRound = changed;
    else if (changed >= 0 && changed !== oddRound) fields[ROUND_AXES[3 - changed - oddRound]].value = fields[ROUND_AXES[changed]].value;
    const round = readRound();
    if (round.every(value => !value)) oddRound = -1;
    else if (new Set(round).size === 2) oddRound = round.findIndex(value => round.indexOf(value) === round.lastIndexOf(value));
  }
  // a changed radius stays between 0 and the shape's limit: half the other two sizes for the odd one, half the smallest size for the pair
  function limitRound() {
    for (const axis of ROUND_AXES) if (/^-/.test(customForm.elements[axis].value)) customForm.elements[axis].value = 0;
    const size = readCustomForm();
    if (!size) return;
    const halves = size.values.map(value => value / 2), factor = UNIT_FACTORS[size.unit];
    size.round.forEach((radius, index) => {
      const limit = Math.min(...halves.filter((_, other) => index !== oddRound || other !== index));
      if (radius > limit) customForm.elements[ROUND_AXES[index]].value = +(limit / factor).toFixed(6);
    });
  }
  // the unit lives in the menu; switching it rewrites the size and radii in the new unit, so the item keeps its size
  const UNIT_OPTIONS = { inch: 'in', inches: 'in', '"': 'in', '″': 'in', foot: 'ft', feet: 'ft', "'": 'ft', '′': 'ft' };
  const inUnit = (millimeters, unit) => +(millimeters / UNIT_FACTORS[unit]).toFixed(5);
  let formUnit = 'mm';
  function setUnit(from, to) {
    const fields = customForm.elements, size = parseSize(fields.size.value, from);
    if (size) fields.size.value = size.values.map(value => inUnit(value, to)).join(' x ');
    for (const axis of ROUND_AXES) if (fields[axis].value) fields[axis].value = inUnit(+(fields[axis].value * UNIT_FACTORS[from]).toFixed(2), to);
    fields.unit.value = formUnit = to;
  }
  // a unit typed into the size moves to the menu on paste, blur or submit; not while typing, where "mm" passes through "m"
  function takeUnit() {
    const fields = customForm.elements, detected = parseSize(fields.size.value, fields.unit.value)?.detectedUnit;
    if (detected) setUnit(fields.unit.value, UNIT_OPTIONS[detected] ?? detected);
  }
  const ROUND_HINT = 'Round: two of the three must match, e.g. 1, 1, 12';
  const validCustomSize = size => !!size && validRound(size.round);
  const customFormDefinition = size => customDefinition(customForm.elements.name.value.trim() || 'Custom Item', size.values, size.round);
  customForm.addEventListener('reset', () => oddRound = -1);
  customForm.elements.size.addEventListener('change', takeUnit);
  customForm.addEventListener('input', ({ target, inputType }) => {
    const changed = ROUND_AXES.indexOf(target.name);
    if (target.name === 'unit') setUnit(formUnit, target.value);
    if (inputType === 'insertFromPaste') takeUnit();
    formUnit = customForm.elements.unit.value;
    linkRound(changed);
    if (changed >= 0) limitRound();
    const size = readCustomForm(), hint = find('#sizeHint');
    const definition = validCustomSize(size) ? customFormDefinition(size) : null;
    hint.textContent = !customForm.elements.size.value.trim() ? '' : !size ? 'Enter three numbers, e.g. 380 x 158 x 8 mm'
      : !definition ? ROUND_HINT
      : `${formatDimensions(size.values)} (W × H × D)`;
    if (definition && formatDimensions(definition.round) !== formatDimensions(size.round)) hint.textContent += ` · Round limited to ${formatDimensions(definition.round)}`;
    if (editing && definition) { entries[editing.index].definition = definition; commit(true); }
  });
  // editing turns any object into a custom one; changes preview live and revert on cancel
  function setEditing(state) {
    editing = state;
    find('#custom h3').textContent = editing ? 'Edit Item' : 'Add Item';
    customForm.elements.save.textContent = editing ? 'Save' : 'Add';
    customForm.elements.cancel.hidden = !editing;
  }
  customForm.elements.cancel.addEventListener('click', () => closePopovers());
  function startEditing(index) {
    closePopovers();
    const entry = entries[index], shape = placed(entry);
    find('[data-popover="custom"]').click();
    // the form shows the item as it stands, so the preview starts from that orientation
    setEditing({ index, original: entry.definition, order: entry.order });
    entry.order = AS_DEFINED;
    fillCustomForm(shape);
  }
  function fillCustomForm({ name, size, round }) {
    const fields = customForm.elements;
    fields.name.value = name;
    fields.size.value = size.join(' x ');
    fields.unit.value = 'mm';
    ROUND_AXES.forEach((axis, index) => fields[axis].value = round[index] || '');
    customForm.dispatchEvent(new Event('input'));
  }
  function cancelEditing() {
    Object.assign(entries[editing.index], { definition: editing.original, order: editing.order });
    setEditing(null);
    customForm.reset();
    find('#sizeHint').textContent = '';
    commit(true);
  }
  customForm.addEventListener('submit', event => {
    event.preventDefault();
    takeUnit();
    const size = readCustomForm();
    if (!validCustomSize(size)) return toast(size ? ROUND_HINT : 'Enter three positive numbers, e.g. 380 x 158 x 8 mm');
    if (editing) { entries[editing.index].definition = customFormDefinition(size); setEditing(null); customForm.reset(); closePopovers(); }
    else entries.push({ definition: customFormDefinition(size), order: AS_DEFINED });
    commit(true);
  });

  const categorySelect = find('#category');
  categorySelect.innerHTML = `<option value="">All Categories (${catalog.length})</option>` + Object.entries(CATEGORIES)
    .map(([key, category]) => `<option value="${key}">${escapeHtml(category.label)} (${category.items.length})</option>`).join('');
  find('#search').addEventListener('input', renderResults);
  categorySelect.addEventListener('change', renderResults);
  find('#results').addEventListener('click', event => {
    const button = event.target.closest('[data-key]');
    if (!button) return;
    const focused = document.activeElement === button;
    toggle(button.dataset.key);
    // the list is redrawn, so focus moves to the new button
    if (focused) find(`#results [data-key="${CSS.escape(button.dataset.key)}"]`).focus({ preventScroll: true });
  });

  const tray = find('#selected');
  tray.addEventListener('click', event => {
    const chip = event.target.closest('.chip');
    // the second click of a double-click opens the editor instead
    if (!chip || event.detail > 1) return;
    pick(+chip.dataset.index);
  });
  tray.addEventListener('keydown', event => {
    const chip = event.target.closest('.chip');
    if (!chip || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    pick(+chip.dataset.index);
  });
  tray.addEventListener('dblclick', event => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    if (pickedIndex !== +chip.dataset.index) pick(+chip.dataset.index);
    startEditing(+chip.dataset.index);
  });
  let dragIndex = null;
  let draggedChip = null, draggedSize = null;
  let dropPlaceholder = null, indicatedLocation = null;
  let lastDragPosition = '';
  function finishDrag() {
    if (draggedChip) draggedChip.hidden = false;
    draggedChip = draggedSize = dragIndex = null;
    dropPlaceholder?.remove();
    dropPlaceholder = indicatedLocation = null;
    lastDragPosition = '';
  }
  function dropLocation(event) {
    const distanceToPointer = rect => Math.max(rect.left - event.clientX, 0, event.clientX - rect.right) ** 2
      + Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom) ** 2;
    let closest = indicatedLocation, distance = dropPlaceholder ? distanceToPointer(dropPlaceholder.getBoundingClientRect()) : Infinity;
    for (const chip of tray.querySelectorAll('.chip')) {
      if (chip.hidden) continue;
      const rect = chip.getBoundingClientRect();
      const squared = distanceToPointer(rect);
      if (squared < distance) {
        distance = squared;
        closest = { chip, after: event.clientX >= rect.left + rect.width / 2 };
      }
    }
    return closest;
  }
  tray.addEventListener('dragstart', event => {
    draggedChip = event.target.closest('.chip');
    draggedSize = draggedChip.getBoundingClientRect();
    dragIndex = +draggedChip.dataset.index;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', '');  // Firefox will not start a drag without data
  });
  tray.addEventListener('dragover', event => {
    if (dragIndex === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dropPlaceholder) dropPlaceholder.style.visibility = '';
    const position = [event.clientX, event.clientY, tray.scrollTop, tray.clientWidth].join(',');
    // Reflow alone must not move the drop slot again.
    if (position === lastDragPosition) return;
    lastDragPosition = position;
    const location = dropLocation(event);
    if (!location) return;
    if (indicatedLocation?.chip === location.chip && indicatedLocation.after === location.after) return;
    if (!dropPlaceholder) {
      dropPlaceholder = document.createElement('li');
      dropPlaceholder.className = 'drop-placeholder';
      dropPlaceholder.setAttribute('aria-hidden', 'true');
      dropPlaceholder.style.width = `${draggedSize.width}px`;
      dropPlaceholder.style.height = `${draggedSize.height}px`;
    }
    indicatedLocation = location;
    tray.insertBefore(dropPlaceholder, location.after ? location.chip.nextSibling : location.chip);
    draggedChip.hidden = true;  // Wait until dragover so the browser captures the drag image first.
  });
  tray.addEventListener('dragleave', event => {
    if (dropPlaceholder && !tray.contains(event.relatedTarget)) {
      dropPlaceholder.style.visibility = 'hidden';
      lastDragPosition = '';
    }
  });
  tray.addEventListener('dragend', finishDrag);
  tray.addEventListener('drop', event => {
    if (dragIndex === null) return;
    event.preventDefault();
    const location = indicatedLocation || dropLocation(event), from = dragIndex;
    finishDrag();
    if (!location) return;
    const boundary = +location.chip.dataset.index + Number(location.after);
    const destination = boundary - Number(from < boundary);
    if (destination === from) return;
    changeEntries(() => entries.splice(destination, 0, ...entries.splice(from, 1)));
    settings.sort = 0;
    commit(true);
  });
  const infoPanel = find('#info');
  let pressedInfoAction = null;
  infoPanel.addEventListener('pointerdown', event => { pressedInfoAction = event.target.closest('[data-action]'); });
  infoPanel.addEventListener('pointercancel', () => { pressedInfoAction = null; });
  infoPanel.addEventListener('click', event => {
    const action = event.target.closest('[data-action]');
    if (action && (event.detail === 0 || action === pressedInfoAction)) applyAction(pickedIndex, action.dataset.action);
    pressedInfoAction = null;
  });

  findAll('[data-setting]').forEach(button => button.addEventListener('click', () => {
    settings[button.dataset.setting] = settingValue(button.dataset.setting, button.dataset.value);
    if (button.dataset.setting === 'view') setFitting(true);
    commit(REFIT_SETTINGS.has(button.dataset.setting));
  }));
  findAll('[data-option]').forEach(input => input.addEventListener('input', () => {
    settings[input.dataset.option] = +input.checked;
    if (input.dataset.option === 'perspective') setFitting(true);
    commit(REFIT_SETTINGS.has(input.dataset.option));
    if (input.dataset.option === 'labels' && input.checked && !fitting) fitCamera(true);
  }));
  find('#reset').addEventListener('click', () => {
    findAll('#settings [data-setting], #settings [data-option]').forEach(control => {
      const key = control.dataset.setting ?? control.dataset.option;
      settings[key] = DEFAULTS[key];
    });
    setFitting(true);
    commit(true);
  });

  const closePopovers = () => {
    findAll('.popover').forEach(popover => popover.hidden = true);
    findAll('[data-popover]').forEach(button => button.classList.remove('active'));
    if (editing) cancelEditing();
    fitCamera();
  };
  findAll('[data-popover]').forEach(button => button.addEventListener('click', () => {
    const popover = find('#' + button.dataset.popover), opening = popover.hidden;
    closePopovers();
    popover.hidden = !opening;
    button.classList.toggle('active', opening);
    if (opening && popover.id === 'sessions') loadSessions();
    if (opening && popover.id === 'custom') customForm.elements.name.focus();
    if (opening && popover.id === 'library') find('#search').focus();
    fitCamera();
  }));
  document.addEventListener('click', event => {
    if (!event.composedPath().some(element => element.matches?.('.card, .label, [data-popover]'))) closePopovers();
  });

  find('#share').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); toast('Link copied'); }
    catch { toast('Copy failed — use the address bar'); }
  });
  // labels are HTML, so the PNG draws them by hand onto the canvas
  function drawLabels(context, scale) {
    const stageBox = stage.getBoundingClientRect(), font = getComputedStyle(document.body).fontFamily;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (const item of rendered) {
      const box = item.labelElement?.firstChild;
      if (!box || box.hidden) continue;
      const rectangle = box.getBoundingClientRect(), picked = item.index === pickedIndex;
      const x = (rectangle.left - stageBox.left) * scale, y = (rectangle.top - stageBox.top) * scale, width = rectangle.width * scale, height = rectangle.height * scale;
      context.beginPath();
      context.roundRect(x, y, width, height, 8 * scale);
      context.fillStyle = picked ? item.color : cssVariable('--panel');
      context.fill();
      context.lineWidth = 1.5 * scale;
      context.strokeStyle = item.color;
      context.stroke();
      context.fillStyle = picked ? '#fff' : cssVariable('--text');
      context.font = `600 ${12.5 * scale}px ${font}`;
      context.fillText(box.firstChild.textContent, x + width / 2, y + height * .36);
      context.fillStyle = picked ? '#fff' : cssVariable('--muted');
      context.font = `${11 * scale}px ${font}`;
      context.fillText(box.lastChild.textContent, x + width / 2, y + height * .72);
    }
  }
  find('#download').addEventListener('click', () => {
    renderer.setClearColor(cssVariable('--background'), 1);
    renderer.render(scene, camera);
    const source = renderer.domElement, canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext('2d');
    context.drawImage(source, 0, 0);
    drawLabels(context, source.width / stage.clientWidth);
    renderer.setClearColor(0x000000, 0);
    requestRender();
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `${slugify(sessionForm.elements.name.value) || 'size-comparison'}.png`;
    link.click();
  });
  fitButton.addEventListener('click', () => { fittedView = undefined; setFitting(!fitting); fitCamera(); });

  // AR hands a GLB of the scene (in meters) to model-viewer, which opens Quick Look on iOS and WebXR on Android
  const arButton = find('#ar'), arViewer = find('#arViewer');
  const arLabel = document.createElement('span');
  arButton.append(arLabel);
  arButton.hidden = !matchMedia('(pointer: coarse)').matches;
  let arModules, arBusy = false, arPresenting = false, arReadyQuery = null, arModelURL = null, arUSDZURL = null;

  function loadARModules() {
    return arModules ??= Promise.all([
      import('three/addons/exporters/GLTFExporter.js'),
      import('https://cdn.jsdelivr.net/npm/@google/model-viewer@4.1.0/dist/model-viewer.min.js'),
    ]).catch(error => { arModules = null; throw error; });
  }
  function syncARButton() {
    arButton.disabled = arBusy || arPresenting;
    arLabel.textContent = arBusy ? (arReadyQuery === null ? 'Preparing…' : 'Starting…') : '';
    arLabel.hidden = !arLabel.textContent;
    arButton.title = arLabel.textContent || (arReadyQuery === null ? 'View in AR' : 'Start AR');
    arButton.setAttribute('aria-label', arButton.title);
    arButton.setAttribute('aria-busy', String(arBusy));
  }
  function clearPreparedAR() {
    arReadyQuery = null;
    if (arUSDZURL) { arViewer.iosSrc = null; URL.revokeObjectURL(arUSDZURL); arUSDZURL = null; }
    if (arModelURL) { arViewer.src = null; URL.revokeObjectURL(arModelURL); arModelURL = null; }
    syncARButton();
  }
  function invalidatePreparedAR(query) {
    if (!arBusy && !arPresenting && arReadyQuery !== null && arReadyQuery !== query) clearPreparedAR();
  }
  function loadARModel(url) {
    return new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer);
        arViewer.removeEventListener('load', loaded);
        arViewer.removeEventListener('error', failed);
        if (error) reject(error); else resolve();
      };
      const loaded = () => finish(), failed = () => finish(new Error('The AR model could not load. Tap AR to retry.'));
      const timer = setTimeout(() => finish(new Error('The AR model took too long to load. Tap AR to retry.')), 60000);
      arViewer.addEventListener('load', loaded);
      arViewer.addEventListener('error', failed);
      try { arViewer.src = url; } catch (error) { finish(error); }
    });
  }
  arViewer.addEventListener('ar-status', ({ detail }) => {
    arPresenting = detail.status === 'session-started' || detail.status === 'object-placed';
    arViewer.classList.toggle('active', arPresenting);
    syncARButton();
    invalidatePreparedAR(toQuery());
    if (detail.status === 'failed') toast('AR could not start');
  });
  arButton.addEventListener('click', async () => {
    if (!entries.length || arBusy || arPresenting) return;
    const query = toQuery();
    invalidatePreparedAR(query);
    arBusy = true;
    syncARButton();
    // Keep launch in the fresh tap handler, before any import, export or loading await.
    if (arReadyQuery === query) {
      try { await arViewer.activateAR(); }
      catch (error) { console.error(error); toast('AR could not start. Tap Start AR to retry.'); }
      finally { arBusy = false; syncARButton(); invalidatePreparedAR(toQuery()); }
      return;
    }
    try {
      clearPreparedAR();
      const [{ GLTFExporter }] = await loadARModules();
      const copy = new THREE.Group();
      copy.scale.setScalar(.001);
      for (const holder of world.children) {
        const clone = holder.clone(), extras = [];
        clone.traverse(object => { if (object.isLineSegments || object.isCSS2DObject) extras.push(object); });
        extras.forEach(object => object.removeFromParent());
        copy.add(clone);
      }
      const glb = await new Promise((resolve, reject) => new GLTFExporter().parse(copy, resolve, reject, { binary: true }));
      arModelURL = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
      await loadARModel(arModelURL);
      await arViewer.updateComplete;
      if (!arViewer.canActivateAR) { clearPreparedAR(); return toast('AR is not available in this browser'); }
      // model-viewer 4.1 exposes prepareUSDZ(); cache its result so Quick Look
      // does not need an asynchronous conversion inside the launch tap.
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (isIOS) {
        arUSDZURL = await arViewer.prepareUSDZ();
        arViewer.iosSrc = arUSDZURL;
        await arViewer.updateComplete;
      }
      if (query !== toQuery()) { clearPreparedAR(); return toast('Comparison changed. Tap AR to prepare it again.'); }
      arReadyQuery = query;
      toast('AR Ready — tap Start AR to launch');
    } catch (error) {
      console.error(error);
      clearPreparedAR();
      toast(error.message?.startsWith('The AR model') ? error.message : 'AR could not prepare. Tap AR to retry.');
    } finally {
      arBusy = false;
      syncARButton();
    }
  });
  syncARButton();
  find('#fullscreen').hidden = !document.fullscreenEnabled;
  find('#fullscreen').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : find('.main').requestFullscreen());
  document.addEventListener('fullscreenchange', () => find('#fullscreen').classList.toggle('active', !!document.fullscreenElement));
  const clearButton = find('#clear');
  let clearTimer;
  clearButton.addEventListener('click', () => {
    if (!entries.length) return;
    if (clearButton.classList.contains('confirm')) { clearButton.classList.remove('confirm'); return removeEntries(0, entries.length); }
    clearButton.classList.add('confirm');
    toast('Press Shift+C or click the bin again to clear the scene');
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => clearButton.classList.remove('confirm'), 3000);
  });

  const KEY_NAMES = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Delete: 'Del', Backspace: '⌫', Escape: 'Esc', 'Shift+f': 'Shift+F', 'Shift+c': 'Shift+C', ' ': 'Space', 'Shift+ ': 'Shift+Space' };
  const keyName = key => KEY_NAMES[key] ?? (key.startsWith('Shift+') ? 'Shift+' + keyName(key.slice(6)) : key.toUpperCase());
  const forButton = (key, button) => {
    const label = button.title;
    button.title = `${label} (${keyName(key)})`;
    button.setAttribute('aria-keyshortcuts', keyName(key));
    return [[key], label, () => button.click()];
  };
  function stepSetting(key, offset, wrap = false) {
    const buttons = [...findAll(`[data-setting="${key}"]`)];
    const index = buttons.findIndex(button => settingValue(key, button.dataset.value) === settings[key]);
    const next = wrap ? (index + offset + buttons.length) % buttons.length : Math.max(0, Math.min(buttons.length - 1, index + offset));
    if (next !== index) buttons[next]?.click();
  }
  const cycleShortcut = (key, setting, label) => [[key, `Shift+${key}`], label, event => stepSetting(setting, event.shiftKey ? -1 : 1, true)];
  const forPicked = action => () => pickedIndex != null && applyAction(pickedIndex, action);
  const pickNext = offset => {
    const count = entries.length;
    if (!count) return false;
    const next = ((pickedIndex ?? (offset > 0 ? -1 : count)) + offset + count) % count;
    if (next !== pickedIndex) pick(next);
  };
  const help = find('#shortcuts');
  const toggleHelp = () => { const opening = help.hidden; closePopovers(); help.hidden = !opening; fitCamera(); };
  // digits follow the toolbar order: views, then layouts; an action returning false leaves the key to the browser
  const viewShortcuts = [...findAll('.tools [data-setting]')].map((button, index) => forButton(String(index + 1), button));
  const optionShortcut = (key, option, label) => {
    const input = find(`[data-option="${option}"]`);
    input.title = `${label} (${keyName(key)})`;
    input.setAttribute('aria-keyshortcuts', keyName(key));
    return [[key], label, () => input.click()];
  };
  const SHORTCUT_GROUPS = {
    'View & Camera': [
      ...viewShortcuts.slice(0, 4),
      [['ArrowLeft', 'ArrowRight'], 'Rotate Left / Right', event => rotateCamera((event.key === 'ArrowLeft' ? 1 : -1) * Math.PI / 180, 0)],
      [['ArrowUp', 'ArrowDown'], 'Rotate Up / Down', event => rotateCamera(0, (event.key === 'ArrowUp' ? 1 : -1) * Math.PI / 180)],
      [['Shift+ArrowLeft', 'Shift+ArrowRight'], 'Pan Left / Right', event => panCamera(event.key === 'ArrowLeft' ? 1 : -1, 0)],
      [['Shift+ArrowUp', 'Shift+ArrowDown'], 'Pan Up / Down', event => panCamera(0, event.key === 'ArrowUp' ? -1 : 1)],
      [['+', '-'], 'Zoom In / Out', event => zoomCamera(event.key === '-' ? 1 / 1.01 : 1.01)],
      forButton('f', fitButton),
      ...(document.fullscreenEnabled ? [forButton('Shift+f', find('#fullscreen'))] : []),
      optionShortcut('p', 'perspective', 'Perspective Camera'),
      optionShortcut('r', 'autoRotate', 'Auto-Rotate'),
    ],
    'Items & Layout': [
      ...viewShortcuts.slice(4),
      forButton('i', find('[data-popover="library"]')),
      forButton('a', find('[data-popover="custom"]')),
      [[' ', 'Shift+ '], 'Next / Previous Item', event => pickNext(event.shiftKey ? -1 : 1)],
      [['x'], 'Tip Selected', forPicked('tip')],
      [['y'], 'Turn Selected', forPicked('turn')],
      [['z'], 'Roll Selected', forPicked('roll')],
      [['e'], 'Edit Selected', forPicked('edit')],
      [['Delete', 'Backspace'], 'Remove Selected', forPicked('remove')],
      forButton('Shift+c', clearButton),
    ],
    'Display & Options': [
      optionShortcut('l', 'labels', 'Labels'),
      optionShortcut('g', 'grid', 'Floor Grid'),
      optionShortcut('s', 'sort', 'Sort by Volume'),
      cycleShortcut('w', 'alignX', 'Align Width'),
      cycleShortcut('d', 'alignZ', 'Align Depth'),
      cycleShortcut('o', 'opacity', 'Opacity'),
      [['[', ']'], 'Spacing', event => stepSetting('spacing', event.key === '[' ? -1 : 1)],
      forButton(',', find('[data-popover="settings"]')),
      [['Escape'], 'Close or Deselect', () => find('.popover:not([hidden])') ? closePopovers() : forPicked('close')()],
      [['?'], 'Keyboard Shortcuts', toggleHelp],
    ],
  };
  const SHORTCUTS = Object.values(SHORTCUT_GROUPS).flat();
  help.innerHTML = '<h3>Keyboard Shortcuts</h3><div class="shortcut-groups">' + Object.entries(SHORTCUT_GROUPS).map(([group, shortcuts]) =>
    `<section><h4>${escapeHtml(group)}</h4><dl>` + shortcuts.map(([keys, label]) =>
      `<dt>${keys.map(key => `<kbd>${keyName(key)}</kbd>`).join(' ')}</dt><dd>${escapeHtml(label)}</dd>`).join('') + '</dl></section>').join('') + '</div>';
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    if ((event.target.isContentEditable || event.target.closest('input, select, textarea')) && event.key !== 'Escape') return;
    if (event.key === ' ' && event.target.closest('button, a')) return;
    const key = event.key === '=' ? '+' : event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const shortcut = (event.shiftKey && SHORTCUTS.find(([keys]) => keys.includes(`Shift+${key}`)))
      || (!(event.shiftKey && key === 'f') && SHORTCUTS.find(([keys]) => keys.includes(key)));
    if (!shortcut) return;
    const repeatable = key.startsWith('Arrow') || [' ', '-', '+', '[', ']'].includes(key);
    if (event.repeat && !repeatable) { event.preventDefault(); return; }
    if (shortcut[2](event) !== false) event.preventDefault();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => build());
  // the theme is a viewer preference, so it stays in this browser instead of the URL
  const root = document.documentElement, themeButtons = findAll('button[data-theme]');
  const syncTheme = () => themeButtons.forEach(button => {
    const active = button.dataset.theme === (root.dataset.theme ?? 'auto');
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  });
  themeButtons.forEach(button => button.addEventListener('click', () => {
    const theme = button.dataset.theme;
    if (theme === 'auto') delete root.dataset.theme; else root.dataset.theme = theme;
    try { theme === 'auto' ? localStorage.removeItem('visualCompare.theme') : localStorage.setItem('visualCompare.theme', theme); } catch {}
    syncTheme();
    build();
  }));
  syncTheme();

  let startQuery = location.search.slice(1);
  try { startQuery ||= localStorage.getItem('visualCompare.last') ?? SAMPLE_QUERY; } catch { startQuery ||= SAMPLE_QUERY; }
  fromQuery(startQuery);
  commit(true);
})().catch(error => {
  console.error(error);
  document.querySelector('#empty').textContent = 'The 3D view could not start. Check your internet connection (the 3D library loads from a CDN) and that WebGL is enabled.';
});
