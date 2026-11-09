/**
 * dsh-sidebar-left-split — 客户端半（Client half）。
 *
 * 左侧栏（DSH 原生 sidebar）是上下两段：上面是全局面板列表（一行一个面板，
 * 末尾常驻「更多」），下面是「工作区」浏览区（会话树，自己内部滚动）。
 * 面板列表的高度由内容决定、不可调；窗口一矮，「工作区」就被压缩到几乎看不见，
 * 而面板列表还可能撑出列底。
 *
 * 这个客户端半只做一件事：把两段之间的交接变成可拖动的分隔条。
 *  - 交接处悬浮时出现一条细分隔线 + 上下拖动光标；按住上下拖动即调整「工作区」
 *    的高度（默认恢复：双击交接处回到「按内容自适应」）。
 *  - 被拖动的一方是上面那段：它一旦被压小，`overflow-y: auto` 会自己长出滚动条，
 *    行不会被裁掉；滚动条外观沿用宿主（dsh-client-ui-theme 已给全站
 *    `::-webkit-scrollbar` 定了宽度与主题色，这里不另设颜色）。
 *  - 高度记在 localStorage，刷新后保持；窗口变矮时自动回收到「工作区」的最小高度。
 *
 * 不插入任何子节点（React 管着这棵树的 children），只用标记属性 + 变量驱动样式，
 * 因此上游重渲染不会把分隔条冲掉。选择器只依赖上游 CSS Module 的类名后缀
 * （`_regionArea` / `_panelList`）与结构位置，不依赖哈希前缀。
 */
window.__ModuleLoader__.load({
  id: "dsh-sidebar-left-split",
  factory: () => {
    /** 与 package.json 的 name 一致（模块 id 与样式归属标记）。 */
    const PACKAGE_ID = "dsh-sidebar-left-split";
    /** 「工作区」浏览区：左上面板列表的下一段。 */
    const REGION_SELECTOR = '[class*="_regionArea"]';
    /** 全局面板列表（`<nav>`）的类名后缀。 */
    const NAV_CLASS_FRAGMENT = "_panelList";
    /** 交接处的吸附半径（像素）：在这个范围内按下才算抓住分隔条。 */
    const HIT_PX = 5;
    /** 面板列表可以被压到的最小高度（一行左右，再小也能滚）。 */
    const NAV_MIN_PX = 28;
    /** 「工作区」保留的最小高度。 */
    const REGION_MIN_PX = 120;
    /** 面板内容随会话与面板变化反复挂载，扫描做节流。 */
    const SCAN_DELAY_MS = 120;
    /** 拖动期间吞掉交接处按钮的 click，避免误触搜索/筛选。 */
    const SWALLOW_CLICK_MS = 0;
    /** 存拖动结果（像素整数）。 */
    const STORAGE_KEY = "dsh-sidebar-left-split:nav-height";
    /** 面板列表高度变量，由样式表消费。 */
    const HEIGHT_VAR = "--dsh-split-nav";
    /** 列根上的标记：本插件接管了这一列。 */
    const ROOT_ATTR = "data-dsh-sidebar-split";
    /** 列根上的标记：交接处被悬浮。 */
    const HOVER_ATTR = "data-dsh-split-hover";
    /** 列根上的标记：正在拖动交接。 */
    const DRAG_ATTR = "data-dsh-split-drag";
    /** 列根上的标记：侧栏处于收起的窄轨形态（此时不接管高度）。 */
    const RAIL_ATTR = "data-dsh-split-rail";

    const CSS = `
body [${ROOT_ATTR}] > nav[class*="${NAV_CLASS_FRAGMENT}"] {
  box-sizing: border-box;
  flex: 0 0 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}
body [${ROOT_ATTR}]:not([${RAIL_ATTR}]) > nav[class*="${NAV_CLASS_FRAGMENT}"] {
  height: var(${HEIGHT_VAR}, auto);
}
body [${ROOT_ATTR}] > ${REGION_SELECTOR} {
  box-sizing: border-box;
  position: relative;
  flex: 1 1 0;
  min-height: 0;
}
body [${ROOT_ATTR}] > ${REGION_SELECTOR}::before {
  content: "";
  position: absolute;
  z-index: 2;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--dsw-alias-border-l1);
  opacity: 0;
  transition: opacity .12s var(--ds-ease-in-out, ease), height .12s var(--ds-ease-in-out, ease);
  pointer-events: none;
}
body [${ROOT_ATTR}][${HOVER_ATTR}] > ${REGION_SELECTOR}::before,
body [${ROOT_ATTR}][${DRAG_ATTR}] > ${REGION_SELECTOR}::before {
  height: 2px;
  opacity: 1;
  background: var(--dsw-alias-border-l2);
}
body [${ROOT_ATTR}][${HOVER_ATTR}] > ${REGION_SELECTOR},
body [${ROOT_ATTR}][${DRAG_ATTR}] > ${REGION_SELECTOR} {
  cursor: row-resize;
}
body [${ROOT_ATTR}][${DRAG_ATTR}] {
  -webkit-user-select: none;
  user-select: none;
}
`;

    /** 读出上次拖动的高度；读不到或不可用就返回 null（= 按内容自适应）。 */
    function readStoredHeight() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null) return null;
        const value = Number(raw);
        if (!Number.isFinite(value) || value <= 0) return null;
        return value;
      } catch {
        return null;
      }
    }

    /** 记下高度；null 表示清掉记忆。存储不可用（隐私模式）时静默跳过。 */
    function writeStoredHeight(value) {
      try {
        if (value === null) window.localStorage.removeItem(STORAGE_KEY);
        else window.localStorage.setItem(STORAGE_KEY, String(Math.round(value)));
      } catch {
        /* 存储被禁用：本次会话内仍然有效 */
      }
    }

    /** 收起成窄轨时上游会给列根加上 `*_collapsed`；哈希前缀不稳定，按后缀判断。 */
    function isRail(root) {
      const list = root.classList;
      if (list === undefined || list === null) return false;
      for (let index = 0; index < list.length; index += 1) {
        if (String(list[index]).endsWith("_collapsed")) return true;
      }
      return false;
    }

    /** 列根直接子节点里的全局面板列表（`<nav>`）；没有就不接管。 */
    function findNav(region) {
      const root = region.parentElement;
      if (root === null) return null;
      for (const child of root.children) {
        if (child === region) continue;
        const className = typeof child.className === "string" ? child.className : "";
        if (child.tagName === "NAV" && className.includes(NAV_CLASS_FRAGMENT)) return child;
      }
      return null;
    }

    return {
      inject: [],
      apply(ctx) {
        // 样式表：随插件卸载自动移除。
        ctx.effect(() => {
          const tag = document.createElement("style");
          tag.setAttribute("data-plugin-css", PACKAGE_ID);
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => tag.remove();
        }, PACKAGE_ID + ": stylesheet");

        // 分隔条本体：扫描列 → 标记 → 指针手势 → 记忆高度。
        ctx.effect(() => {
          /** 已接管的列根 → { root, region, nav, observer, navHeight, applying } */
          const tracked = new Map();
          let scanTimer = null;
          let mutationObserver = null;
          /** 正在拖动时的现场；同一时刻只可能有一个。 */
          let dragging = null;

          const setAttr = (element, name) => {
            if (element.getAttribute(name) === "") return;
            element.setAttribute(name, "");
          };
          const clearAttr = (element, name) => {
            if (element.getAttribute(name) === null) return;
            element.removeAttribute(name);
          };

          /** 把 record.navHeight 写到列根变量上；null 表示交还给 CSS 的 auto。 */
          const applyHeight = (record) => {
            if (record.navHeight === null) record.root.style.removeProperty(HEIGHT_VAR);
            else record.root.style.setProperty(HEIGHT_VAR, `${Math.round(record.navHeight)}px`);
          };

          /**
           * 把面板列表设到 candidate 像素，并在「工作区」被压破下限时回退。
           * 用实测高度回退而不是算其它兄弟节点的高度：顶栏/品牌行随平台与
           * windows-titlebar 变高变矮，算出来的上限经常是错的。
           */
          const resizeNav = (record, candidate) => {
            if (record.nav === null) return;
            let next = Math.max(NAV_MIN_PX, Math.round(candidate));
            record.navHeight = next;
            applyHeight(record);
            const regionHeight = record.region.getBoundingClientRect().height;
            if (regionHeight < REGION_MIN_PX) {
              next = Math.max(NAV_MIN_PX, next - Math.ceil(REGION_MIN_PX - regionHeight));
              record.navHeight = next;
              applyHeight(record);
            }
            return next;
          };

          const clearHover = (record) => {
            clearAttr(record.root, HOVER_ATTR);
          };

          const clearDragMark = (record) => {
            clearAttr(record.root, DRAG_ATTR);
          };

          /** 拖动结束后收拾监听器；click 用宏任务再摘，保证本轮点击已被吞掉。 */
          const endDrag = () => {
            if (dragging === null) return;
            const record = dragging.record;
            dragging = null;
            clearDragMark(record);
            clearHover(record);
            document.removeEventListener("pointermove", onDragMove, true);
            document.removeEventListener("pointerup", onDragEnd, true);
            document.removeEventListener("pointercancel", onDragEnd, true);
            if (typeof window.setTimeout === "function") {
              window.setTimeout(() => document.removeEventListener("click", swallowClick, true), SWALLOW_CLICK_MS);
            }
          };

          const onDragMove = (event) => {
            if (dragging === null) return;
            const delta = event.clientY - dragging.startY;
            resizeNav(dragging.record, dragging.startHeight + delta);
            event.preventDefault();
          };

          const onDragEnd = () => {
            if (dragging === null) return;
            writeStoredHeight(dragging.record.navHeight);
            endDrag();
          };

          const swallowClick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            endDrag();
          };

          /** 交接线的当前纵坐标（取「工作区」段的上边缘）。 */
          const seamY = (record) => record.region.getBoundingClientRect().top;

          const onPointerMove = (event) => {
            const record = tracked.get(event.currentTarget);
            if (record === undefined) return;
            if (dragging !== null) return;
            if (record.nav === null || isRail(record.root)) {
              clearHover(record);
              return;
            }
            if (Math.abs(event.clientY - seamY(record)) <= HIT_PX) setAttr(record.root, HOVER_ATTR);
            else clearHover(record);
          };

          const onPointerLeave = (event) => {
            const record = tracked.get(event.currentTarget);
            if (record === undefined) return;
            clearHover(record);
          };

          const onPointerDown = (event) => {
            const record = tracked.get(event.currentTarget);
            if (record === undefined) return;
            if (event.button !== undefined && event.button !== 0) return;
            if (record.nav === null || isRail(record.root)) return;
            if (Math.abs(event.clientY - seamY(record)) > HIT_PX) return;
            event.preventDefault();
            event.stopPropagation();
            const startHeight = record.nav === null
              ? null
              : (record.navHeight === null
                ? record.nav.getBoundingClientRect().height
                : record.navHeight);
            if (startHeight === null) return;
            dragging = { record, startY: event.clientY, startHeight };
            setAttr(record.root, DRAG_ATTR);
            setAttr(record.root, HOVER_ATTR);
            document.addEventListener("pointermove", onDragMove, true);
            document.addEventListener("pointerup", onDragEnd, true);
            document.addEventListener("pointercancel", onDragEnd, true);
            document.addEventListener("click", swallowClick, true);
          };

          const onDoubleClick = (event) => {
            const record = tracked.get(event.currentTarget);
            if (record === undefined) return;
            if (record.nav === null || isRail(record.root)) return;
            if (Math.abs(event.clientY - seamY(record)) > HIT_PX) return;
            event.preventDefault();
            event.stopPropagation();
            record.navHeight = null;
            applyHeight(record);
            writeStoredHeight(null);
          };

          /** 重新确认交接对象、窄轨状态与记忆高度；上游重渲染后调用。 */
          const refresh = (record) => {
            const region = record.region;
            if (!region.isConnected) return;
            record.nav = findNav(region);
            setAttr(record.root, ROOT_ATTR);
            if (isRail(record.root)) setAttr(record.root, RAIL_ATTR);
            else clearAttr(record.root, RAIL_ATTR);
            if (record.navHeight === null) applyHeight(record);
            else resizeNav(record, record.navHeight);
          };

          const untrack = (record) => {
            const { root } = record;
            tracked.delete(root);
            root.removeEventListener("pointermove", onPointerMove);
            root.removeEventListener("pointerleave", onPointerLeave);
            root.removeEventListener("pointerdown", onPointerDown);
            root.removeEventListener("dblclick", onDoubleClick);
            if (record.observer !== null) record.observer.disconnect();
            if (dragging !== null && dragging.record === record) endDrag();
            clearAttr(root, ROOT_ATTR);
            clearAttr(root, HOVER_ATTR);
            clearAttr(root, DRAG_ATTR);
            clearAttr(root, RAIL_ATTR);
            root.style.removeProperty(HEIGHT_VAR);
          };

          const track = (root, region) => {
            const record = {
              root,
              region,
              nav: null,
              navHeight: readStoredHeight(),
              applying: false,
              observer: null,
            };
            if (typeof ResizeObserver === "function") {
              record.observer = new ResizeObserver(() => {
                if (record.applying) return;
                if (dragging !== null && dragging.record === record) return;
                if (record.navHeight === null) return;
                record.applying = true;
                try {
                  resizeNav(record, record.navHeight);
                } finally {
                  record.applying = false;
                }
              });
              record.observer.observe(root);
            }
            root.addEventListener("pointermove", onPointerMove);
            root.addEventListener("pointerleave", onPointerLeave);
            root.addEventListener("pointerdown", onPointerDown);
            root.addEventListener("dblclick", onDoubleClick);
            tracked.set(root, record);
            refresh(record);
          };

          const scan = () => {
            const region = document.querySelector(REGION_SELECTOR);
            const root = region === null ? null : region.parentElement;
            for (const record of [...tracked.values()]) {
              if (!record.root.isConnected || !record.region.isConnected || record.root !== root) untrack(record);
            }
            if (root === null) return;
            const existing = tracked.get(root);
            if (existing === undefined) track(root, region);
            else {
              existing.region = region;
              refresh(existing);
            }
          };

          const scheduleScan = () => {
            if (scanTimer !== null) return;
            scanTimer = window.setTimeout(() => {
              scanTimer = null;
              scan();
            }, SCAN_DELAY_MS);
          };

          mutationObserver = new MutationObserver(scheduleScan);
          mutationObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class"],
          });
          scan();

          return () => {
            if (scanTimer !== null) window.clearTimeout(scanTimer);
            mutationObserver.disconnect();
            for (const record of [...tracked.values()]) untrack(record);
          };
        }, PACKAGE_ID + ": splitter");
      },
    };
  },
});
