// import() instead of type=module, so the page also works when opened from disk (file://)
(async () => {
  const find = selector => document.querySelector(selector);
  const findAll = selector => document.querySelectorAll(selector);
  const escapeHtml = text => String(text).replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
  const isPositive = value => Number.isFinite(value) && value > 0;

  const [THREE, { OrbitControls }, { CSS2DRenderer, CSS2DObject }] = await Promise.all([
    import('three'), import('three/addons/controls/OrbitControls.js'), import('three/addons/renderers/CSS2DRenderer.js')]);

  const icon = paths => `<svg viewBox="0 0 24 24">${paths}</svg>`;
  const ICONS = {
    plus: icon('<path d="M12 5l0 14" /> <path d="M5 12l14 0" />'),
    check: icon('<path d="M5 12l5 5l10 -10" />'),
    close: icon('<path d="M18 6l-12 12" /> <path d="M6 6l12 12" />'),
    turn: icon('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
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
  const catalog = Object.entries(CATEGORIES).flatMap(([category, { label, items }]) =>
    items.map(([name, width, height, depth, radius = 0, shape = 'box']) =>
      ({ key: `${category}/${slugify(name)}`, category, label, name, width, height, depth, radius, shape })));
  const catalogByKey = new Map(catalog.map(definition => [definition.key, definition]));
  const customDefinition = (name, width, height, depth, radius = 0) => ({
    key: `custom:${name.replace(/[%:,]/g, encodeURIComponent)}:${width}:${height}:${depth}${radius ? `:${radius}` : ''}`,
    category: 'custom', label: 'Custom', name, width, height, depth, radius, shape: 'box',
  });

  // all state is in the URL, so a link and a saved session are the same thing
  const DEFAULTS = { view: 'isometric', layout: 'row', alignX: 'center', alignZ: 'center', unit: 'cm', labels: 1, grid: 1, edges: 1, opacity: 1, spacing: 1, sort: 0, autoRotate: 0, perspective: 0 };
  const REFIT_SETTINGS = new Set(['view', 'layout', 'alignX', 'alignZ', 'perspective', 'spacing', 'sort', 'labels']);
  const ARRANGE_AXIS = { row: 'x', line: 'z', stack: 'y' };
  const ALIGNMENTS = { left: 'min', back: 'min', center: 'center', right: 'max', front: 'max' };
  const SAMPLE_QUERY = 'items=audio/kef-r3,audio/edifier-r1280dbs,audio/buchardt-e50-s,audio/arendal-1528-bookshelf-8,audio/cambridge-audio-l-r-x';
  let settings = { ...DEFAULTS }, entries = [], pickedIndex = null, rendered = [];

  function toQuery() {
    const parameters = new URLSearchParams();
    if (entries.length) parameters.set('items', entries.map(entry =>
      entry.definition.key + (entry.turn || entry.tip || entry.roll ? `!${entry.turn}${entry.tip}${entry.roll}` : '')).join(','));
    for (const key in DEFAULTS) if (settings[key] !== DEFAULTS[key]) parameters.set(key, settings[key]);
    return parameters.toString().replace(/%2F/g, '/').replace(/%2C/g, ',').replace(/%21/g, '!').replace(/%3A/g, ':');
  }

  const settingValue = (key, raw) => typeof DEFAULTS[key] === 'string' ? raw : +raw;
  function sanitizeSetting(key, raw) {
    if (find(`[data-setting="${key}"][data-value="${CSS.escape(raw)}"]`)) return settingValue(key, raw);
    if (find(`[data-option="${key}"]`) && Number.isFinite(+raw)) return +raw ? 1 : 0;
    return DEFAULTS[key];
  }

  function parseEntry(token) {
    const [, key, turn = 0, tip = 0, roll = 0] = token.match(/^(.*?)(?:!(\d)(\d)(\d))?$/);
    let definition = catalogByKey.get(key);
    if (!definition && key.startsWith('custom:')) {
      const [, name, ...size] = key.split(':'), radius = +(size[3] ?? 0);
      if (size.length < 3 || size.length > 4 || !size.slice(0, 3).every(value => isPositive(+value)) || !(radius >= 0)) return null;
      try { definition = customDefinition(decodeURIComponent(name), ...size.slice(0, 3).map(Number), radius); } catch { return null; }
    }
    return definition ? { definition, turn: turn & 1, tip: tip & 1, roll: roll & 1 } : null;
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
    history.replaceState(null, '', query ? '?' + query : location.pathname);
    try { localStorage.setItem('visualCompare.last', query); } catch {}
    if (!rendered.length) setFitting(true);
    build();
    if (refit) fitCamera();
    renderResults(); renderTray(); renderInfo(); syncControls();
  }

  const UNIT_FACTORS = { mm: 1, cm: 10, m: 1000, in: 25.4, inch: 25.4, inches: 25.4, '"': 25.4, '″': 25.4, ft: 304.8, foot: 304.8, feet: 304.8, "'": 304.8, '′': 304.8 };
  const SIZE_PATTERN = /(\d*\.?\d+)\s*(mm|cm|m|inches|inch|in|feet|foot|ft|"|″|'|′)?/gi;

  // accepts "380 x 158 x 8 mm", "12in x 4.5in x 1.2in", "0.41 - 1.09 cm" (ranges keep the larger value); a bare number takes the next unit to its right
  function parseSize(text, fallbackUnit) {
    const cleaned = text.replace(/(\d),(\d)/g, '$1.$2')
      .replace(/(\d*\.?\d+)\s*(?:[a-z"″'′]+)?\s*[-–—]\s*(\d*\.?\d+)/gi, (match, low, high) => Math.max(+low, +high));
    const matches = [...cleaned.matchAll(SIZE_PATTERN)];
    if (matches.length !== 3) return null;
    const detectedUnit = matches.findLast(match => match[2])?.[2].toLowerCase();
    let unit = detectedUnit ?? fallbackUnit;
    const values = matches.toReversed().map(([, value, explicitUnit]) => {
      if (explicitUnit) unit = explicitUnit.toLowerCase();
      return +(value * UNIT_FACTORS[unit]).toFixed(2);
    }).toReversed();
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
  const describeSize = ({ shape, width, height, depth }, size = [width, height, depth]) =>
    shape === 'sphere' ? `Ø ${formatLength(width)}`
    : shape === 'cylinder' ? `Ø ${formatLength(width)} × ${formatLength(height)} tall`
    : shape === 'disc' ? `Ø ${formatLength(width)} × ${formatLength(depth)} thick`
    : formatDimensions(size);
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

  function computeVolume({ width, height, depth, radius, shape }) {
    if (shape === 'cylinder') return Math.PI * (width / 2) ** 2 * height;
    if (shape === 'disc') return Math.PI * (width / 2) ** 2 * depth;
    if (shape === 'sphere') return 4 / 3 * Math.PI * (width / 2) ** 3;
    return (width * height - (4 - Math.PI) * radius * radius) * depth;
  }

  const stage = find('#stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'labels';
  stage.prepend(renderer.domElement, labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x667085, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 4, 3);
  scene.add(sun);
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
  controls.addEventListener('change', requestRender);
  // the browser may drop the canvas while the tab is in the background
  document.addEventListener('visibilitychange', requestRender);
  renderer.domElement.addEventListener('webglcontextrestored', requestRender);
  renderer.setAnimationLoop(() => {
    if (!controls.update() && !renderPending) return;
    renderPending = false;
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  });

  function createGeometry({ width, height, depth, radius, shape }) {
    if (shape === 'cylinder') return new THREE.CylinderGeometry(width / 2, width / 2, height, 64);
    if (shape === 'disc') return new THREE.CylinderGeometry(width / 2, width / 2, depth, 64).rotateX(Math.PI / 2);
    if (shape === 'sphere') return new THREE.SphereGeometry(width / 2, 64, 32);
    radius = Math.min(radius, width / 2, height / 2);
    if (!radius) return new THREE.BoxGeometry(width, height, depth);
    const outline = new THREE.Shape(), left = -width / 2, bottom = -height / 2;
    outline.moveTo(left + radius, bottom);
    outline.absarc(left + width - radius, bottom + radius, radius, -Math.PI / 2, 0);
    outline.absarc(left + width - radius, bottom + height - radius, radius, 0, Math.PI / 2);
    outline.absarc(left + radius, bottom + height - radius, radius, Math.PI / 2, Math.PI);
    outline.absarc(left + radius, bottom + radius, radius, Math.PI, Math.PI * 1.5);
    return new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: false, curveSegments: 10 }).translate(0, 0, -depth / 2);
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
    const opacity = isNested ? Math.min(settings.opacity, .45) : settings.opacity;
    rendered = entries.map((entry, index) => {
      const { css: color, rgb } = objectColor(index), volume = computeVolume(entry.definition);
      const mesh = new THREE.Mesh(createGeometry(entry.definition), new THREE.MeshStandardMaterial({
        color: rgb, roughness: .5, metalness: .05, transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
        emissiveIntensity: .35, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      }));
      if (settings.edges) mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 20),
        new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: .35 })));
      mesh.rotation.set(entry.tip * Math.PI / 2, entry.turn * Math.PI / 2, entry.roll * Math.PI / 2, 'YXZ');
      mesh.userData = { index, volume };
      mesh.updateMatrixWorld();
      const bounds = new THREE.Box3().setFromObject(mesh);
      return { entry, index, color, rgb, volume, mesh, bounds, size: bounds.getSize(new THREE.Vector3()), labelElement: null };
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
        if (axis === arrangeAxis) { holder.position[axis] = cursor - min[axis]; cursor += item.size[axis] + spacing; }
        else holder.position[axis] = alignment[axis] === 'min' ? -min[axis] : alignment[axis] === 'max' ? -max[axis] : -(min[axis] + max[axis]) / 2;
      }
      if (settings.labels) {
        item.labelElement = document.createElement('div');
        item.labelElement.className = 'label';
        item.labelElement.style.setProperty('--color', item.color);
        item.labelElement.innerHTML = `<div><b>${escapeHtml(item.entry.definition.name)}</b><span>${describeSize(item.entry.definition, item.size.toArray())}</span></div>`;
        const label = new CSS2DObject(item.labelElement);
        if (isNested) { label.position.set(max.x, max.y, max.z); label.center.set(0, 1); }
        else if (isStacked) { label.position.set(max.x, (min.y + max.y) / 2, (min.z + max.z) / 2); label.center.set(0, .5); }
        else { label.position.set((min.x + max.x) / 2, max.y, (min.z + max.z) / 2); label.center.set(.5, 1); }
        holder.add(label);
      }
      world.add(holder);
    }
    clipToScene();
    highlightPicked();

    if (settings.grid) {
      const worldBounds = new THREE.Box3().setFromObject(world);
      const size = worldBounds.getSize(new THREE.Vector3()), center = worldBounds.getCenter(new THREE.Vector3());
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
  function fitCamera() {
    if (!fitting) return;
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
    // leave room for an open card: info on the left, popovers on the right
    const info = find('#info'), popover = find('.popover:not([hidden])');
    let padLeft = info.hidden ? 0 : info.offsetWidth + 28, padRight = popover ? popover.offsetWidth + 28 : 0;
    if (stage.clientWidth - padLeft - padRight < 240) padLeft = padRight = 0;
    const width = stage.clientWidth - padLeft - padRight, height = stage.clientHeight, labelRoom = settings.labels ? 70 : 20;
    let unitsPerPixel;
    if (settings.perspective) {
      const tangent = Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov / 2));
      const distance = Math.max(extent('x') * height / width, extent('y') * height / (height - labelRoom)) / 2 / tangent * 1.2 + extent('z') / 2;
      camera.position.copy(center).addScaledVector(direction, distance);
      unitsPerPixel = 2 * distance * tangent / height;
    } else {
      orthographicCamera.zoom = Math.min(width / extent('x'), (height - labelRoom) / extent('y')) * .85;
      unitsPerPixel = 1 / orthographicCamera.zoom;
    }
    camera.updateProjectionMatrix();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), shift = (padRight - padLeft) / 2 * unitsPerPixel;
    controls.target.copy(center).addScaledVector(right, shift);
    camera.position.addScaledVector(right, shift);
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
  }
  new ResizeObserver(resize).observe(stage);

  // a click (not a drag) picks the smallest object under the pointer, so nested ones stay reachable
  const raycaster = new THREE.Raycaster(), pointerDown = { x: 0, y: 0 };
  renderer.domElement.addEventListener('pointerdown', event => Object.assign(pointerDown, { x: event.clientX, y: event.clientY }));
  renderer.domElement.addEventListener('pointerup', event => {
    if (event.button !== 0 || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 4) return;
    const rectangle = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(
      (event.clientX - rectangle.left) / rectangle.width * 2 - 1,
      -(event.clientY - rectangle.top) / rectangle.height * 2 + 1), camera);
    const hits = raycaster.intersectObjects(world.children, true).filter(intersection => intersection.object.isMesh);
    const hit = hits.sort((first, second) => first.object.userData.volume - second.object.userData.volume)[0];
    pick(hit ? hit.object.userData.index : null);
  });

  function pick(index) {
    pickedIndex = pickedIndex === index ? null : index;
    highlightPicked();
    findAll('#selected .chip').forEach(chip => chip.classList.toggle('picked', +chip.dataset.index === pickedIndex));
    renderInfo();
  }

  function renderResults() {
    const words = find('#search').value.toLowerCase().split(/\s+/).filter(Boolean), category = find('#category').value;
    const selectedKeys = new Set(entries.map(entry => entry.definition.key));
    const matches = catalog.filter(definition => (!category || definition.category === category)
      && words.every(word => `${definition.name} ${definition.label}`.toLowerCase().includes(word)));
    find('#results').innerHTML = matches.map(definition => {
      const selected = selectedKeys.has(definition.key);
      return `<li><button data-key="${definition.key}" class="${selected ? 'selected' : ''}">
        <span><b>${escapeHtml(definition.name)}</b><small>${escapeHtml(definition.label)} · ${describeSize(definition)}</small></span>
        ${selected ? ICONS.check : ICONS.plus}</button></li>`;
    }).join('') || '<li class="none">No matches. Use + in the toolbar to add your own dimensions.</li>';
  }

  function renderTray() {
    find('#count').textContent = entries.length ? `${entries.length} in view` : '';
    find('#selected').innerHTML = rendered.map(item => `<li class="chip ${pickedIndex === item.index ? 'picked' : ''}" data-index="${item.index}" style="--color:${item.color}" draggable="true" title="Drag to reorder">
      <i></i><span><b>${escapeHtml(item.entry.definition.name)}</b><small>${describeSize(item.entry.definition, item.size.toArray())}</small></span>
      <button data-action="edit" title="Edit">${ICONS.pencil}</button><button data-action="turn" title="Turn 90°">${ICONS.turn}</button><button data-action="remove" title="Remove">${ICONS.close}</button></li>`).join('');
  }

  function renderInfo() {
    const item = rendered[pickedIndex], panel = find('#info');
    panel.hidden = !item;
    if (!item) return;
    const definition = item.entry.definition, [width, height, depth] = item.size.toArray();
    const comparisons = rendered.filter(other => other !== item)
      .map(other => `<li><span>vs ${escapeHtml(other.entry.definition.name)}</span><b>${formatRatio(item.volume / other.volume)}</b></li>`).join('');
    panel.style.setProperty('--color', item.color);
    panel.innerHTML = `<header><i></i><h3>${escapeHtml(definition.name)}</h3><button data-action="close" title="Close">${ICONS.close}</button></header>
      <dl>
        <dt>Category</dt><dd>${escapeHtml(definition.label)}</dd>
        <dt>Size (W × H × D)</dt><dd>${formatDimensions([width, height, depth])}</dd>
        <dt>Volume</dt><dd>${formatVolume(item.volume)}</dd>
        <dt>Front Area</dt><dd>${formatArea(width * height)}</dd>
        <dt>Footprint</dt><dd>${formatArea(width * depth)}</dd>
        ${definition.shape !== 'box' ? `<dt>Diameter</dt><dd>${formatLength(definition.width)}</dd>` : ''}
      </dl>
      ${comparisons ? `<ul class="comparisons">${comparisons}</ul>` : ''}
      <div class="actions">
        <button class="ghost" data-action="turn" title="Rotate around the vertical axis">Turn</button>
        <button class="ghost" data-action="tip" title="Tip over forwards">Tip</button>
        <button class="ghost" data-action="roll" title="Rotate in the front plane">Roll</button>
        <button class="ghost" data-action="edit" title="Change name or size">Edit</button>
        <button class="ghost remove" data-action="remove">Remove</button>
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
    if (action === 'close') pickedIndex = null;
    else entries[index][action] ^= 1;
    commit(action !== 'close');
  }

  function toggle(key) {
    const index = entries.findIndex(entry => entry.definition.key === key);
    if (index >= 0) { entries.splice(index, 1); pickedIndex = null; }
    else entries.push({ definition: catalogByKey.get(key), turn: 0, tip: 0, roll: 0 });
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
    const removed = entries.splice(start, count);
    pickedIndex = null;
    commit(true);
    toast(removed.length === 1 ? `Removed ${removed[0].definition.name}` : `Removed ${removed.length} objects`, () => {
      entries.splice(start, 0, ...removed);
      commit(true);
    });
  }

  const SESSIONS_STORAGE_KEY = 'visualCompare.sessions';
  const localSessions = {
    label: 'Saved in this browser only',
    read() { try { return JSON.parse(localStorage.getItem(SESSIONS_STORAGE_KEY)) || []; } catch { return []; } },
    write(list) {
      try { localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(list)); } catch { throw new Error('Browser storage is unavailable'); }
      return list;
    },
    async list() { return this.read(); },
    async save(session) { return this.write([{ ...session, savedAt: Date.now() }, ...this.read().filter(other => other.name !== session.name)]); },
    async rename(name, newName) {
      const list = this.read();
      if (list.some(session => session.name === newName)) throw new Error('A session with that name already exists');
      return this.write(list.map(session => session.name === name ? { ...session, name: newName } : session));
    },
    async remove(name) { return this.write(this.read().filter(session => session.name !== name)); },
  };
  const serverSessions = {
    label: 'Saved on the server, shared with everyone who uses it',
    async request(path = '', method = 'GET', body) {
      const response = await fetch('/api/sessions' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Server replied ${response.status}`);
      return response.json();
    },
    list() { return this.request(); },
    save(session) { return this.request('', 'POST', session); },
    rename(name, newName) { return this.request('/' + encodeURIComponent(name), 'PATCH', { name: newName }); },
    remove(name) { return this.request('/' + encodeURIComponent(name), 'DELETE'); },
  };
  let sessions = localSessions;
  if (location.protocol.startsWith('http')) { try { await serverSessions.list(); sessions = serverSessions; } catch {} }

  const sessionForm = find('#sessionForm'), sessionList = find('#sessionList');
  let sessionNames = new Set();

  const syncSessionButton = () => { sessionForm.elements.save.textContent = sessionNames.has(sessionForm.elements.name.value.trim()) ? 'Update' : 'Save'; };

  function renderSessions(list) {
    sessionNames = new Set(list.map(session => session.name));
    find('#sessionStore').textContent = sessions.label;
    sessionList.innerHTML = list.map(session => `<li data-name="${escapeHtml(session.name)}">
      <button class="load" data-action="load" title="Load"><b>${escapeHtml(session.name)}</b>
      <small>${session.count} object${session.count === 1 ? '' : 's'} · ${formatDate(session.savedAt)}</small></button>
      <button class="rename" data-action="rename" title="Rename">${ICONS.pencil}</button>
      <button class="delete" data-action="delete" title="Delete">${ICONS.close}</button></li>`).join('')
      || '<li class="none">No saved sessions yet.</li>';
    syncSessionButton();
  }
  const refreshSessions = async work => {
    try { renderSessions(await work()); } catch (error) { toast(error.message); }
  };

  sessionForm.addEventListener('input', syncSessionButton);
  sessionForm.addEventListener('submit', event => {
    event.preventDefault();
    const name = sessionForm.elements.name.value.trim();
    if (!name) return;
    refreshSessions(async () => {
      const list = await sessions.save({ name, query: toQuery(), count: entries.length });
      toast(`${sessionNames.has(name) ? 'Updated' : 'Saved'} “${name}”`);
      return list;
    });
  });

  function startRename(row, name) {
    const input = document.createElement('input');
    input.className = 'rename-field';
    input.value = name;
    row.querySelector('.load').replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      const newName = input.value.trim();
      if (!newName || newName === name) return refreshSessions(() => sessions.list());
      await refreshSessions(() => sessions.rename(name, newName));
      if (sessionForm.elements.name.value.trim() === name) sessionForm.elements.name.value = newName;
      syncSessionButton();
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
        if (!action.classList.contains('confirm')) { action.classList.add('confirm'); action.textContent = 'Delete?'; return; }
        return refreshSessions(() => sessions.remove(name));
      default: refreshSessions(async () => {
        const list = await sessions.list(), session = list.find(other => other.name === name);
        if (!session) throw new Error('That session no longer exists');
        fromQuery(session.query);
        commit(true);
        sessionForm.elements.name.value = name;
        toast(`Loaded “${session.name}”`);
        return list;
      });
    }
  });

  const customForm = find('#customForm');
  let editing = null;
  // auto: thinnest side becomes depth, largest becomes width, so slabs face the viewer
  function orient([first, second, third], order) {
    if (order === 'wdh') return [first, third, second];
    if (order === 'auto') { const [depth, height, width] = [first, second, third].sort((left, right) => left - right); return [width, height, depth]; }
    return [first, second, third];
  }
  function readCustomForm() {
    const fields = customForm.elements, size = parseSize(fields.size.value, fields.unit.value);
    if (!size) return null;
    const unit = size.detectedUnit ?? fields.unit.value;
    const radius = +((+fields.radius.value || 0) * UNIT_FACTORS[unit]).toFixed(2);
    return { ...size, values: orient(size.values, fields.order.value), unit: fields.unit.value, radius };
  }
  const validCustomSize = size => size && size.values.every(isPositive) && size.radius >= 0;
  const customFormDefinition = size => customDefinition(customForm.elements.name.value.trim() || 'Custom Object', ...size.values, size.radius);
  customForm.addEventListener('input', () => {
    const size = readCustomForm();
    find('#sizeHint').textContent = !customForm.elements.size.value.trim() ? '' : !size ? 'Enter three numbers, e.g. 380 x 158 x 8 mm'
      : `${formatDimensions(size.values)} W × H × D · ${size.detectedUnit ? `${size.detectedUnit} detected` : `${size.unit} assumed`}`;
    if (editing && validCustomSize(size)) { entries[editing.index].definition = customFormDefinition(size); commit(false); }
  });
  // editing turns any object into a custom one; changes preview live and revert on cancel
  function setEditing(state) {
    editing = state;
    find('#custom h3').textContent = editing ? 'Edit Object' : 'Add Object';
    customForm.elements.save.textContent = editing ? 'Save' : 'Add';
    customForm.elements.cancel.hidden = !editing;
  }
  customForm.elements.cancel.addEventListener('click', () => closePopovers());
  function startEditing(index) {
    const { definition } = entries[index], fields = customForm.elements;
    closePopovers();
    find('[data-popover="custom"]').click();
    setEditing({ index, original: definition });
    fields.name.value = definition.name;
    fields.size.value = `${[definition.width, definition.height, definition.depth].map(formatNumber).join(' x ')} mm`;
    fields.unit.value = 'mm';
    fields.order.value = 'whd';
    fields.radius.value = definition.radius || '';
    customForm.dispatchEvent(new Event('input'));
  }
  function cancelEditing() {
    entries[editing.index].definition = editing.original;
    setEditing(null);
    customForm.reset();
    find('#sizeHint').textContent = '';
    commit(false);
  }
  customForm.addEventListener('submit', event => {
    event.preventDefault();
    const size = readCustomForm();
    if (!validCustomSize(size)) return toast('Enter three positive numbers, e.g. 380 x 158 x 8 mm');
    if (editing) { entries[editing.index].definition = customFormDefinition(size); setEditing(null); customForm.reset(); closePopovers(); }
    else entries.push({ definition: customFormDefinition(size), turn: 0, tip: 0, roll: 0 });
    commit(true);
  });

  const categorySelect = find('#category');
  categorySelect.innerHTML = `<option value="">All Categories (${catalog.length})</option>` + Object.entries(CATEGORIES)
    .map(([key, category]) => `<option value="${key}">${escapeHtml(category.label)} (${category.items.length})</option>`).join('');
  find('#search').addEventListener('input', renderResults);
  categorySelect.addEventListener('change', renderResults);
  find('#results').addEventListener('click', event => {
    const button = event.target.closest('[data-key]');
    if (button) toggle(button.dataset.key);
  });

  const tray = find('#selected');
  tray.addEventListener('click', event => {
    const chip = event.target.closest('.chip'), action = event.target.closest('[data-action]');
    if (!chip) return;
    action ? applyAction(+chip.dataset.index, action.dataset.action) : pick(+chip.dataset.index);
  });
  tray.addEventListener('dblclick', event => {
    const chip = event.target.closest('.chip');
    if (chip && !event.target.closest('[data-action]')) startEditing(+chip.dataset.index);
  });
  let dragIndex = null;
  tray.addEventListener('dragstart', event => {
    dragIndex = +event.target.closest('.chip').dataset.index;
    event.dataTransfer.setData('text/plain', '');  // Firefox will not start a drag without data
  });
  tray.addEventListener('dragover', event => {
    const chip = event.target.closest('.chip');
    if (!chip || dragIndex === null) return;
    event.preventDefault();
    findAll('#selected .over').forEach(other => other.classList.remove('over'));
    chip.classList.add('over');
  });
  tray.addEventListener('dragend', () => { dragIndex = null; findAll('#selected .over').forEach(chip => chip.classList.remove('over')); });
  tray.addEventListener('drop', event => {
    const chip = event.target.closest('.chip');
    if (!chip || dragIndex === null) return;
    event.preventDefault();
    const picked = entries[pickedIndex], [moved] = entries.splice(dragIndex, 1);
    entries.splice(+chip.dataset.index, 0, moved);
    pickedIndex = picked ? entries.indexOf(picked) : null;
    settings.sort = 0;
    commit(true);
  });
  find('#info').addEventListener('click', event => {
    const action = event.target.closest('[data-action]');
    if (action) applyAction(pickedIndex, action.dataset.action);
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
  };
  findAll('[data-popover]').forEach(button => button.addEventListener('click', () => {
    const popover = find('#' + button.dataset.popover), opening = popover.hidden;
    closePopovers();
    popover.hidden = !opening;
    button.classList.toggle('active', opening);
    if (opening && popover.id === 'sessions') refreshSessions(() => sessions.list());
    if (opening && popover.id === 'custom') customForm.elements.name.focus();
    if (opening && popover.id === 'library') find('#search').focus();
  }));
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.popover, [data-popover]')) closePopovers(); });

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
      if (!box) continue;
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
  const arModules = matchMedia('(pointer: coarse)').matches && Promise.all([
    import('three/addons/exporters/GLTFExporter.js'), import('https://cdn.jsdelivr.net/npm/@google/model-viewer@4.1.0/dist/model-viewer.min.js')]);
  arButton.hidden = !arModules;
  arViewer.addEventListener('ar-status', ({ detail }) => {
    arViewer.classList.toggle('active', detail.status === 'session-started');
    if (detail.status === 'failed') toast('AR could not start');
  });
  arButton.addEventListener('click', async () => {
    if (!entries.length) return;
    try {
      const [{ GLTFExporter }] = await arModules;
      const copy = new THREE.Group();
      copy.scale.setScalar(.001);
      for (const holder of world.children) {
        const clone = holder.clone(), extras = [];
        clone.traverse(object => { if (object.isLineSegments || object.isCSS2DObject) extras.push(object); });
        extras.forEach(object => object.removeFromParent());
        copy.add(clone);
      }
      const glb = await new Promise((resolve, reject) => new GLTFExporter().parse(copy, resolve, reject, { binary: true }));
      URL.revokeObjectURL(arViewer.src);
      arViewer.src = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
      await new Promise(resolve => arViewer.addEventListener('load', resolve, { once: true }));
      if (arViewer.canActivateAR) arViewer.activateAR();
      else toast('AR is not available in this browser');
    } catch (error) {
      console.error(error);
      toast('AR could not start');
    }
  });
  find('#fullscreen').hidden = !document.fullscreenEnabled;
  find('#fullscreen').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : find('.main').requestFullscreen());
  document.addEventListener('fullscreenchange', () => find('#fullscreen').classList.toggle('active', !!document.fullscreenElement));
  const clearButton = find('#clear');
  let clearTimer;
  clearButton.addEventListener('click', () => {
    if (!entries.length) return;
    if (clearButton.classList.contains('confirm')) { clearButton.classList.remove('confirm'); return removeEntries(0, entries.length); }
    clearButton.classList.add('confirm');
    toast('Click the bin again to clear the scene');
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => clearButton.classList.remove('confirm'), 3000);
  });

  const forButton = (key, button) => [[key], button.title, () => button.click()];
  const forPicked = action => () => pickedIndex != null && applyAction(pickedIndex, action);
  const pickNext = offset => () => {
    const count = entries.length;
    if (!count) return false;
    const next = ((pickedIndex ?? (offset > 0 ? -1 : count)) + offset + count) % count;
    if (next !== pickedIndex) pick(next);
  };
  const help = find('#shortcuts');
  const toggleHelp = () => { const opening = help.hidden; closePopovers(); help.hidden = !opening; };
  // digits follow the toolbar order: views, then layouts; an action returning false leaves the key to the browser
  const SHORTCUTS = [
    ...[...findAll('.tools [data-setting]')].map((button, index) => forButton(String(index + 1), button)),
    forButton('f', fitButton),
    forButton('o', find('[data-popover="library"]')),
    forButton('a', find('[data-popover="custom"]')),
    forButton(',', find('[data-popover="settings"]')),
    [['ArrowLeft'], 'Select Previous Object', pickNext(-1)],
    [['ArrowRight'], 'Select Next Object', pickNext(1)],
    [['t'], 'Turn Selected', forPicked('turn')],
    [['e'], 'Edit Selected', forPicked('edit')],
    [['Delete', 'Backspace'], 'Remove Selected', forPicked('remove')],
    [['Escape'], 'Close or Deselect', () => find('.popover:not([hidden])') ? closePopovers() : forPicked('close')()],
    [['?'], 'Keyboard Shortcuts', toggleHelp],
  ];
  const KEY_NAMES = { ArrowLeft: '←', ArrowRight: '→', Delete: 'Del', Backspace: '⌫', Escape: 'Esc' };
  help.innerHTML = '<h3>Keyboard Shortcuts</h3><dl>' + SHORTCUTS.map(([keys, label]) =>
    `<dt>${keys.map(key => `<kbd>${KEY_NAMES[key] ?? key.toUpperCase()}</kbd>`).join(' ')}</dt><dd>${label}</dd>`).join('') + '</dl>';
  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest('input, select, textarea') && event.key !== 'Escape') return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const shortcut = SHORTCUTS.find(([keys]) => keys.includes(key));
    if (shortcut && shortcut[2]() !== false) event.preventDefault();
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
