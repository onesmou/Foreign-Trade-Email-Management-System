"use client";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Group, Panel, Separator, useGroupRef } from "react-resizable-panels";
import { Maximize2, Minimize2, RotateCcw, GripVertical } from "lucide-react";
import {
  CUSTOMER_PANES,
  DEFAULT_CUSTOMER_LAYOUT,
  PANE_LABELS,
  parseCustomerLayout,
  responsiveCustomerLayout,
  type CustomerPane,
  type CustomerLayout,
  type ColumnMode,
} from "../lib/customer-layout";

type ContextValue = {
  focus: CustomerPane | null;
  mode: ColumnMode;
  visible: CustomerLayout;
  toggle: (pane: CustomerPane, trigger: HTMLElement) => void;
  reset: () => void;
};
const ColumnsContext = createContext<ContextValue | null>(null);
function useColumns() {
  const context = useContext(ColumnsContext);
  if (!context) throw new Error("分栏控件必须位于客户工作区内");
  return context;
}
function subscribeViewport(callback: () => void) {
  const desktop = matchMedia("(min-width: 1101px)"),
    tablet = matchMedia("(min-width: 761px)");
  desktop.addEventListener("change", callback);
  tablet.addEventListener("change", callback);
  return () => {
    desktop.removeEventListener("change", callback);
    tablet.removeEventListener("change", callback);
  };
}
function viewportMode(): ColumnMode {
  return matchMedia("(min-width: 1101px)").matches
    ? "desktop"
    : matchMedia("(min-width: 761px)").matches
      ? "tablet"
      : "phone";
}
const serverMode = (): ColumnMode => "desktop";

export default function CustomerColumns({
  children,
  hasCustomer,
  mobilePane,
  focus,
  onFocusChange,
  userKey,
}: {
  children: ReactNode;
  hasCustomer: boolean;
  mobilePane: string;
  focus: CustomerPane | null;
  onFocusChange: (pane: CustomerPane | null) => void;
  userKey: string;
}) {
  const mode = useSyncExternalStore(
      subscribeViewport,
      viewportMode,
      serverMode,
    ),
    group = useGroupRef(),
    root = useRef<HTMLDivElement>(null),
    lastDesktop = useRef<CustomerLayout>(DEFAULT_CUSTOMER_LAYOUT),
    loadedKey = useRef(""),
    returnFocus = useRef<HTMLElement | null>(null);
  const storageKey = `crm.customer-columns.v1:${userKey}`;
  function save(layout: CustomerLayout) {
    lastDesktop.current = layout;
    try {
      localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {
      /* Layout still works when browser storage is disabled. */
    }
  }
  function restore() {
    onFocusChange(null);
    requestAnimationFrame(() => returnFocus.current?.focus());
  }
  function toggle(pane: CustomerPane, trigger: HTMLElement) {
    if (focus === pane) restore();
    else {
      returnFocus.current = trigger;
      onFocusChange(pane);
    }
  }
  function reset() {
    save({ ...DEFAULT_CUSTOMER_LAYOUT });
    group.current?.setLayout(
      responsiveCustomerLayout(
        mode,
        hasCustomer,
        mobilePane,
        DEFAULT_CUSTOMER_LAYOUT,
      ),
    );
    if (focus) restore();
  }
  useLayoutEffect(() => {
    if (loadedKey.current !== storageKey) {
      let saved: CustomerLayout | null = null;
      try {
        saved = parseCustomerLayout(localStorage.getItem(storageKey));
      } catch {}
      lastDesktop.current = saved || { ...DEFAULT_CUSTOMER_LAYOUT };
      loadedKey.current = storageKey;
    }
    group.current?.setLayout(
      responsiveCustomerLayout(
        mode,
        hasCustomer,
        mobilePane,
        lastDesktop.current,
      ),
    );
  }, [storageKey, mode, hasCustomer, mobilePane, group]);
  useLayoutEffect(() => {
    if (!focus) return;
    const app = root.current?.closest(".crm-v2"),
      elements = app
        ? Array.from(
            app.querySelectorAll<HTMLElement>(
              ".v2-sidebar,.v2-topbar,.v2-preview-banner",
            ),
          )
        : [];
    const previous = elements.map((element) => ({
        element,
        inert: element.inert,
      })),
      overflow = document.body.style.overflow;
    elements.forEach((element) => {
      element.inert = true;
    });
    document.body.style.overflow = "hidden";
    return () => {
      previous.forEach(({ element, inert }) => {
        element.inert = inert;
      });
      document.body.style.overflow = overflow;
    };
  }, [focus]);
  useEffect(() => {
    if (!focus) return;
    function escape(event: KeyboardEvent) {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector(".v2-dialog-backdrop,.modal-backdrop")
      )
        return;
      event.preventDefault();
      onFocusChange(null);
      requestAnimationFrame(() => returnFocus.current?.focus());
    }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [focus, onFocusChange]);
  const visible = responsiveCustomerLayout(
    mode,
    hasCustomer,
    mobilePane,
    DEFAULT_CUSTOMER_LAYOUT,
  );
  return (
    <ColumnsContext.Provider value={{ focus, mode, visible, toggle, reset }}>
      <div
        ref={root}
        className={`v2-workspace v2-resizable-workspace ${hasCustomer ? "has-customer" : ""} pane-${mobilePane} ${focus ? "has-focused-pane" : ""}`}
        data-layout-mode={mode}
        data-focused-pane={focus || undefined}
      >
        <Group
          id="crm-customer-columns"
          groupRef={group}
          className="v2-columns-group"
          orientation="horizontal"
          style={{ height: "100%", width: "100%" }}
          disabled={mode !== "desktop" || Boolean(focus)}
          resizeTargetMinimumSize={{ fine: 10, coarse: 24 }}
          defaultLayout={responsiveCustomerLayout(
            mode,
            hasCustomer,
            mobilePane,
            DEFAULT_CUSTOMER_LAYOUT,
          )}
          onLayoutChanged={(layout, meta) => {
            if (mode === "desktop" && !focus && meta.isUserInteraction) {
              const parsed = parseCustomerLayout(
                meta.requestedLayout || layout,
              );
              if (parsed) save(parsed);
            }
          }}
        >
          {children}
        </Group>
        {focus && (
          <div
            className="v2-pane-focusbar"
            role="toolbar"
            aria-label="分栏全屏工具栏"
          >
            <strong>
              {PANE_LABELS[focus]} <small>全屏 · Esc 退出</small>
            </strong>
            <nav aria-label="切换全屏分栏">
              {CUSTOMER_PANES.map((pane) => (
                <button
                  key={pane}
                  type="button"
                  aria-pressed={focus === pane}
                  onClick={() => onFocusChange(pane)}
                >
                  {pane === "customers"
                    ? "全部客户"
                    : pane === "detail"
                      ? "客户信息"
                      : "AI 助手"}
                </button>
              ))}
            </nav>
            <button
              type="button"
              className="v2-focus-reset"
              title="恢复默认分栏宽度"
              aria-label="恢复默认分栏宽度"
              onClick={reset}
            >
              <RotateCcw size={15} />
            </button>
            <button
              type="button"
              className="v2-focus-restore"
              onClick={restore}
            >
              <Minimize2 size={15} />
              退出全屏
            </button>
          </div>
        )}
      </div>
    </ColumnsContext.Provider>
  );
}
export function CustomerColumn({
  id,
  children,
}: {
  id: CustomerPane;
  children: ReactNode;
}) {
  const { focus, mode, visible } = useColumns(),
    focused = focus === id,
    hidden = focus ? !focused : visible[id] === 0;
  return (
    <Panel
      id={id}
      minSize={
        mode === "desktop"
          ? { customers: "180px", detail: "260px", ai: "280px" }[id]
          : "0%"
      }
      collapsible={mode !== "desktop"}
      collapsedSize="0%"
      className={`v2-column-frame column-${id}`}
      style={{ overflow: "hidden" }}
    >
      <div
        className={`v2-column-surface ${focused ? "is-focused" : ""} ${hidden ? "is-hidden" : ""}`}
        inert={hidden}
        aria-label={PANE_LABELS[id]}
      >
        {children}
      </div>
    </Panel>
  );
}
export function CustomerColumnSeparator({
  id,
  label,
}: {
  id: string;
  label: string;
}) {
  const { focus, mode, reset } = useColumns();
  return (
    <Separator
      id={id}
      className="v2-column-separator"
      disabled={mode !== "desktop" || Boolean(focus)}
      aria-label={label}
      title="拖动调整两侧宽度；双击恢复默认布局。也可用左右方向键调整。"
      onDoubleClick={reset}
      style={mode !== "desktop" ? { display: "none" } : undefined}
    >
      <GripVertical size={12} />
    </Separator>
  );
}
export function PaneExpandButton({ pane }: { pane: CustomerPane }) {
  const { focus, toggle } = useColumns(),
    expanded = focus === pane,
    label = expanded
      ? `退出全屏：${PANE_LABELS[pane]}`
      : `全屏显示${PANE_LABELS[pane]}`;
  return (
    <button
      type="button"
      className="v2-pane-toggle"
      aria-label={label}
      title={label}
      aria-pressed={expanded}
      onClick={(event) => toggle(pane, event.currentTarget)}
    >
      {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
    </button>
  );
}
