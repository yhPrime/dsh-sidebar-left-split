/**
 * 静态自检：不依赖浏览器。真实视觉（是否出现分隔线、滚动条是否出现）需要刷新页面后人工确认。
 * 运行：npm test
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (name) => readFileSync(join(root, name), 'utf8');
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

const pkg = JSON.parse(read('package.json'));
const clientSource = read('client.js');
const indexSource = read('index.js');
const patch = read('cordis.patch.yml');
const en = JSON.parse(read('locale/en.json'));
const zh = JSON.parse(read('locale/zh.json'));
const icon = read('icon.svg');

console.log('package manifest');
check('name matches module id', pkg.name === 'dsh-sidebar-left-split');
check('type module', pkg.type === 'module');
check('exports "."', pkg.exports['.'] === './index.js');
check('exports "./client"', pkg.exports['./client'] === './client.js');
check('bundle patch declared', pkg.dsh?.bundle?.patch === './cordis.patch.yml');
check('client platform web', pkg.dsh?.client?.platform === 'web');
check('client loads immediately', pkg.dsh?.client?.immediately === true);
check(
  'files lists every runtime file',
  ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg'].every((name) => pkg.files.includes(name)),
);

console.log('host half');
check('exports apply()', /export function apply\(\)/.test(indexSource));

console.log('bundle patch');
check('patch inserts our id', /id:\s*dsh-sidebar-left-split/.test(patch));
check('patch row uses package name', /name:\s*dsh-sidebar-left-split/.test(patch));

console.log('client half');
check('registers through the module loader', /window\.__ModuleLoader__\.load\(\{/.test(clientSource));
check('factory id equals package name', /id:\s*"dsh-sidebar-left-split"/.test(clientSource));
check('targets the workspace region by class suffix', clientSource.includes('_regionArea'));
check('targets the panel nav by class suffix', clientSource.includes('_panelList'));
check('panel nav becomes its own scroll port', /overflow-y:\s*auto/.test(clientSource));
check('only appears while overflowing (auto, not scroll)', !/overflow-y:\s*scroll/.test(clientSource));
check('workspace region keeps a minimum height', /REGION_MIN_PX\s*=\s*120/.test(clientSource));
check('magnetic floor is one row', /MIN_ROWS\s*=\s*1/.test(clientSource) && clientSource.includes('rowsForHeight'));
check('row grid is measured, not hardcoded', clientSource.includes('measureGrid') && clientSource.includes('rowHeight'));
check('dragging stops once every row is visible', clientSource.includes('scrollHeight'));
check('drag seam is hit-tested in pixels', /HIT_PX\s*=\s*5/.test(clientSource));
check('uses pointer events, not mouse-only ones', clientSource.includes('"pointerdown"') && clientSource.includes('"pointermove"'));
check('remembers a row count, not pixels', clientSource.includes('nav-rows') && clientSource.includes('localStorage.getItem'));
check('persists the row count', clientSource.includes('localStorage.setItem'));
check('double click restores the automatic height', clientSource.includes('"dblclick"'));
check('leaves the collapsed rail alone', clientSource.includes('_collapsed'));
check('measures the real column', clientSource.includes('ResizeObserver'));
check('rescans when the sidebar re-renders', clientSource.includes('MutationObserver'));
check('adds nothing to the sidebar DOM tree', (clientSource.match(/appendChild/g) ?? []).length === 1 && clientSource.includes('document.head.appendChild(tag)'));
check(
  'releases styles, listeners and observers on dispose',
  clientSource.includes('tag.remove()') && clientSource.includes('disconnect()') && clientSource.includes('removeEventListener'),
);
check('no hardcoded colours', !/#[0-9a-f]{3,8}\b/i.test(clientSource));
check('no inline script injection', !/innerHTML/.test(clientSource));
check('only theme tokens draw the seam', clientSource.includes('--dsw-alias-border-l1') && clientSource.includes('--dsw-alias-border-l2'));

console.log('display metadata');
check('en title', typeof en.meta?.title === 'string' && en.meta.title.length > 0);
check('en description', typeof en.meta?.description === 'string' && en.meta.description.length > 0);
check('zh title', typeof zh.meta?.title === 'string' && zh.meta.title.length > 0);
check('zh description', typeof zh.meta?.description === 'string' && zh.meta.description.length > 0);
check('zh mentions the workspace seam', zh.meta.description.includes('工作区'));
check('icon is svg with viewBox', icon.trimStart().startsWith('<svg') && icon.includes('viewBox='));
check('icon uses currentColor, not fixed colours', icon.includes('currentColor') && !/#[0-9a-f]{3,8}\b/i.test(icon));
check('icon under 256 KiB', statSync(join(root, 'icon.svg')).size <= 256 * 1024);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
