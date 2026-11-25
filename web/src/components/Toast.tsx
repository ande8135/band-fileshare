import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

type ToastFn = (message: string, kind?: "" | "error") => void;
const Ctx = createContext<ToastFn>(() => {});

export const useToast = () => useContext(Ctx);

/** toast.error(e) helper for catch blocks. */
export function useFail() {
  const toast = useToast();
  return useCallback((e: unknown) => toast(e instanceof Error ? e.message : String(e), "error"), [toast]);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ msg: string; kind: string; show: boolean }>({ msg: "", kind: "", show: false });
  const timer = useRef<number | undefined>(undefined);
  const toast = useCallback<ToastFn>((msg, kind = "") => {
    setState({ msg, kind, show: true });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState((s) => ({ ...s, show: false })), 3500);
  }, []);
  return (
    <Ctx.Provider value={toast}>
      {children}
      <div id="toast" role="status" aria-live="polite" className={state.show ? `show ${state.kind}` : ""}>
        {state.msg && <Icon name={state.kind === "error" ? "alert" : "check"} />}
        <span>{state.msg}</span>
      </div>
    </Ctx.Provider>
  );
}
