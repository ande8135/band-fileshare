"use strict";
const cfg = window.APP_CONFIG;
const $ = (id) => document.getElementById(id);

// ============================================================================
// DOM helpers. User content is only ever set via text nodes / attributes, never innerHTML.
// ============================================================================
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

// Static icon set (Lucide-style strokes). Only these constant strings are parsed as markup.
const ICONS = {
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/>',
  folderPlus: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/><path d="M12 10.5v5M9.5 13h5"/>',
  folderMove: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/><path d="M9 13h6m-2-2 2 2-2 2"/>',
  file: '<path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3v5h5"/>',
  upload: '<path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/>',
  download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="m6 7 1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4.5h6V7"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18.5 14.5A6.5 6.5 0 0 1 21.5 20"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>',
  restore: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="m10 17-5-5 5-5"/><path d="M5 12h11"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  edit: '<path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16z"/>',
  message: '<path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/><path d="M12 8v4l3 2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/>',
};
function icon(name, cls = "") {
  const s = h("span", { class: `i ${cls}`, "aria-hidden": "true" });
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return s;
}
function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) el.replaceWith(icon(el.dataset.icon, el.className.replace(/\bi\b/, "")));
}

// replaceChildren that flattens arrays and skips null/false, like h().
function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return el;
}

function btn(label, { icon: ic, kind = "ghost", size, title, onClick, type = "button", disabled } = {}) {
  return h("button", { type, class: `btn ${kind}${size ? " " + size : ""}${label ? "" : " icon-only"}`, title: title ?? (label ? null : undefined), "aria-label": label ? null : title, disabled, onclick: onClick },
    ic ? icon(ic) : null, label ? h("span", {}, label) : null);
}

// ============================================================================
// Formatting
// ============================================================================
function fmtSize(n) {
  if (n == null) return "";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i && n < 10 ? 1 : 0)} ${u[i]}`;
}
const fullDate = (s) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
function ago(s) {
  if (!s) return "";
  const d = new Date(s), sec = (Date.now() - d) / 1000;
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  if (sec < 172800) return "yesterday";
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() && { year: "numeric" }) });
}
const time = (s) => h("time", { datetime: s, title: fullDate(s) }, ago(s));
const personName = (name, email) => name || (email ? email.split("@")[0] : "");

const AVATAR_COLORS = ["#e76f51", "#2a9d8f", "#8e7dbe", "#e9a23b", "#4d8fd6", "#d1608f", "#5a9e5a", "#c46b3c"];
function avatar(name, email, size = 22) {
  const label = (name || email || "?").trim();
  const parts = label.split(/[\s@._-]+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "?") + (name && parts[1] ? parts[1][0] : "")).toUpperCase();
  let hash = 0;
  for (const ch of (email || label).toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return h("span", { class: "avatar", style: `--s:${size}px;background:${AVATAR_COLORS[hash % AVATAR_COLORS.length]}`, title: label, "aria-hidden": "true" }, initials);
}
const person = (name, email) => h("span", { class: "person" }, avatar(name, email), h("span", { class: "person-name" }, personName(name, email)));

// File-type tiles: colour + short extension label, like a modern file browser.
const KINDS = [
  [/^(mp3|wav|flac|aiff?|m4a|ogg|aac|opus)$/, "audio"],
  [/^(png|jpe?g|gif|webp|heic|svg|bmp|tiff?)$/, "image"],
  [/^(mp4|mov|mkv|webm|avi|m4v)$/, "video"],
  [/^(gp|gpx|gp[345]|mscz?|musicxml|mxl|midi?|ptb|tg)$/, "notation"],
  [/^pdf$/, "pdf"],
  [/^(docx?|txt|md|rtf|pages|odt|xlsx?|csv|numbers|pptx?|key)$/, "doc"],
  [/^(zip|rar|7z|tar|gz)$/, "archive"],
];
function tile(node, size = "") {
  if (node.type === "folder") return h("span", { class: `tile folder ${size}` }, icon("folder"));
  const m = /\.([a-z0-9]{1,8})$/i.exec(node.name);
  const ext = m ? m[1].toLowerCase() : "";
  const kind = KINDS.find(([re]) => re.test(ext))?.[1] ?? "other";
  return h("span", { class: `tile ${kind} ${size}` }, ext ? h("b", {}, ext.slice(0, 4)) : icon("file"));
}

// ============================================================================
// Toasts, menus and dialogs (no native alert/confirm/prompt)
// ============================================================================
function toast(msg, kind = "") {
  const t = $("toast");
  fill(t, icon(kind === "error" ? "alert" : "check"), h("span", {}, msg));
  t.className = `show ${kind}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = ""), 3500);
}
const fail = (e) => toast(e.message, "error");

let openMenuEl = null;
function closeMenu() { openMenuEl?.remove(); openMenuEl = null; }
function menu(anchor, items) {
  closeMenu();
  const m = h("div", { class: "menu", role: "menu" });
  for (const it of items.filter(Boolean)) {
    if (it === "-") { m.append(h("div", { class: "menu-sep" })); continue; }
    m.append(h("button", { class: `menu-item${it.danger ? " danger" : ""}`, role: "menuitem", onclick: () => { closeMenu(); it.onClick(); } },
      it.icon ? icon(it.icon) : null, h("span", {}, it.label)));
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  const left = Math.min(Math.max(8, r.right - mw), innerWidth - mw - 8);
  const top = r.bottom + 6 + mh > innerHeight - 8 ? r.top - mh - 6 : r.bottom + 6;
  m.style.left = `${left}px`; m.style.top = `${Math.max(8, top)}px`;
  openMenuEl = m;
  m.querySelector("button")?.focus({ preventScroll: true });
}

function modal({ title, body, actions = [], cls = "", onClose }) {
  const dlg = h("dialog", { class: `modal ${cls}` },
    h("div", { class: "modal-inner" },
      h("div", { class: "modal-head" }, h("h2", {}, title), btn("", { icon: "x", title: "Close", onClick: () => dlg.close() })),
      h("div", { class: "modal-body" }, body),
      actions.length ? h("div", { class: "modal-foot" }, actions) : null));
  dlg.addEventListener("close", () => { dlg.remove(); onClose?.(); });
  dlg.addEventListener("mousedown", (e) => { if (e.target === dlg) dlg.close(); }); // backdrop
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

function confirmDialog(message, { title = "Are you sure?", ok = "Confirm", danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const dlg = modal({
      title, body: h("p", { class: "lead" }, message),
      actions: [btn("Cancel", { onClick: () => dlg.close() }),
        btn(ok, { kind: danger ? "danger-solid" : "primary", onClick: () => { result = true; dlg.close(); } })],
      cls: "sm", onClose: () => resolve(result),
    });
    dlg.querySelector(".modal-foot .btn:last-child").focus();
  });
}

function promptDialog({ title, label, value = "", ok = "Save", placeholder = "", hint = "", selectBase = false }) {
  return new Promise((resolve) => {
    let result = null;
    const input = h("input", { class: "input", value, placeholder, maxlength: "255", "aria-label": label });
    const form = h("form", { onsubmit: (e) => { e.preventDefault(); if (!input.value.trim()) return; result = input.value.trim(); dlg.close(); } },
      h("label", { class: "field" }, h("span", {}, label), input), hint ? h("p", { class: "hint" }, hint) : null);
    const dlg = modal({
      title, body: form, cls: "sm", onClose: () => resolve(result),
      actions: [btn("Cancel", { onClick: () => dlg.close() }), btn(ok, { kind: "primary", onClick: () => form.requestSubmit() })],
    });
    input.focus();
    // For file names, pre-select just the part before the extension, like Finder does.
    const dot = selectBase ? value.lastIndexOf(".") : -1;
    if (dot > 0) input.setSelectionRange(0, dot); else input.select();
  });
}

// ============================================================================
// Auth: Cognito hosted UI, authorization code + PKCE
// ============================================================================
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const store = {
  get: () => { try { return JSON.parse(localStorage.getItem("tokens")); } catch { return null; } },
  set: (t) => localStorage.setItem("tokens", JSON.stringify(t)),
  clear: () => localStorage.removeItem("tokens"),
};
const jwt = (t) => JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));

async function login() {
  const verifier = rand(48), state = rand(16);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  sessionStorage.setItem("pkce", JSON.stringify({ verifier, state, hash: location.hash }));
  const q = new URLSearchParams({
    response_type: "code", client_id: cfg.clientId, redirect_uri: cfg.redirectUri,
    scope: "openid email profile", code_challenge: challenge, code_challenge_method: "S256", state,
  });
  location.assign(`https://${cfg.cognitoDomain}/oauth2/authorize?${q}`);
}

async function tokenRequest(params) {
  const r = await fetch(`https://${cfg.cognitoDomain}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, ...params }),
  });
  if (!r.ok) throw new Error("token request failed");
  return r.json();
}

async function handleCallback() {
  const p = new URLSearchParams(location.search);
  if (p.has("error")) {
    history.replaceState(null, "", cfg.redirectUri);
    const d = p.get("error_description") || "";
    throw new Error(/invited|invitation/i.test(d) ? "That email hasn't been invited. Ask an admin for an invite."
      : /removed/i.test(d) ? "Your access has been removed." : "Sign-in failed. Please try again.");
  }
  if (!p.has("code")) return;
  const saved = JSON.parse(sessionStorage.getItem("pkce") || "null");
  sessionStorage.removeItem("pkce");
  history.replaceState(null, "", cfg.redirectUri + (saved?.hash || ""));
  if (!saved || saved.state !== p.get("state")) throw new Error("Invalid login state");
  const t = await tokenRequest({
    grant_type: "authorization_code", code: p.get("code"),
    redirect_uri: cfg.redirectUri, code_verifier: saved.verifier,
  });
  store.set({ id: t.id_token, refresh: t.refresh_token });
}

let refreshing = null; // share one refresh between concurrent requests
async function idToken() {
  const t = store.get();
  if (!t) return null;
  if (jwt(t.id).exp * 1000 - 60000 > Date.now()) return t.id;
  refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh })
    .then((r) => { store.set({ id: r.id_token, refresh: t.refresh }); return r.id_token; })
    .catch(() => { store.clear(); return null; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

function logout() {
  store.clear();
  const q = new URLSearchParams({ client_id: cfg.clientId, logout_uri: cfg.redirectUri });
  location.assign(`https://${cfg.cognitoDomain}/logout?${q}`);
}

// ============================================================================
// API + client cache
// ============================================================================
async function api(method, path, body) {
  const token = await idToken();
  if (!token) { login(); throw new Error("Signing in…"); }
  const r = await fetch(cfg.apiUrl + path, {
    method,
    headers: { authorization: token, ...(body && { "content-type": "application/json" }) },
    body: body && JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { store.clear(); login(); throw new Error("Session expired"); }
  if (!r.ok) throw Object.assign(new Error(data.error || `Request failed (${r.status})`), { status: r.status });
  return data;
}

// Folder listings are cached so navigating back/forward renders instantly; every visit
// still revalidates in the background. Requests for the same folder are de-duplicated.
const folderCache = new Map();
const fileCache = new Map();
const inflight = new Map();
function fetchFolder(id, { fresh = false } = {}) {
  const key = `f:${id}`;
  if (fresh || !inflight.has(key)) {
    inflight.set(key, api("GET", `/folders/${id}/contents`)
      .then((d) => { folderCache.set(id, d); return d; })
      .finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}
const prefetchFolder = (id) => { if (!folderCache.has(id)) fetchFolder(id).catch(() => {}); };
const invalidate = (...ids) => ids.forEach((id) => folderCache.delete(id));

function putFile(url, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("content-type", contentType);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => (x.status < 300 ? resolve() : reject(new Error(`Upload failed (${x.status})`)));
    x.onerror = () => reject(new Error("Network error during upload"));
    x.send(file);
  });
}

// ============================================================================
// Routing
// ============================================================================
let me = { email: "", displayName: "" };
let folderId = "root";
let filterQ = "";
let navSeq = 0;

function parseRoute() {
  const hsh = location.hash;
  if (hsh === "#/trash") return { view: "trash" };
  if (hsh === "#/members") return { view: me.isAdmin ? "members" : "files", id: "root" };
  const m = /^#\/folder\/([\w-]+)/.exec(hsh);
  return { view: "files", id: m ? m[1] : "root" };
}

function setActiveNav(view) {
  for (const a of $("nav").querySelectorAll("a")) a.classList.toggle("active", a.dataset.view === view);
}

async function render({ quiet = false } = {}) {
  const r = parseRoute();
  const seq = ++navSeq;
  setActiveNav(r.view);
  closeMenu();
  if (r.view === "trash") return renderTrash(seq);
  if (r.view === "members") return renderMembers(seq);

  if (r.id !== folderId) filterQ = "";
  folderId = r.id;
  const cached = folderCache.get(r.id);
  if (cached) drawFolder(cached);
  else if (!quiet) drawSkeleton();
  try {
    // After an edit, skip any request that started before it so we don't redraw stale data.
    const d = await fetchFolder(r.id, { fresh: quiet });
    if (seq !== navSeq) return;
    if (!cached || JSON.stringify(d) !== JSON.stringify(cached)) drawFolder(d);
  } catch (e) {
    if (seq !== navSeq) return;
    if (!cached) drawMessage("Couldn't load this folder", e.message);
    else fail(e);
  }
}
const reload = () => render({ quiet: true });

// ============================================================================
// Page scaffolding
// ============================================================================
function page({ crumbs = [], title, sub, actions = [], toolbar, body }) {
  const nav = crumbs.length ? h("nav", { class: "crumbs", "aria-label": "Breadcrumbs" },
    crumbs.flatMap((c, i) => [i ? icon("chevron", "sep") : null, c])) : null;
  fill($("view"), [
    h("header", { class: "page-head" },
      h("div", { class: "page-title" }, nav, h("h1", {}, title), sub ? h("p", { class: "sub" }, sub) : null),
      h("div", { class: "page-actions" }, actions)),
    toolbar, body]);
  $("main").scrollTop = 0;
}

function drawSkeleton() {
  page({
    title: h("span", { class: "sk sk-title" }),
    body: h("div", { class: "list" }, Array.from({ length: 7 }, (_, i) =>
      h("div", { class: "row-item sk-row", style: `--d:${i * 60}ms` }, h("span", { class: "sk sk-tile" }), h("span", { class: "sk sk-line" })))),
  });
}

function drawMessage(title, text) {
  page({ title: "", body: h("div", { class: "empty" }, h("span", { class: "empty-icon" }, icon("alert")), h("h3", {}, title), h("p", {}, text)) });
}

function emptyState(iconName, title, text, actions = []) {
  return h("div", { class: "empty" }, h("span", { class: "empty-icon" }, icon(iconName)), h("h3", {}, title), h("p", {}, text),
    actions.length ? h("div", { class: "empty-actions" }, actions) : null);
}

// ============================================================================
// Files view
// ============================================================================
const DRAG_TYPE = "application/x-vdi-file";

// Lets el accept a dragged file row and move that file into folder targetId.
function dropTarget(el, targetId) {
  const ours = (e) => [...(e.dataTransfer?.types ?? [])].includes(DRAG_TYPE);
  el.addEventListener("dragover", (e) => { if (!ours(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; el.classList.add("drop-target"); });
  el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
  el.addEventListener("drop", (e) => {
    el.classList.remove("drop-target");
    if (!ours(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const f = JSON.parse(e.dataTransfer.getData(DRAG_TYPE));
    if (f.parentId !== targetId) moveFile(f, targetId);
  });
  return el;
}

function drawFolder(d) {
  const crumbs = [];
  if (d.folder) {
    crumbs.push(dropTarget(h("a", { href: "#/" }, "Files"), "root"));
    for (const c of d.breadcrumbs.slice(0, -1)) crumbs.push(dropTarget(h("a", { href: `#/folder/${c.id}` }, c.name), c.id));
  }
  const filter = h("label", { class: "search" }, icon("search"),
    h("input", { type: "search", placeholder: "Filter", value: filterQ, "aria-label": "Filter this folder", oninput: (e) => { filterQ = e.target.value; applyFilter(); } }),
    h("kbd", {}, "/"));
  const count = d.folders.length + d.files.length;

  const body = count
    ? h("div", { class: "list", id: "list" },
      h("div", { class: "list-head", "aria-hidden": "true" }, h("span", {}, "Name"), h("span", {}, "Modified"), h("span", {}, "Size"), h("span", {}, "Owner"), h("span")),
      d.folders.map(folderRow), d.files.map(fileRow),
      h("p", { class: "no-match", hidden: true }, "No matches in this folder."))
    : emptyState("folder", "This folder is empty", "Drop files anywhere on this page, or use the buttons below.", [
      btn("New folder", { icon: "folderPlus", onClick: newFolder }), btn("Upload files", { icon: "upload", kind: "primary", onClick: () => $("picker").click() })]);

  page({
    crumbs,
    title: d.folder ? d.folder.name : "Files",
    sub: count ? `${d.folders.length ? `${d.folders.length} folder${d.folders.length > 1 ? "s" : ""}` : ""}${d.folders.length && d.files.length ? " · " : ""}${d.files.length ? `${d.files.length} file${d.files.length > 1 ? "s" : ""}` : ""}` : null,
    actions: [count ? filter : null, btn("New folder", { icon: "folderPlus", onClick: newFolder }),
      btn("Upload", { icon: "upload", kind: "primary", onClick: () => $("picker").click() })],
    body,
  });
  applyFilter();
  markSelected();
}

function applyFilter() {
  const list = $("list");
  if (!list) return;
  const q = filterQ.trim().toLowerCase();
  let shown = 0;
  for (const r of list.querySelectorAll(".row-item")) {
    const hit = !q || r.dataset.name.includes(q);
    r.hidden = !hit;
    shown += hit;
  }
  list.querySelector(".no-match").hidden = shown > 0;
}

function rowShell(attrs, node, nameExtras, cells, menuItems) {
  const more = btn("", { icon: "more", title: "More actions", onClick: (e) => { e.stopPropagation(); menu(e.currentTarget, menuItems()); } });
  more.classList.add("row-more");
  return h("div", { class: "row-item", tabindex: "0", "data-name": node.name.toLowerCase(), ...attrs },
    h("span", { class: "cell-name" }, tile(node), h("span", { class: "name-wrap" }, h("span", { class: "name" }, node.name), nameExtras)),
    cells, h("span", { class: "cell-act" }, more));
}

function folderRow(f) {
  const open = () => { location.hash = `#/folder/${f.id}`; };
  const row = rowShell({
    role: "link", onclick: open, onkeydown: (e) => { if (e.key === "Enter") open(); },
    onpointerenter: () => prefetchFolder(f.id), onpointerdown: () => prefetchFolder(f.id),
  }, f, h("span", { class: "sub" }, "Folder"),
  [h("span", { class: "cell-meta" }, time(f.createdAt)), h("span", { class: "cell-meta" }, "—"), h("span", { class: "cell-meta" }, person(f.createdByName, f.createdBy))],
  () => [{ label: "Open", icon: "folder", onClick: open }, "-", { label: "Move to trash", icon: "trash", danger: true, onClick: () => deleteFolder(f) }]);
  return dropTarget(row, f.id);
}

function fileRow(f) {
  const open = () => openDetails(f.id, f);
  const row = rowShell({
    "data-file": f.id, role: "button", draggable: "true", onclick: open,
    onkeydown: (e) => { if (e.key === "Enter") open(); },
    ondragstart: (e) => { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ id: f.id, name: f.name, parentId: f.parentId })); e.dataTransfer.effectAllowed = "move"; },
  }, f,
  [f.currentVersion > 1 ? h("span", { class: "chip" }, `v${f.currentVersion}`) : null,
    h("span", { class: "sub" }, [fmtSize(f.size), ago(f.updatedAt)].filter(Boolean).join(" · "))],
  [h("span", { class: "cell-meta" }, time(f.updatedAt)), h("span", { class: "cell-meta num" }, fmtSize(f.size)), h("span", { class: "cell-meta" }, person(f.updatedByName, f.updatedBy))],
  () => [
    { label: "Open details", icon: "message", onClick: open },
    { label: "Download", icon: "download", onClick: () => download(f.id, f.currentVersion) },
    { label: "Rename…", icon: "edit", onClick: () => renameFile(f) },
    { label: "Move to folder…", icon: "folderMove", onClick: () => openMove(f) },
    "-", { label: "Move to trash", icon: "trash", danger: true, onClick: () => deleteFile(f) },
  ]);
  return row;
}

function markSelected() {
  const id = panel.file?.id;
  for (const r of document.querySelectorAll(".row-item[data-file]")) r.classList.toggle("sel", r.dataset.file === id && !$("panel").hidden);
}

async function newFolder() {
  const name = await promptDialog({ title: "New folder", label: "Name", placeholder: "Untitled folder", ok: "Create" });
  if (!name) return;
  try {
    await api("POST", "/folders", { name, parentId: folderId });
    toast(`Created “${name}”`);
    await reload();
  } catch (e) { fail(e); }
}

async function deleteFolder(f) {
  if (!await confirmDialog(`“${f.name}” will move to the trash. Folders must be empty first.`, { title: "Move folder to trash?", ok: "Move to trash", danger: true })) return;
  try { await api("DELETE", `/folders/${f.id}`); toast("Moved to trash"); await reload(); } catch (e) { fail(e); }
}

async function deleteFile(f) {
  if (!await confirmDialog(`“${f.name}” and its versions will move to the trash. You can restore it later.`, { title: "Move file to trash?", ok: "Move to trash", danger: true })) return;
  try {
    await api("DELETE", `/files/${f.id}`);
    if (panel.file?.id === f.id) closePanel();
    toast("Moved to trash");
    await reload();
  } catch (e) { fail(e); }
}

async function download(id, version) {
  try {
    const { url } = await api("GET", `/files/${id}/versions/${version}/download`);
    location.assign(url);
  } catch (e) { fail(e); }
}

async function renameFile(f) {
  const name = await promptDialog({ title: "Rename file", label: "Name", value: f.name, ok: "Rename", selectBase: true });
  if (!name || name === f.name) return;
  const ext = (n) => (/\.([^.]+)$/.exec(n)?.[1] ?? "").toLowerCase();
  if (ext(name) !== ext(f.name) && !await confirmDialog(
    ext(name) ? `Change the extension from “.${ext(f.name) || "none"}” to “.${ext(name)}”? The file may open differently.`
      : `Remove the “.${ext(f.name)}” extension? The file may not open correctly.`,
    { title: "Change file extension?", ok: "Change it" })) return;
  try {
    const updated = await api("POST", `/files/${f.id}/rename`, { name });
    invalidate(f.parentId);
    fileCache.delete(f.id);
    if (panel.file?.id === f.id) { panel.file = { ...panel.file, ...updated }; drawPanel(); }
    toast(`Renamed to “${updated.name}”`);
    await reload();
  } catch (e) { fail(e); }
}

async function moveFile(f, targetId) {
  try {
    await api("POST", `/files/${f.id}/move`, { parentId: targetId });
    invalidate(f.parentId, targetId);
    fileCache.delete(f.id);
    if (panel.file?.id === f.id) closePanel();
    toast(`Moved “${f.name}”`);
    await reload();
  } catch (e) { fail(e); }
}

function openMove(file) {
  let target = file.parentId;
  const crumbs = h("nav", { class: "picker-crumbs" });
  const list = h("div", { class: "picker-list" });
  const go = btn("Move here", { kind: "primary", onClick: () => { dlg.close(); moveFile(file, target); } });
  const load = async (id) => {
    list.classList.add("loading");
    try {
      const d = folderCache.get(id) ?? await fetchFolder(id);
      target = id;
      fill(crumbs, h("a", { onclick: () => load("root") }, "Files"),
        d.breadcrumbs.flatMap((c) => [icon("chevron", "sep"), h("a", { onclick: () => load(c.id) }, c.name)]));
      fill(list, ...(d.folders.length
        ? d.folders.map((f) => h("button", { class: "picker-item", onclick: () => load(f.id), onpointerenter: () => prefetchFolder(f.id) }, tile(f, "sm"), h("span", {}, f.name), icon("chevron", "go")))
        : [h("p", { class: "hint pad" }, "No subfolders here.")]));
      go.disabled = id === file.parentId;
    } catch (e) { fail(e); } finally { list.classList.remove("loading"); }
  };
  const dlg = modal({ title: `Move “${file.name}”`, body: h("div", {}, crumbs, list), actions: [btn("Cancel", { onClick: () => dlg.close() }), go] });
  load(file.parentId);
}

// ============================================================================
// Uploads
// ============================================================================
const tray = { items: [], el: () => $("tray") };
function trayItem(name) {
  const item = { name, p: 0, state: "queued", msg: "" };
  tray.items.push(item);
  drawTray();
  return {
    progress: (p) => { item.p = p; item.state = "up"; drawTray(); },
    done: () => { item.p = 1; item.state = "done"; drawTray(); },
    fail: (e) => { item.state = "error"; item.msg = e.message; drawTray(); },
  };
}
function drawTray() {
  const el = tray.el();
  const active = tray.items.filter((i) => i.state === "queued" || i.state === "up").length;
  el.hidden = !tray.items.length;
  fill(el, 
    h("div", { class: "tray-head" },
      h("strong", {}, active ? `Uploading ${active} file${active > 1 ? "s" : ""}…` : "Uploads complete"),
      active ? null : btn("", { icon: "x", title: "Dismiss", onClick: () => { tray.items = []; drawTray(); } })),
    h("div", { class: "tray-list" }, tray.items.map((i) => h("div", { class: `tray-item ${i.state}` },
      tile({ type: "file", name: i.name }, "sm"),
      h("div", { class: "tray-main" }, h("span", { class: "name" }, i.name),
        i.state === "error" ? h("span", { class: "err" }, i.msg) : h("span", { class: "bar" }, h("span", { style: `width:${Math.round(i.p * 100)}%` }))),
      i.state === "done" ? icon("check", "ok") : i.state === "error" ? icon("alert", "bad") : h("span", { class: "pct" }, `${Math.round(i.p * 100)}%`)))));
  clearTimeout(drawTray.t);
  if (tray.items.length && !active && tray.items.every((i) => i.state === "done")) {
    drawTray.t = setTimeout(() => { tray.items = []; drawTray(); }, 4000);
  }
}

async function uploadOne(file, parentId) {
  const ui = trayItem(file.name);
  try {
    const contentType = file.type || "application/octet-stream";
    const r = await api("POST", "/files", { name: file.name, parentId, contentType, size: file.size });
    await putFile(r.uploadUrl, file, r.contentType, ui.progress);
    await api("POST", `/files/${r.file.id}/versions/${r.version}/complete`);
    ui.done();
  } catch (e) { ui.fail(e); }
}

async function uploadFiles(files) {
  if (parseRoute().view !== "files") { location.hash = "#/"; }
  const parentId = folderId;
  const queue = [...files];
  const worker = async () => { while (queue.length) await uploadOne(queue.shift(), parentId); };
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
  invalidate(parentId);
  if (folderId === parentId) await reload();
}

// ============================================================================
// Details panel
// ============================================================================
const panel = { file: null, versions: null, comments: null, tab: "comments", filter: "all", editing: null, seq: 0 };

async function openDetails(id, seed) {
  const seq = ++panel.seq;
  const cached = fileCache.get(id);
  const same = panel.file?.id === id;
  Object.assign(panel, {
    file: cached?.file ?? seed ?? panel.file,
    versions: cached?.versions ?? (same ? panel.versions : null),
    comments: cached?.comments ?? (same ? panel.comments : null),
    tab: same ? panel.tab : "comments", filter: same ? panel.filter : "all", editing: null,
  });
  if (!same) $("cText").value = "";
  $("panel").hidden = false;
  drawPanel();
  markSelected();
  try {
    const d = await api("GET", `/files/${id}?include=comments`);
    fileCache.set(id, d);
    if (seq !== panel.seq) return;
    Object.assign(panel, { file: d.file, versions: d.versions, comments: d.comments });
    drawPanel();
  } catch (e) {
    if (seq === panel.seq) { fail(e); if (e.status === 404) closePanel(); }
  }
}

function closePanel() {
  panel.seq++;
  panel.file = null;
  $("panel").hidden = true;
  markSelected();
}

function drawPanel() {
  const { file, versions, comments } = panel;
  if (!file) return;
  const current = versions?.find((v) => v.version === file.currentVersion);
  fill($("pHead"), 
    tile(file, "lg"),
    h("div", { class: "p-title" }, h("h2", {}, file.name),
      h("p", { class: "sub" }, [file.currentVersion ? `v${file.currentVersion}` : null, fmtSize(file.size), file.updatedAt ? `updated ${ago(file.updatedAt)}` : null,
        current ? `by ${personName(current.uploadedByName, current.uploadedBy)}` : null].filter(Boolean).join(" · "))),
    btn("", { icon: "x", title: "Close", onClick: closePanel }));

  fill($("pActions"), 
    btn("Download", { icon: "download", kind: "primary", size: "sm", onClick: () => download(file.id, file.currentVersion) }),
    btn("New version", { icon: "upload", size: "sm", onClick: () => uploadVersionDialog() }),
    btn("", { icon: "more", size: "sm", title: "More", onClick: (e) => menu(e.currentTarget, [
      { label: "Rename…", icon: "edit", onClick: () => renameFile(file) },
      { label: "Move to folder…", icon: "folderMove", onClick: () => openMove(file) },
      "-", { label: "Move to trash", icon: "trash", danger: true, onClick: () => deleteFile(file) }]) }));

  const tab = (key, label, n) => h("button", { class: `tab${panel.tab === key ? " active" : ""}`, role: "tab", "aria-selected": String(panel.tab === key),
    onclick: () => { panel.tab = key; drawPanel(); } }, label, n != null ? h("span", { class: "count" }, String(n)) : null);
  fill($("pTabs"), tab("comments", "Comments", comments?.length), tab("versions", "Versions", versions?.length));

  $("composer").hidden = panel.tab !== "comments";
  if (panel.tab === "comments") drawComments(); else drawVersions();

  // Composer target options follow the version list.
  const sel = $("cVersion");
  const prev = sel.dataset.file === file.id ? sel.value : String(file.currentVersion ?? "");
  if (!versions) { fill(sel, h("option", { value: "" }, "Whole file")); sel.dataset.file = ""; return; }
  fill(sel, h("option", { value: "" }, "Whole file"),
    ...(versions ?? []).map((v) => h("option", { value: String(v.version) }, `On v${v.version}${v.version === file.currentVersion ? " (current)" : ""}`)));
  sel.value = [...sel.options].some((o) => o.value === prev) ? prev : "";
  sel.dataset.file = file.id;
}

function loadingBlock() {
  return h("div", { class: "p-loading" }, Array.from({ length: 3 }, () => h("div", { class: "sk sk-block" })));
}

function drawComments() {
  const body = $("pBody");
  const { comments, versions } = panel;
  if (!comments) return fill(body, loadingBlock());
  const counts = { all: comments.length, file: comments.filter((c) => c.version == null).length };
  for (const c of comments) if (c.version != null) counts[c.version] = (counts[c.version] ?? 0) + 1;
  const chip = (key, label) => h("button", { class: `fchip${panel.filter === key ? " active" : ""}`, onclick: () => { panel.filter = key; drawComments(); } },
    label, counts[key] ? h("span", {}, String(counts[key])) : null);
  const chips = h("div", { class: "fchips" }, chip("all", "All"),
    (versions ?? []).map((v) => chip(String(v.version), `v${v.version}`)), counts.file ? chip("file", "Whole file") : null);

  const shown = comments.filter((c) => panel.filter === "all" || (panel.filter === "file" ? c.version == null : String(c.version) === panel.filter));
  fill(body, comments.length ? chips : null,
    shown.length ? h("div", { class: "comments" }, shown.map(commentItem))
      : emptyState("message", comments.length ? "No comments here" : "No comments yet", comments.length ? "Try another filter." : "Start the conversation below."));
}

function commentItem(c) {
  const mine = c.author && c.author.toLowerCase() === me.email.toLowerCase();
  const editing = panel.editing === c.sk;
  return h("article", { class: "comment" },
    avatar(c.authorName, c.author, 28),
    h("div", { class: "c-main" },
      h("div", { class: "c-meta" }, h("strong", {}, personName(c.authorName, c.author)), time(c.createdAt),
        c.version != null ? h("span", { class: "chip" }, `v${c.version}`) : h("span", { class: "chip muted" }, "file"),
        c.editedAt ? h("span", { class: "edited", title: `Edited ${fullDate(c.editedAt)}` }, "edited") : null,
        mine && !editing ? h("span", { class: "c-act" },
          btn("", { icon: "edit", size: "xs", title: "Edit", onClick: () => { panel.editing = c.sk; drawComments(); } }),
          btn("", { icon: "trash", size: "xs", title: "Delete", onClick: () => removeComment(c) })) : null),
      editing ? editForm(c) : h("p", { class: "c-text" }, c.text)));
}

function editForm(c) {
  const ta = h("textarea", { class: "input", rows: "3", maxlength: "4000" });
  ta.value = c.text;
  const cancel = () => { panel.editing = null; drawComments(); };
  const save = async () => {
    const text = ta.value.trim();
    if (!text) return;
    try {
      const u = await api("PUT", `/files/${panel.file.id}/comments/${encodeURIComponent(c.sk)}`, { text });
      Object.assign(c, u);
      panel.editing = null;
      drawComments();
    } catch (e) { fail(e); }
  };
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); cancel(); }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
  });
  requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
  return h("div", { class: "c-edit" }, ta, h("div", { class: "c-edit-row" }, btn("Cancel", { size: "sm", onClick: cancel }), btn("Save", { kind: "primary", size: "sm", onClick: save })));
}

async function removeComment(c) {
  if (!await confirmDialog("This comment will be removed from the conversation.", { title: "Delete comment?", ok: "Delete", danger: true })) return;
  try {
    await api("DELETE", `/files/${panel.file.id}/comments/${encodeURIComponent(c.sk)}`);
    panel.comments = panel.comments.filter((x) => x.sk !== c.sk);
    fileCache.delete(panel.file.id);
    drawPanel();
  } catch (e) { fail(e); }
}

async function postComment(e) {
  e.preventDefault();
  const ta = $("cText");
  const text = ta.value.trim();
  if (!text || !panel.file) return;
  $("cSend").disabled = true;
  try {
    const c = await api("POST", `/files/${panel.file.id}/comments`, { text, version: $("cVersion").value });
    c.authorName ??= me.displayName;
    panel.comments = [...(panel.comments ?? []), c];
    fileCache.delete(panel.file.id);
    ta.value = "";
    autoGrow(ta);
    drawPanel();
    $("pBody").scrollTop = $("pBody").scrollHeight;
  } catch (err) { fail(err); } finally { $("cSend").disabled = false; }
}

function drawVersions() {
  const body = $("pBody");
  const { versions, file } = panel;
  if (!versions) return fill(body, loadingBlock());
  fill(body, h("ol", { class: "timeline" }, versions.map((v) => {
    const cur = v.version === file.currentVersion;
    return h("li", { class: cur ? "cur" : "" },
      h("span", { class: "dot" }),
      h("div", { class: "v-main" },
        h("div", { class: "v-top" }, h("strong", {}, `Version ${v.version}`), cur ? h("span", { class: "chip accent" }, "current") : null),
        h("div", { class: "v-name" }, v.originalName || file.name),
        h("div", { class: "v-meta" }, avatar(v.uploadedByName, v.uploadedBy, 16), h("span", {}, personName(v.uploadedByName, v.uploadedBy)),
          h("span", {}, "·"), time(v.uploadedAt), h("span", {}, "·"), h("span", {}, fmtSize(v.size))),
        v.note ? h("p", { class: "v-note" }, v.note) : null),
      btn("", { icon: "download", size: "sm", title: `Download version ${v.version}`, onClick: () => download(file.id, v.version) }));
  })));
}

function uploadVersionDialog() {
  const file = panel.file;
  let chosen = null;
  const label = h("span", {}, "Choose a file…");
  const pick = h("button", { type: "button", class: "filepick", onclick: () => $("verPicker").click() }, icon("upload"), label);
  const note = h("input", { class: "input", placeholder: "What changed? (optional)", maxlength: "500" });
  const go = btn("Upload", { kind: "primary", disabled: true, onClick: () => { dlg.close(); uploadVersion(file, chosen, note.value.trim()); } });
  $("verPicker").onchange = (e) => {
    chosen = e.target.files[0] ?? null;
    e.target.value = "";
    label.textContent = chosen ? `${chosen.name} · ${fmtSize(chosen.size)}` : "Choose a file…";
    pick.classList.toggle("chosen", !!chosen);
    go.disabled = !chosen;
  };
  const dlg = modal({
    title: "Upload new version", cls: "sm",
    body: h("div", { class: "stack" }, h("p", { class: "hint" }, `Replaces the current version of “${file.name}”. Older versions stay available.`), pick,
      h("label", { class: "field" }, h("span", {}, "Note"), note)),
    actions: [btn("Cancel", { onClick: () => dlg.close() }), go],
  });
}

async function uploadVersion(file, chosen, note) {
  const ui = trayItem(`${chosen.name} → v${(file.currentVersion ?? 0) + 1}`);
  try {
    const contentType = chosen.type || "application/octet-stream";
    const r = await api("POST", `/files/${file.id}/versions`, { contentType, fileName: chosen.name, size: chosen.size, note });
    await putFile(r.uploadUrl, chosen, r.contentType, ui.progress);
    await api("POST", `/files/${file.id}/versions/${r.version}/complete`);
    ui.done();
    fileCache.delete(file.id);
    invalidate(file.parentId);
    if (folderId === file.parentId) reload();
    if (panel.file?.id === file.id) { panel.tab = "versions"; openDetails(file.id); }
  } catch (e) { ui.fail(e); }
}

// ============================================================================
// Trash view
// ============================================================================
async function renderTrash(seq) {
  drawSkeleton();
  try {
    const { items } = await api("GET", "/trash");
    if (seq !== navSeq) return;
    page({
      title: "Trash",
      sub: items.length ? `${items.length} item${items.length > 1 ? "s" : ""} · nothing here is ever permanently deleted` : null,
      body: items.length
        ? h("div", { class: "list trash" },
          h("div", { class: "list-head", "aria-hidden": "true" }, h("span", {}, "Name"), h("span", {}, "Deleted"), h("span", {}, "From"), h("span", {}, "By"), h("span")),
          items.map((n) => h("div", { class: "row-item static" },
            h("span", { class: "cell-name" }, tile(n), h("span", { class: "name-wrap" }, h("span", { class: "name" }, n.name),
              h("span", { class: "sub" }, `Deleted ${ago(n.deletedAt)} · ${pathOf(n)}`))),
            h("span", { class: "cell-meta" }, time(n.deletedAt)),
            h("span", { class: "cell-meta trunc" }, pathOf(n)),
            h("span", { class: "cell-meta" }, person(n.deletedByName, n.deletedBy)),
            h("span", { class: "cell-act show" }, btn("Restore", { icon: "restore", size: "sm", onClick: () => restoreNode(n) })))))
        : emptyState("trash", "Trash is empty", "Deleted files and folders show up here, and can always be restored."),
    });
  } catch (e) { if (seq === navSeq) drawMessage("Couldn't load the trash", e.message); }
}
const pathOf = (n) => "/" + (n.ancestors ?? []).map((a) => a.name).join("/");

async function restoreNode(n) {
  try {
    await api("POST", `/${n.type === "folder" ? "folders" : "files"}/${n.id}/restore`);
    invalidate(n.parentId);
    toast(`Restored “${n.name}”`);
    render();
  } catch (e) { fail(e); }
}

// ============================================================================
// Members view (admins)
// ============================================================================
async function renderMembers(seq) {
  drawSkeleton();
  try {
    const { users } = await api("GET", "/users");
    if (seq !== navSeq) return;
    const email = h("input", { class: "input", type: "email", placeholder: "name@example.com", required: true, "aria-label": "Email to invite" });
    const role = h("select", { class: "input", "aria-label": "Role" }, h("option", { value: "member" }, "Member"), h("option", { value: "admin" }, "Administrator"));
    const invite = h("form", { class: "invite", onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api("POST", "/invites", { email: email.value.trim(), role: role.value });
        toast(`Invitation sent to ${email.value.trim().toLowerCase()}`);
        render();
      } catch (err) { fail(err); }
    } }, email, role, btn("Send invite", { kind: "primary", type: "submit", icon: "user" }));

    const active = users.filter((u) => u.status === "active").length;
    page({
      title: "Members",
      sub: `${active} active · administrators can invite people, change roles and remove access`,
      toolbar: invite,
      body: h("div", { class: "list members" }, users.map(memberRow)),
    });
  } catch (e) { if (seq === navSeq) drawMessage("Couldn't load members", e.message); }
}

function memberRow(u) {
  const locked = u.owner || u.email.toLowerCase() === me.email.toLowerCase();
  const off = u.status !== "active";
  let roleEl;
  if (locked) roleEl = h("span", { class: "role" }, "Administrator", u.owner ? h("span", { class: "chip muted" }, "owner") : h("span", { class: "chip muted" }, "you"));
  else {
    roleEl = h("select", { class: "input sm", "aria-label": `Role for ${u.email}`, onchange: (e) => changeUser(u, { role: e.target.value }) },
      h("option", { value: "member" }, "Member"), h("option", { value: "admin" }, "Administrator"));
    roleEl.value = u.role;
  }
  return h("div", { class: `row-item static${off ? " off" : ""}` },
    h("span", { class: "cell-name" }, avatar(u.displayName, u.email, 32),
      h("span", { class: "name-wrap" }, h("span", { class: "name" }, u.displayName || u.email.split("@")[0]), h("span", { class: "sub always" }, u.email))),
    h("span", { class: "cell-meta" }, roleEl),
    h("span", { class: "cell-meta" }, off ? h("span", { class: "chip danger" }, "Access removed") : h("span", { class: "status" }, h("i"), "Active")),
    h("span", { class: "cell-act show" }, locked ? null : off
      ? btn("Restore", { icon: "restore", size: "sm", onClick: () => changeUser(u, { status: "active" }) })
      : btn("Remove", { size: "sm", kind: "danger", onClick: () => removeUser(u) })));
}

async function changeUser(u, patch) {
  try { await api("PUT", `/users/${encodeURIComponent(u.email)}`, patch); toast("Saved"); } catch (e) { fail(e); }
  render();
}

async function removeUser(u) {
  if (!await confirmDialog(`${u.displayName || u.email} will be signed out right away and won't be able to sign in. You can restore them later.`,
    { title: "Remove access?", ok: "Remove access", danger: true })) return;
  changeUser(u, { status: "disabled" });
}

// ============================================================================
// Profile + account menu
// ============================================================================
function drawMe() {
  fill($("me"), avatar(me.displayName, me.email, 28),
    h("span", { class: "me-text" }, h("strong", {}, me.displayName || me.email.split("@")[0]), h("span", {}, me.email)), icon("chevronDown", "caret"));
}

async function editProfile(first = false) {
  const name = await promptDialog({
    title: first ? "Welcome! What should we call you?" : "Your profile",
    label: "Display name", value: me.displayName || (first && me.name !== me.email ? me.name : "") || "",
    placeholder: "e.g. Eric", hint: "Shown on your comments, uploads and edits.", ok: "Save",
  });
  if (!name) return;
  try {
    const r = await api("PUT", "/me", { displayName: name });
    me.displayName = r.displayName;
    drawMe();
    toast("Profile saved");
    folderCache.clear(); fileCache.clear();
    render({ quiet: true });
    if (panel.file) openDetails(panel.file.id);
  } catch (e) { fail(e); }
}

// ============================================================================
// Boot
// ============================================================================
function showGate(msg, err = "", { signIn = true } = {}) {
  $("gate").hidden = false;
  if (msg) $("gateMsg").textContent = msg;
  $("gateErr").textContent = err;
  $("gateBtn").textContent = signIn ? "Sign in" : "Sign out";
  $("gateBtn").onclick = signIn ? login : logout;
}

const autoGrow = (ta) => { ta.style.height = "auto"; ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`; };

function wireGlobalEvents() {
  $("me").onclick = (e) => menu(e.currentTarget, [
    { label: "Edit profile", icon: "user", onClick: () => editProfile() },
    { label: "Sign out", icon: "logout", onClick: logout }]);
  $("picker").onchange = (e) => { if (e.target.files.length) uploadFiles(e.target.files); e.target.value = ""; };
  $("composer").onsubmit = postComment;
  $("cText").addEventListener("input", (e) => autoGrow(e.target));
  $("cText").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $("composer").requestSubmit(); } });

  // OS file drag-and-drop anywhere in the window uploads to the current folder.
  let depth = 0;
  const osFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  const showDrop = (on) => {
    $("dropOverlay").hidden = !on;
    if (on) $("dropText").textContent = `Drop to upload to ${folderCache.get(folderId)?.folder?.name ?? "Files"}`;
  };
  addEventListener("dragenter", (e) => { if (!osFiles(e) || parseRoute().view !== "files") return; depth++; showDrop(true); });
  addEventListener("dragleave", (e) => { if (!osFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) showDrop(false); });
  addEventListener("dragover", (e) => { if (osFiles(e)) e.preventDefault(); });
  addEventListener("drop", (e) => {
    if (!osFiles(e)) return;
    e.preventDefault(); depth = 0; showDrop(false);
    if (parseRoute().view === "files" && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });

  // Clicking outside the panel (or a menu) dismisses it. mousedown so that targets re-rendered by
  // their own click handler are still attached. Clicking another file row swaps the panel instead.
  document.addEventListener("mousedown", (e) => {
    if (openMenuEl && !e.target.closest(".menu")) closeMenu();
    if (!$("panel").hidden && !e.target.closest("#panel, .row-item[data-file], dialog, .menu, #tray")) closePanel();
  });
  addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]")) return;
    if (e.key === "Escape") { if (openMenuEl) closeMenu(); else if (!$("panel").hidden) closePanel(); }
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) {
      const s = document.querySelector(".search input");
      if (s) { e.preventDefault(); s.focus(); }
    }
  });
  addEventListener("resize", closeMenu);
  $("main").addEventListener("scroll", closeMenu, { passive: true });
  addEventListener("hashchange", () => render());
}

async function main() {
  hydrateIcons();
  try { await handleCallback(); } catch (e) { return showGate(null, e.message); }
  if (!(await idToken())) return showGate();

  // Fetch identity and the first folder at the same time instead of one after the other.
  const first = /^#\/folder\/([\w-]+)/.exec(location.hash)?.[1] ?? "root";
  const warm = location.hash === "#/trash" || location.hash === "#/members" ? null : fetchFolder(first).catch(() => {});
  try {
    me = await api("GET", "/me");
    me.displayName ||= "";
  } catch (e) {
    if (e.status === 403) return showGate(e.message, "", { signIn: false });
    return showGate(null, e.message);
  }
  await warm;
  $("navMembers").hidden = !me.isAdmin;
  drawMe();
  $("shell").hidden = false;
  wireGlobalEvents();
  render();
  if (!me.displayName) editProfile(true);
}
main();
