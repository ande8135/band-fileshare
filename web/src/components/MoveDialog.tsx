import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { folderQuery, usePrefetchFolder } from "../lib/queries";
import type { AnyNode } from "../lib/types";
import { Modal } from "./Dialogs";
import { Button, Tile } from "./ui";
import { Icon } from "./Icon";

/** Folder picker for "Move to folder…". A folder can't be moved into itself, so it's never listed. */
export function MoveDialog({ node, onDone, onMove }: { node: AnyNode; onDone: () => void; onMove: (targetId: string) => void }) {
  const from = node.parentId ?? "root";
  const [at, setAt] = useState(from);
  const { data, isFetching } = useQuery(folderQuery(at));
  const prefetch = usePrefetchFolder();
  const choices = data?.folders.filter((f) => f.id !== node.id) ?? [];
  return (
    <Modal title={`Move “${node.name}”`} onClose={onDone}
      actions={(close) => <>
        <Button label="Cancel" onClick={close} />
        <Button label="Move here" kind="primary" disabled={!data || at === from} onClick={() => { close(); onMove(at); }} />
      </>}>
      <nav className="picker-crumbs">
        <a onClick={() => setAt("root")}>Files</a>
        {data?.breadcrumbs.map((c) => (
          <span key={c.id} style={{ display: "contents" }}>
            <Icon name="chevron" className="sep" />
            <a onClick={() => setAt(c.id)}>{c.name}</a>
          </span>
        ))}
      </nav>
      <div className={`picker-list${isFetching && !data ? " loading" : ""}`}>
        {choices.map((f) => (
          <button key={f.id} className="picker-item" onClick={() => setAt(f.id)} onPointerOver={() => prefetch(f.id)}>
            <Tile node={f} size="sm" />
            <span>{f.name}</span>
            <Icon name="chevron" className="go" />
          </button>
        ))}
        {data && !choices.length && <p className="hint pad">No subfolders here.</p>}
      </div>
    </Modal>
  );
}
