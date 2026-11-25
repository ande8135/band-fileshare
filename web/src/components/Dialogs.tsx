// In-app dialogs (no native alert/confirm/prompt). confirm() and prompt() return promises.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { Button } from "./ui";

export function Modal({ title, size, onClose, actions, children }: {
  title: string;
  size?: "sm";
  onClose: () => void;
  actions?: (close: () => void) => ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
  }, []);
  const close = () => ref.current?.close();
  return (
    <dialog ref={ref} className={`modal ${size ?? ""}`} onClose={onClose}
      onMouseDown={(e) => { if (e.target === ref.current) close(); }}>
      <div className="modal-inner">
        <div className="modal-head">
          <h2>{title}</h2>
          <Button icon="x" title="Close" onClick={close} />
        </div>
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-foot">{actions(close)}</div>}
      </div>
    </dialog>
  );
}

type ConfirmOpts = { title?: string; ok?: string; danger?: boolean };
type PromptOpts = { title: string; label: string; value?: string; ok?: string; placeholder?: string; hint?: string; selectBase?: boolean };
interface DialogApi {
  confirm: (message: string, opts?: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
  /** Mount any dialog; it gets a `done` callback to unmount itself. */
  show: (make: (done: () => void) => ReactElement) => void;
}

const Ctx = createContext<DialogApi | null>(null);
export const useDialogs = () => useContext(Ctx)!;

let seq = 0;

export function DialogProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<{ id: number; el: ReactElement }[]>([]);

  const show = useCallback<DialogApi["show"]>((make) => {
    const id = ++seq;
    const done = () => setEntries((es) => es.filter((e) => e.id !== id));
    setEntries((es) => [...es, { id, el: make(done) }]);
  }, []);

  const confirm = useCallback<DialogApi["confirm"]>((message, opts = {}) => new Promise((resolve) => {
    show((done) => <ConfirmDialog message={message} {...opts} onDone={(ok) => { done(); resolve(ok); }} />);
  }), [show]);

  const prompt = useCallback<DialogApi["prompt"]>((opts) => new Promise((resolve) => {
    show((done) => <PromptDialog {...opts} onDone={(v) => { done(); resolve(v); }} />);
  }), [show]);

  return (
    <Ctx.Provider value={{ confirm, prompt, show }}>
      {children}
      {entries.map((e) => <span key={e.id}>{e.el}</span>)}
    </Ctx.Provider>
  );
}

function ConfirmDialog({ message, title = "Are you sure?", ok = "Confirm", danger, onDone }: ConfirmOpts & { message: string; onDone: (ok: boolean) => void }) {
  const result = useRef(false);
  return (
    <Modal title={title} size="sm" onClose={() => onDone(result.current)}
      actions={(close) => <>
        <Button label="Cancel" onClick={close} />
        <Button label={ok} kind={danger ? "danger-solid" : "primary"} autoFocus onClick={() => { result.current = true; close(); }} />
      </>}>
      <p className="lead">{message}</p>
    </Modal>
  );
}

function PromptDialog({ title, label, value = "", ok = "Save", placeholder, hint, selectBase, onDone }: PromptOpts & { onDone: (v: string | null) => void }) {
  const [text, setText] = useState(value);
  const result = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const el = input.current!;
    el.focus();
    // For file names, pre-select only the part before the extension, like Finder.
    const dot = selectBase ? value.lastIndexOf(".") : -1;
    if (dot > 0) el.setSelectionRange(0, dot); else el.select();
  }, [selectBase, value]);
  const submit = (e: FormEvent, close: () => void) => {
    e.preventDefault();
    if (!text.trim()) return;
    result.current = text.trim();
    close();
  };
  return (
    <Modal title={title} size="sm" onClose={() => onDone(result.current)}
      actions={(close) => <>
        <Button label="Cancel" onClick={close} />
        <Button label={ok} kind="primary" onClick={() => form.current?.requestSubmit()} />
      </>}>
      <CloseCapture>{(close) => (
        <form ref={form} onSubmit={(e) => submit(e, close)}>
          <label className="field">
            <span>{label}</span>
            <input ref={input} className="input" value={text} placeholder={placeholder} maxLength={255} aria-label={label}
              onChange={(e) => setText(e.target.value)} />
          </label>
          {hint && <p className="hint">{hint}</p>}
        </form>
      )}</CloseCapture>
    </Modal>
  );
}

/** Gives body content access to its enclosing <dialog>'s close(). */
function CloseCapture({ children }: { children: (close: () => void) => ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  return <span ref={ref} style={{ display: "contents" }}>{children(() => ref.current?.closest("dialog")?.close())}</span>;
}
