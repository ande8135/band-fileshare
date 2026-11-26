import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fileQuery, qk } from "../lib/queries";
import { ago, fmtSize, fullDate, isTab, personName } from "../lib/format";
import { useActions } from "../lib/actions";
import { usePanel } from "../lib/panel";
import type { Comment, FileDetail, FileNode, Me, Version } from "../lib/types";
import { Avatar, Button, EmptyState, Tile, Time } from "./ui";
import { useMenu } from "./Menu";
import { Modal, useDialogs } from "./Dialogs";
import { useFail } from "./Toast";
import { useUploads } from "./Uploads";
import { Icon } from "./Icon";

/** Right-hand file details. Opens instantly from the row's data; versions + comments arrive in one request. */
export function DetailsPanel({ id, seed, me }: { id: string; seed?: FileNode; me: Me }) {
  const panel = usePanel();
  const actions = useActions();
  const openMenu = useMenu();
  const dialogs = useDialogs();
  const uploads = useUploads();
  const fail = useFail();
  const { data, error } = useQuery(fileQuery(id));
  const [tab, setTab] = useState<"comments" | "versions">("comments");
  const ref = useRef<HTMLElement>(null);

  useEffect(() => { if (error) fail(error); }, [error, fail]);

  // Click outside (but not on another file row, a menu or a dialog) or Escape closes the panel.
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!t.closest?.("#panel, .row-item[data-file], dialog, .menu, #tray")) panel.close();
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open], .menu")) panel.close();
    };
    document.addEventListener("mousedown", down);
    addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); removeEventListener("keydown", key); };
  }, [panel]);

  const file = data?.file ?? seed;
  if (!file) return null;
  const current = data?.versions.find((v) => v.version === file.currentVersion);

  const newVersion = () => dialogs.show((done) => (
    <UploadVersionDialog file={file} onDone={done}
      onUpload={async (chosen, note) => { if (await uploads.uploadVersion(file, chosen, note)) setTab("versions"); }} />
  ));

  return (
    <aside id="panel" ref={ref} aria-label="File details">
      <div className="p-head">
        <Tile node={file} size="lg" />
        <div className="p-title">
          <h2>{file.name}</h2>
          <p className="sub">
            {[file.currentVersion ? `v${file.currentVersion}` : null, fmtSize(file.size), file.updatedAt ? `updated ${ago(file.updatedAt)}` : null,
              current ? `by ${personName(current.uploadedByName, current.uploadedBy)}` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Button icon="x" title="Close" onClick={panel.close} />
      </div>

      <div className="p-actions">
        {isTab(file.name) && <Button label="Preview" icon="music" kind="primary" size="sm" onClick={() => actions.previewTab(file)} />}
        <Button label="Download" icon="download" kind={isTab(file.name) ? "ghost" : "primary"} size="sm" onClick={() => actions.download(file.id, file.currentVersion)} />
        <Button label="New version" icon="upload" size="sm" onClick={newVersion} />
        <Button icon="more" size="sm" title="More" onClick={(e) => openMenu(e.currentTarget, [
          { label: "Rename…", icon: "edit", onClick: () => actions.rename(file) },
          { label: "Move to folder…", icon: "folderMove", onClick: () => actions.openMove(file) },
          "-",
          { label: "Move to trash", icon: "trash", danger: true, onClick: () => actions.trashFile(file) },
        ])} />
      </div>

      <div className="tabs" role="tablist">
        {(["comments", "versions"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {t === "comments" ? "Comments" : "Versions"}
            {data && <span className="count">{t === "comments" ? data.comments.length : data.versions.length}</span>}
          </button>
        ))}
      </div>

      {tab === "comments"
        ? <Comments detail={data} file={file} me={me} />
        : <Versions versions={data?.versions} file={file} onDownload={(v) => actions.download(file.id, v)}
          onPreview={isTab(file.name) ? (v) => actions.previewTab(file, v) : undefined} />}
    </aside>
  );
}

function Loading() {
  return <div className="p-body"><div className="p-loading">{[0, 1, 2].map((i) => <div key={i} className="sk sk-block" />)}</div></div>;
}

function Comments({ detail, file, me }: { detail?: FileDetail; file: FileNode; me: Me }) {
  const qc = useQueryClient();
  const dialogs = useDialogs();
  const fail = useFail();
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [target, setTarget] = useState<string | null>(null); // null until the user picks; defaults to current version
  const [sending, setSending] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  const setComments = (fn: (cs: Comment[]) => Comment[]) =>
    qc.setQueryData<FileDetail>(qk.file(file.id), (old) => (old ? { ...old, comments: fn(old.comments) } : old));

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  if (!detail) return <Loading />;
  const { comments, versions } = detail;
  const versionValue = target ?? String(file.currentVersion ?? "");

  const counts: Record<string, number> = { all: comments.length, file: comments.filter((c) => c.version == null).length };
  for (const c of comments) if (c.version != null) counts[c.version] = (counts[c.version] ?? 0) + 1;
  const shown = comments.filter((c) => filter === "all" || (filter === "file" ? c.version == null : String(c.version) === filter));

  async function post(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      const c = await api<Comment>("POST", `/files/${file.id}/comments`, { text: text.trim(), version: versionValue });
      setComments((cs) => [...cs, { ...c, authorName: c.authorName ?? me.displayName }]);
      setText("");
      requestAnimationFrame(() => body.current?.scrollTo({ top: body.current.scrollHeight }));
    } catch (err) { fail(err); } finally { setSending(false); }
  }

  async function remove(c: Comment) {
    if (!await dialogs.confirm("This comment will be removed from the conversation.", { title: "Delete comment?", ok: "Delete", danger: true })) return;
    try {
      await api("DELETE", `/files/${file.id}/comments/${encodeURIComponent(c.sk)}`);
      setComments((cs) => cs.filter((x) => x.sk !== c.sk));
    } catch (e) { fail(e); }
  }

  async function save(c: Comment, newText: string) {
    try {
      const u = await api<Partial<Comment>>("PUT", `/files/${file.id}/comments/${encodeURIComponent(c.sk)}`, { text: newText });
      setComments((cs) => cs.map((x) => (x.sk === c.sk ? { ...x, ...u } : x)));
      setEditing(null);
    } catch (e) { fail(e); }
  }

  const chip = (key: string, label: string) => (
    <button key={key} className={`fchip${filter === key ? " active" : ""}`} onClick={() => setFilter(key)}>
      {label}{counts[key] ? <span>{counts[key]}</span> : null}
    </button>
  );

  return (
    <>
      <div className="p-body" ref={body}>
        {comments.length > 0 && (
          <div className="fchips">
            {chip("all", "All")}
            {versions.map((v) => chip(String(v.version), `v${v.version}`))}
            {counts.file ? chip("file", "Whole file") : null}
          </div>
        )}
        {shown.length ? (
          <div className="comments">
            {shown.map((c) => (
              <CommentItem key={c.sk} c={c} mine={c.author?.toLowerCase() === me.email.toLowerCase()} editing={editing === c.sk}
                onEdit={() => setEditing(c.sk)} onCancel={() => setEditing(null)} onSave={(t) => save(c, t)} onDelete={() => remove(c)} />
            ))}
          </div>
        ) : (
          <EmptyState icon="message" title={comments.length ? "No comments here" : "No comments yet"}
            text={comments.length ? "Try another filter." : "Start the conversation below."} />
        )}
      </div>
      <form className="composer" onSubmit={post}>
        <textarea ref={ta} rows={1} maxLength={4000} placeholder="Write a comment…" aria-label="Comment" value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
        <div className="composer-row">
          <select aria-label="Comment applies to" value={versionValue} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Whole file</option>
            {versions.map((v) => (
              <option key={v.version} value={String(v.version)}>On v{v.version}{v.version === file.currentVersion ? " (current)" : ""}</option>
            ))}
          </select>
          <span className="hint">⌘↵ to send</span>
          <button className="btn primary sm" disabled={sending}>Send</button>
        </div>
      </form>
    </>
  );
}

function CommentItem({ c, mine, editing, onEdit, onCancel, onSave, onDelete }: {
  c: Comment; mine: boolean; editing: boolean;
  onEdit: () => void; onCancel: () => void; onSave: (text: string) => void; onDelete: () => void;
}) {
  const [draft, setDraft] = useState(c.text);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) return;
    setDraft(c.text);
    requestAnimationFrame(() => { ta.current?.focus(); ta.current?.setSelectionRange(c.text.length, c.text.length); });
  }, [editing, c.text]);
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); onCancel(); }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim()) onSave(draft.trim());
  };
  return (
    <article className="comment">
      <Avatar name={c.authorName} email={c.author} size={28} />
      <div className="c-main">
        <div className="c-meta">
          <strong>{personName(c.authorName, c.author)}</strong>
          <Time value={c.createdAt} />
          {c.version != null ? <span className="chip">v{c.version}</span> : <span className="chip muted">file</span>}
          {c.editedAt && <span className="edited" title={`Edited ${fullDate(c.editedAt)}`}>edited</span>}
          {mine && !editing && (
            <span className="c-act">
              <Button icon="edit" size="xs" title="Edit" onClick={onEdit} />
              <Button icon="trash" size="xs" title="Delete" onClick={onDelete} />
            </span>
          )}
        </div>
        {editing ? (
          <div className="c-edit">
            <textarea ref={ta} className="input" rows={3} maxLength={4000} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={key} />
            <div className="c-edit-row">
              <Button label="Cancel" size="sm" onClick={onCancel} />
              <Button label="Save" kind="primary" size="sm" onClick={() => draft.trim() && onSave(draft.trim())} />
            </div>
          </div>
        ) : <p className="c-text">{c.text}</p>}
      </div>
    </article>
  );
}

function Versions({ versions, file, onDownload, onPreview }: {
  versions?: Version[]; file: FileNode; onDownload: (v: number) => void; onPreview?: (v: number) => void;
}) {
  if (!versions) return <Loading />;
  return (
    <div className="p-body">
      <ol className="timeline">
        {versions.map((v) => {
          const cur = v.version === file.currentVersion;
          return (
            <li key={v.version} className={cur ? "cur" : ""}>
              <span className="dot" />
              <div className="v-main">
                <div className="v-top"><strong>Version {v.version}</strong>{cur && <span className="chip accent">current</span>}</div>
                <div className="v-name">{v.originalName || file.name}</div>
                <div className="v-meta">
                  <Avatar name={v.uploadedByName} email={v.uploadedBy} size={16} />
                  <span>{personName(v.uploadedByName, v.uploadedBy)}</span>
                  <span>·</span><Time value={v.uploadedAt} /><span>·</span><span>{fmtSize(v.size)}</span>
                </div>
                {v.note && <p className="v-note">{v.note}</p>}
              </div>
              <span className="v-act">
                {onPreview && <Button icon="music" size="sm" title={`Preview version ${v.version}`} onClick={() => onPreview(v.version)} />}
                <Button icon="download" size="sm" title={`Download version ${v.version}`} onClick={() => onDownload(v.version)} />
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function UploadVersionDialog({ file, onDone, onUpload }: { file: FileNode; onDone: () => void; onUpload: (f: File, note: string) => void }) {
  const [chosen, setChosen] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const input = useRef<HTMLInputElement>(null);
  return (
    <Modal title="Upload new version" size="sm" onClose={onDone}
      actions={(close) => <>
        <Button label="Cancel" onClick={close} />
        <Button label="Upload" kind="primary" disabled={!chosen} onClick={() => { close(); if (chosen) onUpload(chosen, note.trim()); }} />
      </>}>
      <div className="stack">
        <p className="hint">Replaces the current version of “{file.name}”. Older versions stay available.</p>
        <input ref={input} type="file" hidden onChange={(e) => { setChosen(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        <button type="button" className={`filepick${chosen ? " chosen" : ""}`} onClick={() => input.current?.click()}>
          <Icon name="upload" />
          <span>{chosen ? `${chosen.name} · ${fmtSize(chosen.size)}` : "Choose a file…"}</span>
        </button>
        <label className="field">
          <span>Note</span>
          <input className="input" placeholder="What changed? (optional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
