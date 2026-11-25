import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { folderQuery, usePrefetchFolder } from "../lib/queries";
import { folderHref } from "../lib/route";
import { fmtSize, ago, plural } from "../lib/format";
import { useActions } from "../lib/actions";
import { dragProps, useDropTarget } from "../lib/dnd";
import { usePanel } from "../lib/panel";
import type { Ancestor, FileNode, FolderNode } from "../lib/types";
import { Button, EmptyState, PageHead, Person, SkeletonList, Tile, Time } from "../components/ui";
import { useMenu, type MenuItem } from "../components/Menu";
import { useUploads } from "../components/Uploads";
import { Icon } from "../components/Icon";

export function FilesPage({ folderId }: { folderId: string }) {
  const { data, error, isPending } = useQuery(folderQuery(folderId));
  const actions = useActions();
  const openMenu = useMenu();
  const uploads = useUploads();
  const [filter, setFilter] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);

  // "/" focuses the filter.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "/" || /INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName ?? "")) return;
      if (document.querySelector("dialog[open]") || !search.current) return;
      e.preventDefault();
      search.current.focus();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);

  const upload = () => picker.current?.click();
  const fileInput = (
    <input ref={picker} type="file" multiple hidden
      onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; if (fs.length) void uploads.uploadFiles(fs, folderId); }} />
  );

  if (isPending && !data) return <><PageHead title={<span className="sk sk-title" />} /><SkeletonList /></>;
  if (!data) {
    return <EmptyState icon="alert" title="Couldn't load this folder" text={error instanceof Error ? error.message : "Please try again."} />;
  }

  const count = data.folders.length + data.files.length;
  const q = filter.trim().toLowerCase();
  const folders = q ? data.folders.filter((f) => f.name.toLowerCase().includes(q)) : data.folders;
  const files = q ? data.files.filter((f) => f.name.toLowerCase().includes(q)) : data.files;
  const folderMenu = (f: FolderNode): MenuItem[] => [
    { label: "Rename…", icon: "edit", onClick: () => actions.rename(f) },
    { label: "Move to folder…", icon: "folderMove", onClick: () => actions.openMove(f) },
    "-",
    { label: "Move to trash", icon: "trash", danger: true, onClick: () => actions.trashFolder(f) },
  ];
  const crumbs = data.folder
    ? [{ id: "root", name: "Files" }, ...data.breadcrumbs.slice(0, -1)].map((c) => <Crumb key={c.id} c={c} />)
    : [];
  const sub = count ? [data.folders.length ? plural(data.folders.length, "folder") : "", data.files.length ? plural(data.files.length, "file") : ""].filter(Boolean).join(" · ") : null;

  return (
    <>
      {fileInput}
      <PageHead crumbs={crumbs} title={data.folder?.name ?? "Files"} sub={sub} actions={<>
        {count > 0 && (
          <label className="search">
            <Icon name="search" />
            <input ref={search} type="search" placeholder="Filter" aria-label="Filter this folder" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <kbd>/</kbd>
          </label>
        )}
        {data.folder && <Button icon="more" title="Folder actions" onClick={(e) => openMenu(e.currentTarget, folderMenu(data.folder!))} />}
        <Button label="New folder" icon="folderPlus" onClick={() => actions.newFolder(folderId)} />
        <Button label="Upload" icon="upload" kind="primary" onClick={upload} />
      </>} />

      {count ? (
        <div className="list">
          <div className="list-head" aria-hidden="true"><span>Name</span><span>Modified</span><span>Size</span><span>Owner</span><span /></div>
          {folders.map((f) => <FolderRow key={f.id} f={f} menu={folderMenu(f)} />)}
          {files.map((f) => <FileRow key={f.id} f={f} />)}
          {q && !folders.length && !files.length && <p className="no-match">No matches in this folder.</p>}
        </div>
      ) : (
        <EmptyState icon="folder" title="This folder is empty" text="Drop files anywhere on this page, or use the buttons below.">
          <Button label="New folder" icon="folderPlus" onClick={() => actions.newFolder(folderId)} />
          <Button label="Upload files" icon="upload" kind="primary" onClick={upload} />
        </EmptyState>
      )}
    </>
  );
}

function Crumb({ c }: { c: Ancestor }) {
  const actions = useActions();
  const drop = useDropTarget(c.id, actions.move);
  return <a href={folderHref(c.id)} className={drop.over ? "drop-target" : undefined} {...drop.props}>{c.name}</a>;
}

function MoreButton({ items }: { items: () => MenuItem[] }) {
  const openMenu = useMenu();
  return <Button icon="more" title="More actions" className="row-more" onClick={(e) => { e.stopPropagation(); openMenu(e.currentTarget, items()); }} />;
}

function FolderRow({ f, menu }: { f: FolderNode; menu: MenuItem[] }) {
  const actions = useActions();
  const prefetch = usePrefetchFolder();
  const drop = useDropTarget(f.id, actions.move);
  const open = () => { location.hash = folderHref(f.id); };
  return (
    <div role="link" tabIndex={0} className={`row-item${drop.over ? " drop-target" : ""}`} {...dragProps(f)} {...drop.props}
      onClick={open} onKeyDown={(e) => e.key === "Enter" && open()}
      onPointerOver={() => prefetch(f.id)} onPointerDown={() => prefetch(f.id)} onFocus={() => prefetch(f.id)}>
      <span className="cell-name">
        <Tile node={f} />
        <span className="name-wrap"><span className="name">{f.name}</span><span className="sub">Folder</span></span>
      </span>
      <span className="cell-meta"><Time value={f.createdAt} /></span>
      <span className="cell-meta">—</span>
      <span className="cell-meta"><Person name={f.createdByName} email={f.createdBy} /></span>
      <span className="cell-act"><MoreButton items={() => [{ label: "Open", icon: "folder", onClick: open }, ...menu]} /></span>
    </div>
  );
}

function FileRow({ f }: { f: FileNode }) {
  const actions = useActions();
  const panel = usePanel();
  const open = () => panel.open(f.id, f);
  return (
    <div role="button" tabIndex={0} data-file={f.id} className={`row-item${panel.openId === f.id ? " sel" : ""}`} {...dragProps(f)}
      onClick={open} onKeyDown={(e) => e.key === "Enter" && open()}>
      <span className="cell-name">
        <Tile node={f} />
        <span className="name-wrap">
          <span className="name">{f.name}</span>
          {f.currentVersion > 1 && <span className="chip">v{f.currentVersion}</span>}
          <span className="sub">{[fmtSize(f.size), ago(f.updatedAt)].filter(Boolean).join(" · ")}</span>
        </span>
      </span>
      <span className="cell-meta"><Time value={f.updatedAt} /></span>
      <span className="cell-meta num">{fmtSize(f.size)}</span>
      <span className="cell-meta"><Person name={f.updatedByName} email={f.updatedBy} /></span>
      <span className="cell-act">
        <MoreButton items={() => [
          { label: "Open details", icon: "message", onClick: open },
          { label: "Download", icon: "download", onClick: () => actions.download(f.id, f.currentVersion) },
          { label: "Rename…", icon: "edit", onClick: () => actions.rename(f) },
          { label: "Move to folder…", icon: "folderMove", onClick: () => actions.openMove(f) },
          "-",
          { label: "Move to trash", icon: "trash", danger: true, onClick: () => actions.trashFile(f) },
        ]} />
      </span>
    </div>
  );
}
