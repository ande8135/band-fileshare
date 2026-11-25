import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { qk, trashQuery } from "../lib/queries";
import { ago, plural } from "../lib/format";
import type { TrashItem } from "../lib/types";
import { Button, EmptyState, PageHead, Person, SkeletonList, Tile, Time } from "../components/ui";
import { useFail, useToast } from "../components/Toast";

const pathOf = (n: TrashItem) => "/" + (n.ancestors ?? []).map((a) => a.name).join("/");

export function TrashPage() {
  const { data, error } = useQuery(trashQuery);
  const qc = useQueryClient();
  const toast = useToast();
  const fail = useFail();

  async function restore(n: TrashItem) {
    try {
      await api("POST", `/${n.type === "folder" ? "folders" : "files"}/${n.id}/restore`);
      toast(`Restored “${n.name}”`);
      await Promise.all([qc.invalidateQueries({ queryKey: qk.trash }), qc.invalidateQueries({ queryKey: qk.folder(n.parentId) })]);
    } catch (e) { fail(e); }
  }

  if (!data) {
    return error
      ? <EmptyState icon="alert" title="Couldn't load the trash" text={error.message} />
      : <><PageHead title="Trash" /><SkeletonList /></>;
  }
  const { items } = data;
  return (
    <>
      <PageHead title="Trash" sub={items.length ? `${plural(items.length, "item")} · nothing here is ever permanently deleted` : null} />
      {items.length ? (
        <div className="list trash">
          <div className="list-head" aria-hidden="true"><span>Name</span><span>Deleted</span><span>From</span><span>By</span><span /></div>
          {items.map((n) => (
            <div key={n.id} className="row-item static">
              <span className="cell-name">
                <Tile node={n} />
                <span className="name-wrap">
                  <span className="name">{n.name}</span>
                  <span className="sub">Deleted {ago(n.deletedAt)} · {pathOf(n)}</span>
                </span>
              </span>
              <span className="cell-meta"><Time value={n.deletedAt} /></span>
              <span className="cell-meta trunc">{pathOf(n)}</span>
              <span className="cell-meta"><Person name={n.deletedByName} email={n.deletedBy} /></span>
              <span className="cell-act show"><Button label="Restore" icon="restore" size="sm" onClick={() => restore(n)} /></span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon="trash" title="Trash is empty" text="Deleted files and folders show up here, and can always be restored." />
      )}
    </>
  );
}
