/**
 * 行为自检（无浏览器）：用最小 DOM 替身跑客户端半的扫描 / 磁吸拖动 / 记忆 / 卸载。
 * 运行：node test/client.test.mjs
 *
 * 布局模型是唯一真值：面板列表由 5 行按钮组成（每行 36px、行距 2px、自然高 188px），
 * 列顶偏移 100、列底固定段 60、列高可变，工作区取剩余高度。
 * 替身据此算 getBoundingClientRect / scrollHeight，于是「拖动按整行跳 → 最小一行 →
 * 全显示到顶 → 矮窗回收」这条链能离线走完。
 */
let failed = 0;
let passed = 0;
function check(name, condition) {
  if (condition) {
    passed += 1;
    console.log('  ok  ' + name);
  } else {
    failed += 1;
    console.log('  FAIL ' + name);
  }
}

const NAV_VAR = '--dsh-split-nav';
const layout = {
  topOffset: 100,
  rootHeight: 800,
  foot: 60,
  navGap: 8, // 面板列表的 margin-bottom
  rowHeight: 36,
  rowGap: 2,
  rowCount: 5,
  navHeight: null, // 由 CSS 变量驱动；null = 内容自然高度
};
const naturalNav = () =>
  layout.rowCount * layout.rowHeight + Math.max(0, layout.rowCount - 1) * layout.rowGap;
const navHeightNow = () => (layout.navHeight === null ? naturalNav() : layout.navHeight);

class FakeStyle {
  constructor() {
    this.props = {};
  }
  setProperty(name, value) {
    this.props[name] = value;
    if (name === NAV_VAR) layout.navHeight = Number.parseFloat(value);
  }
  removeProperty(name) {
    delete this.props[name];
    if (name === NAV_VAR) layout.navHeight = null;
  }
  getPropertyValue(name) {
    return this.props[name] ?? '';
  }
}

class FakeElement {
  constructor(tag, className = '') {
    this.tagName = tag.toUpperCase();
    this.className = className;
    this.classList = className === '' ? [] : className.split(' ');
    this.style = new FakeStyle();
    this.attributes = {};
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
    this.listeners = new Map();
    this.role = 'plain';
    this.rowIndex = 0;
    this.scrollTop = 0;
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  addClass(name) {
    if (this.classList.includes(name)) return;
    this.classList.push(name);
    this.className = this.classList.join(' ');
  }
  addEventListener(type, handler) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(handler);
    this.listeners.set(type, set);
  }
  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }
  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  remove() {
    this.isConnected = false;
    const index = this.parentElement?.children.indexOf(this) ?? -1;
    if (index >= 0) this.parentElement.children.splice(index, 1);
  }
  get scrollHeight() {
    if (this.role === 'nav') return naturalNav();
    return 0;
  }
  get clientHeight() {
    if (this.role === 'nav') return Math.min(navHeightNow(), naturalNav());
    return 0;
  }
  getBoundingClientRect() {
    if (this.role === 'row') {
      const top = layout.topOffset + this.rowIndex * (layout.rowHeight + layout.rowGap);
      return { top, height: layout.rowHeight };
    }
    if (this.role === 'nav') return { top: layout.topOffset, height: navHeightNow() };
    if (this.role === 'region') {
      const top = layout.topOffset + navHeightNow() + layout.navGap;
      return { top, height: Math.max(0, layout.rootHeight - top - layout.foot) };
    }
    return { top: layout.topOffset, height: layout.rootHeight };
  }
  dispatch(type, event = {}) {
    const payload = {
      currentTarget: this,
      target: this,
      clientY: 0,
      clientX: 0,
      button: 0,
      deltaY: 0,
      defaultPrevented: false,
      ...event,
    };
    payload.preventDefault = () => {
      payload.defaultPrevented = true;
    };
    payload.stopPropagation = () => {};
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler(payload);
    return payload;
  }
}

const documentListeners = new Map();
const head = new FakeElement('head');
const documentElement = new FakeElement('html');
const view = { region: null };

const documentStub = {
  head,
  documentElement,
  createElement: (tag) => new FakeElement(tag),
  querySelector: (selector) => (selector.includes('_regionArea') ? view.region : null),
  addEventListener(type, handler) {
    const set = documentListeners.get(type) ?? new Set();
    set.add(handler);
    documentListeners.set(type, set);
  },
  removeEventListener(type, handler) {
    documentListeners.get(type)?.delete(handler);
  },
};
documentStub.dispatch = (type, event = {}) => {
  const payload = {
    currentTarget: documentStub,
    target: documentStub,
    clientY: 0,
    button: 0,
    preventDefault() {},
    stopPropagation() {},
    ...event,
  };
  for (const handler of [...(documentListeners.get(type) ?? [])]) handler(payload);
  return payload;
};
documentStub.listenerCount = (type) => documentListeners.get(type)?.size ?? 0;

const storage = new Map();
const localStorageStub = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = new Set();
    this.disconnected = false;
    FakeResizeObserver.instances.push(this);
  }
  observe(target) {
    this.targets.add(target);
  }
  unobserve(target) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
    this.disconnected = true;
  }
  trigger() {
    this.callback([]);
  }
}
FakeResizeObserver.instances = [];

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    FakeMutationObserver.last = this;
  }
  observe() {}
  disconnect() {
    this.disconnected = true;
  }
  trigger() {
    this.callback([]);
  }
}
FakeMutationObserver.last = null;

const windowStub = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  localStorage: localStorageStub,
};
let registered = null;
windowStub.__ModuleLoader__ = {
  load: (definition) => {
    registered = definition;
  },
};
windowStub.window = windowStub;

globalThis.window = windowStub;
globalThis.document = documentStub;
globalThis.ResizeObserver = FakeResizeObserver;
globalThis.MutationObserver = FakeMutationObserver;
globalThis.localStorage = localStorageStub;

await import('../client.js');

const STORAGE_KEY = 'dsh-sidebar-left-split:nav-rows';
const LEGACY_KEY = 'dsh-sidebar-left-split:nav-height';
const ROOT_ATTR = 'data-dsh-sidebar-split';
const HOVER_ATTR = 'data-dsh-split-hover';
const DRAG_ATTR = 'data-dsh-split-drag';
const RAIL_ATTR = 'data-dsh-split-rail';

/** 搭一棵与宿主同构的列：根 > nav(5 行按钮) + region(工作区)。 */
function buildColumn() {
  const root = new FakeElement('div', 'wtg9ga_root');
  root.role = 'root';
  const nav = new FakeElement('nav', 'wtg9ga_panelList');
  nav.role = 'nav';
  for (let index = 0; index < layout.rowCount; index += 1) {
    const row = new FakeElement('button');
    row.role = 'row';
    row.rowIndex = index;
    nav.appendChild(row);
  }
  const region = new FakeElement('div', 'wtg9ga_regionArea');
  region.role = 'region';
  root.appendChild(nav);
  root.appendChild(region);
  view.region = region;
  return { root, nav, region };
}

/** 让排队的扫描跑完（插件用 120ms 节流）。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));
const seamOf = (region) => region.getBoundingClientRect().top;

console.log('module registration');
check('loader called once', registered !== null);
check('factory id is the package name', registered?.id === 'dsh-sidebar-left-split');
check('factory is callable', typeof registered?.factory === 'function');

const plugin = registered.factory();
check('module exposes apply', typeof plugin.apply === 'function');
check('module injects nothing', Array.isArray(plugin.inject) && plugin.inject.length === 0);

console.log('apply');
const disposers = [];
const ctx = {
  effect: (fn) => {
    const dispose = fn();
    if (typeof dispose === 'function') disposers.push(dispose);
  },
};
storage.set(LEGACY_KEY, '200'); // 旧版本留下的像素值，不该被当成行数
const column = buildColumn();
plugin.apply(ctx);
check('registers two effects', disposers.length === 2);
check('legacy pixel key is dropped', storage.has(LEGACY_KEY) === false);

const styleTag = head.children.find((child) => child.attributes['data-plugin-css'] === 'dsh-sidebar-left-split');
check('appends the scoped stylesheet', styleTag !== undefined);
check('stylesheet scopes to the column marker', styleTag.textContent.includes('[' + ROOT_ATTR + ']'));
check('panel list scrolls only when needed', styleTag.textContent.includes('overflow-y: auto'));
check('seam is drawn with theme tokens', styleTag.textContent.includes('--dsw-alias-border-l1'));
check('rail mode skips the height override', styleTag.textContent.includes(':not([' + RAIL_ATTR + '])'));

console.log('scan');
check('marks the column it took over', column.root.getAttribute(ROOT_ATTR) === '');
check('expanded column is not marked as rail', column.root.getAttribute(RAIL_ATTR) === null);
check('no height is imposed before the first drag', column.root.style.getPropertyValue(NAV_VAR) === '');
check('every gesture is listened for', ['pointermove', 'pointerleave', 'pointerdown', 'dblclick'].every((type) => column.root.listenerCount(type) === 1));

console.log('hover');
const seam = seamOf(column.region);
check('natural nav height is the whole row stack', Math.abs(seam - (layout.topOffset + naturalNav() + layout.navGap)) < 0.001);
column.root.dispatch('pointermove', { clientY: seam });
check('hovering the seam raises the divider', column.root.getAttribute(HOVER_ATTR) === '');
column.root.dispatch('pointermove', { clientY: seam + 60 });
check('leaving the seam clears the divider', column.root.getAttribute(HOVER_ATTR) === null);
column.root.dispatch('pointermove', { clientY: seam });
column.root.dispatch('pointerleave', {});
check('leaving the column clears the divider', column.root.getAttribute(HOVER_ATTR) === null);

console.log('magnetic drag');
column.root.dispatch('pointerdown', { clientY: seam });
check('pressing the seam starts a drag', column.root.getAttribute(DRAG_ATTR) === '');
check('drag listens on the document', documentStub.listenerCount('pointermove') === 1 && documentStub.listenerCount('pointerup') === 1);

// 往上拖 60px：188 → 128，磁吸到第 3 行（3×36 + 2×2 = 112）
documentStub.dispatch('pointermove', { clientY: seam - 60 });
check('dragging up snaps to whole rows', column.root.style.getPropertyValue(NAV_VAR) === '112px');
check('three rows are exactly 3×36 + 2×2', layout.navHeight === 112);
check('the workspace took the freed space', column.region.getBoundingClientRect().height === 520);

// 中间位置也吸回整行：往上 70px（188 → 118）离第 3 行更近，仍吸到 112
documentStub.dispatch('pointermove', { clientY: seam - 70 });
check('a half-row offset still snaps back', column.root.style.getPropertyValue(NAV_VAR) === '112px');

// 往下拖回 172px：吸到第 5 行 = 全部显示（188px，等于内容总高，不出滚动条）
documentStub.dispatch('pointermove', { clientY: seam + 60 });
check('dragging down grows the list', layout.navHeight === 188);
check('all rows visible equals the content height', column.root.style.getPropertyValue(NAV_VAR) === '188px');

// 再往下拖：已经到顶，不允许再长
documentStub.dispatch('pointermove', { clientY: seam + 260 });
check('cannot drag past the last row', column.root.style.getPropertyValue(NAV_VAR) === '188px');
check('and the workspace is not squeezed further', column.region.getBoundingClientRect().height === 444);
documentStub.dispatch('pointerup', {});
check('drop remembers the full row count', storage.get(STORAGE_KEY) === '5');

console.log('squeeze');
layout.rootHeight = 400;
const observer = FakeResizeObserver.instances.at(-1);
check('resize observer watches the column', observer.targets.has(column.root));
observer.trigger();
check('a short window reclaims the workspace minimum', column.region.getBoundingClientRect().height === 120);
check('and the nav pays in whole rows', column.root.style.getPropertyValue(NAV_VAR) === '112px');

console.log('magnetic scroll');
// 现在面板列表 112px、内容 188px → 可滚 76px，步长 38px（一行）
const nav = column.nav;
const wheel = (deltaY) => nav.dispatch('wheel', { deltaY });
const firstWheel = wheel(100);
check('one wheel notch moves exactly one row', nav.scrollTop === 38);
check('wheel is taken over while the list scrolls', firstWheel.defaultPrevented === true);
wheel(100);
check('second notch reaches the bottom', nav.scrollTop === 76);
wheel(100);
check('scrolling stops at the last row', nav.scrollTop === 76);
wheel(-100);
check('wheel up returns one row', nav.scrollTop === 38);
wheel(5);
check('a tiny trackpad step is buffered', nav.scrollTop === 38);
wheel(20);
check('buffered steps then jump one row', nav.scrollTop === 76);
nav.scrollTop = 50;
nav.dispatch('scroll');
await new Promise((resolve) => setTimeout(resolve, 220));
check('a scrollbar drag snaps back to the nearest row', nav.scrollTop === 38);

console.log('floor');
layout.rootHeight = 800;
const floorSeam = seamOf(column.region);
column.root.dispatch('pointerdown', { clientY: floorSeam });
documentStub.dispatch('pointermove', { clientY: floorSeam - 600 });
check('one row is the floor', column.root.style.getPropertyValue(NAV_VAR) === '36px');
documentStub.dispatch('pointermove', { clientY: floorSeam - 2000 });
check('dragging further up keeps one row', column.root.style.getPropertyValue(NAV_VAR) === '36px');
documentStub.dispatch('pointerup', {});
check('drop ends the drag', column.root.getAttribute(DRAG_ATTR) === null);
check('drop remembers the row count', storage.get(STORAGE_KEY) === '1');
check('document listeners are released', documentStub.listenerCount('pointermove') === 0);

console.log('reset');
const resetSeam = seamOf(column.region);
column.root.dispatch('dblclick', { clientY: resetSeam });
check('double click restores the automatic height', column.root.style.getPropertyValue(NAV_VAR) === '');
check('double click forgets the row count', storage.has(STORAGE_KEY) === false);
column.root.dispatch('dblclick', { clientY: resetSeam + 80 });
check('double click away from the seam does nothing', column.root.style.getPropertyValue(NAV_VAR) === '');
const freeWheel = nav.dispatch('wheel', { deltaY: 100 });
check('wheel is left alone when every row fits', freeWheel.defaultPrevented === false);

console.log('collapsed rail');
column.root.addClass('wtg9ga_collapsed');
FakeMutationObserver.last.trigger();
await settle();
check('the rail is marked', column.root.getAttribute(RAIL_ATTR) === '');
column.root.dispatch('pointermove', { clientY: seamOf(column.region) });
check('the seam does not react in the rail', column.root.getAttribute(HOVER_ATTR) === null);
column.root.dispatch('pointerdown', { clientY: seamOf(column.region) });
check('the rail cannot start a drag', column.root.getAttribute(DRAG_ATTR) === null);

console.log('remount');
const second = buildColumn();
FakeMutationObserver.last.trigger();
await settle();
check('the new column is taken over', second.root.getAttribute(ROOT_ATTR) === '');
check('the old column is released', column.root.getAttribute(ROOT_ATTR) === null);
check('the old column keeps no inline height', column.root.style.getPropertyValue(NAV_VAR) === '');

console.log('stored rows restore');
storage.set(STORAGE_KEY, '2');
const third = buildColumn();
FakeMutationObserver.last.trigger();
await settle();
check('a remembered row count is re-applied', third.root.style.getPropertyValue(NAV_VAR) === '74px');
check('two rows are 2×36 + 2', layout.navHeight === 74);
check('the new panel list keeps its scroll snap', third.nav.listenerCount('wheel') === 1 && third.nav.listenerCount('scroll') === 1);

console.log('dispose');
for (const dispose of disposers) dispose();
check('stylesheet removed', styleTag.isConnected === false);
check('mutation observer disconnected', FakeMutationObserver.last.disconnected === true);
check('resize observers disconnected', FakeResizeObserver.instances.every((instance) => instance.disconnected === true));
check('markers removed', third.root.getAttribute(ROOT_ATTR) === null && third.root.getAttribute(RAIL_ATTR) === null);
check('inline height removed', third.root.style.getPropertyValue(NAV_VAR) === '');
check('gesture listeners removed', ['pointermove', 'pointerleave', 'pointerdown', 'dblclick'].every((type) => third.root.listenerCount(type) === 0));
check('scroll snap listeners removed', third.nav.listenerCount('wheel') === 0 && third.nav.listenerCount('scroll') === 0);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
