// Upload queue (3 at a time) with a progress tray. New files: POST /files -> PUT to S3 -> complete.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, putFile } from "../lib/api";
import { qk } from "../lib/queries";
import type { FileNode } from "../lib/types";
import { Button, Tile } from "./ui";
import { Icon } from "./Icon";

type Item = { id: number; name: string; p: number; state: "queued" | "up" | "done" | "error"; msg?: string };
interface UploadsApi {
  uploadFiles: (files: File[], parentId: string) => Promise<void>;
  uploadVersion: (file: FileNode, chosen: File, note: string) => Promise<boolean>;
}
const Ctx = createContext<UploadsApi | null>(null);
export const useUploads = () => useContext(Ctx)!;

let seq = 0;

export function UploadsProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const patch = (id: number, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const track = useCallback((name: string) => {
    const id = ++seq;
    setItems((xs) => [...xs, { id, name, p: 0, state: "queued" }]);
    return {
      progress: (p: number) => patch(id, { p, state: "up" }),
      done: () => patch(id, { p: 1, state: "done" }),
      fail: (e: unknown) => patch(id, { state: "error", msg: e instanceof Error ? e.message : String(e) }),
    };
  }, []);

  const uploadFiles = useCallback(async (files: File[], parentId: string) => {
    const queue = [...files];
    const one = async (file: File) => {
      const ui = track(file.name);
      try {
        const contentType = file.type || "application/octet-stream";
        const r = await api<{ file: { id: string }; version: number; uploadUrl: string; contentType: string }>(
          "POST", "/files", { name: file.name, parentId, contentType, size: file.size });
        await putFile(r.uploadUrl, file, r.contentType, ui.progress);
        await api("POST", `/files/${r.file.id}/versions/${r.version}/complete`);
        ui.done();
      } catch (e) { ui.fail(e); }
    };
    const worker = async () => { for (let f = queue.shift(); f; f = queue.shift()) await one(f); };
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
    await qc.invalidateQueries({ queryKey: qk.folder(parentId) });
  }, [qc, track]);

  const uploadVersion = useCallback(async (file: FileNode, chosen: File, note: string) => {
    const ui = track(`${chosen.name} → v${(file.currentVersion ?? 0) + 1}`);
    try {
      const contentType = chosen.type || "application/octet-stream";
      const r = await api<{ version: number; uploadUrl: string; contentType: string }>(
        "POST", `/files/${file.id}/versions`, { contentType, fileName: chosen.name, size: chosen.size, note });
      await putFile(r.uploadUrl, chosen, r.contentType, ui.progress);
      await api("POST", `/files/${file.id}/versions/${r.version}/complete`);
      ui.done();
      await Promise.all([qc.invalidateQueries({ queryKey: qk.file(file.id) }), qc.invalidateQueries({ queryKey: qk.folder(file.parentId) })]);
      return true;
    } catch (e) { ui.fail(e); return false; }
  }, [qc, track]);

  return (
    <Ctx.Provider value={{ uploadFiles, uploadVersion }}>
      {children}
      <Tray items={items} clear={() => setItems([])} />
    </Ctx.Provider>
  );
}

function Tray({ items, clear }: { items: Item[]; clear: () => void }) {
  const active = items.filter((i) => i.state === "queued" || i.state === "up").length;
  const allDone = items.length > 0 && items.every((i) => i.state === "done");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    clearTimeout(timer.current);
    if (allDone) timer.current = window.setTimeout(clear, 4000);
    return () => clearTimeout(timer.current);
  }, [allDone, clear]);
  if (!items.length) return null;
  return (
    <div id="tray">
      <div className="tray-head">
        <strong>{active ? `Uploading ${active} file${active > 1 ? "s" : ""}…` : "Uploads complete"}</strong>
        {!active && <Button icon="x" title="Dismiss" onClick={clear} />}
      </div>
      <div className="tray-list">
        {items.map((i) => (
          <div key={i.id} className={`tray-item ${i.state}`}>
            <Tile node={{ type: "file", name: i.name }} size="sm" />
            <div className="tray-main">
              <span className="name">{i.name}</span>
              {i.state === "error" ? <span className="err">{i.msg}</span>
                : <span className="bar"><span style={{ width: `${Math.round(i.p * 100)}%` }} /></span>}
            </div>
            {i.state === "done" ? <Icon name="check" className="ok" />
              : i.state === "error" ? <Icon name="alert" className="bad" />
                : <span className="pct">{Math.round(i.p * 100)}%</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
