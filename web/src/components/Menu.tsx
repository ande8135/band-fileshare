import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";

export type MenuItem = { label: string; icon?: IconName; danger?: boolean; onClick: () => void } | "-";
type OpenMenu = (anchor: HTMLElement, items: MenuItem[]) => void;

const Ctx = createContext<OpenMenu>(() => {});
export const useMenu = () => useContext(Ctx);

export function MenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<{ anchor: HTMLElement; items: MenuItem[] } | null>(null);
  const open = useCallback<OpenMenu>((anchor, items) => setMenu({ anchor, items }), []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {menu && <MenuPopover {...menu} onClose={() => setMenu(null)} />}
    </Ctx.Provider>
  );
}

function MenuPopover({ anchor, items, onClose }: { anchor: HTMLElement; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    const m = ref.current!;
    const r = anchor.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.right - m.offsetWidth), innerWidth - m.offsetWidth - 8);
    const top = r.bottom + 6 + m.offsetHeight > innerHeight - 8 ? r.top - m.offsetHeight - 6 : r.bottom + 6;
    setPos({ left, top: Math.max(8, top) });
    m.querySelector("button")?.focus({ preventScroll: true });
  }, [anchor]);

  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    addEventListener("resize", onClose);
    document.getElementById("main")?.addEventListener("scroll", onClose, { passive: true });
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key, true);
      removeEventListener("resize", onClose);
      document.getElementById("main")?.removeEventListener("scroll", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="menu" role="menu" style={pos}>
      {items.map((it, i) =>
        it === "-" ? <div key={i} className="menu-sep" /> : (
          <button key={i} role="menuitem" className={`menu-item${it.danger ? " danger" : ""}`} onClick={() => { onClose(); it.onClick(); }}>
            {it.icon && <Icon name={it.icon} />}
            <span>{it.label}</span>
          </button>
        ))}
    </div>,
    document.body,
  );
}
