// Mutations shared by rows, menus and the details panel. Each one calls the API, then
// invalidates exactly the cached queries it affected.
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { qk } from "./queries";
import { extOf } from "./format";
import { usePanel } from "./panel";
import type { AnyNode, FileNode, FolderNode } from "./types";
import { useDialogs } from "../components/Dialogs";
import { useFail, useToast } from "../components/Toast";
import { MoveDialog } from "../components/MoveDialog";

const plural = (n: Pick<AnyNode, "type">) => (n.type === "folder" ? "folders" : "files");

export function useActions() {
  const qc = useQueryClient();
  const dialogs = useDialogs();
  const toast = useToast();
  const fail = useFail();
  const panel = usePanel();

  /** A folder change rewrites the paths of everything under it, so drop every cached listing. */
  const afterTreeChange = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "folder" || q.queryKey[0] === "file" });

  async function newFolder(parentId: string) {
    const name = await dialogs.prompt({ title: "New folder", label: "Name", placeholder: "Untitled folder", ok: "Create" });
    if (!name) return;
    try {
      await api("POST", "/folders", { name, parentId });
      toast(`Created “${name}”`);
      await qc.invalidateQueries({ queryKey: qk.folder(parentId) });
    } catch (e) { fail(e); }
  }

  async function rename(node: AnyNode) {
    const isFile = node.type === "file";
    const name = await dialogs.prompt({ title: isFile ? "Rename file" : "Rename folder", label: "Name", value: node.name, ok: "Rename", selectBase: isFile });
    if (!name || name === node.name) return;
    const [from, to] = [extOf(node.name), extOf(name)];
    if (isFile && from !== to && !await dialogs.confirm(
      to ? `Change the extension from “.${from || "none"}” to “.${to}”? The file may open differently.`
        : `Remove the “.${from}” extension? The file may not open correctly.`,
      { title: "Change file extension?", ok: "Change it" })) return;
    try {
      const updated = await api<AnyNode>("POST", `/${plural(node)}/${node.id}/rename`, { name });
      toast(`Renamed to “${updated.name}”`);
      if (isFile) {
        await Promise.all([qc.invalidateQueries({ queryKey: qk.folder(node.parentId) }), qc.invalidateQueries({ queryKey: qk.file(node.id) })]);
      } else {
        await afterTreeChange();
      }
    } catch (e) { fail(e); }
  }

  async function move(node: Pick<AnyNode, "id" | "type" | "name" | "parentId">, targetId: string) {
    if (node.parentId === targetId || node.id === targetId) return;
    try {
      await api("POST", `/${plural(node)}/${node.id}/move`, { parentId: targetId });
      toast(`Moved “${node.name}”`);
      if (node.type === "folder") await afterTreeChange();
      else {
        if (panel.openId === node.id) panel.close();
        await Promise.all([node.parentId, targetId].map((id) => qc.invalidateQueries({ queryKey: qk.folder(id) })));
        qc.removeQueries({ queryKey: qk.file(node.id) });
      }
    } catch (e) { fail(e); }
  }

  const openMove = (node: AnyNode) => dialogs.show((done) => <MoveDialog node={node} onDone={done} onMove={(target) => move(node, target)} />);

  async function trashFile(file: FileNode) {
    if (!await dialogs.confirm(`“${file.name}” and its versions will move to the trash. You can restore it later.`,
      { title: "Move file to trash?", ok: "Move to trash", danger: true })) return;
    try {
      await api("DELETE", `/files/${file.id}`);
      if (panel.openId === file.id) panel.close();
      toast("Moved to trash");
      await Promise.all([qc.invalidateQueries({ queryKey: qk.folder(file.parentId) }), qc.invalidateQueries({ queryKey: qk.trash })]);
    } catch (e) { fail(e); }
  }

  async function trashFolder(folder: FolderNode) {
    if (!await dialogs.confirm(`“${folder.name}” will move to the trash. Folders must be empty first.`,
      { title: "Move folder to trash?", ok: "Move to trash", danger: true })) return;
    try {
      await api("DELETE", `/folders/${folder.id}`);
      toast("Moved to trash");
      await Promise.all([qc.invalidateQueries({ queryKey: qk.folder(folder.parentId) }), qc.invalidateQueries({ queryKey: qk.trash })]);
    } catch (e) { fail(e); }
  }

  async function download(fileId: string, version: number) {
    try {
      const { url } = await api<{ url: string }>("GET", `/files/${fileId}/versions/${version}/download`);
      location.assign(url);
    } catch (e) { fail(e); }
  }

  return { newFolder, rename, move, openMove, trashFile, trashFolder, download };
}
