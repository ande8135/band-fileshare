"use strict";
const cfg = window.APP_CONFIG;
const $ = (id) => document.getElementById(id);

// DOM helper: text is always set via textContent/text nodes, so user content can't inject HTML.
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}
const fmtSize = (n) => {
  if (n == null) return "";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const fmtDate = (s) => (s ? new Date(s).toLocaleString() : "");
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 4000);
}

// ---------------- auth (Cognito hosted UI, authorization code + PKCE) ----------------
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
    throw new Error(/invited|invitation/i.test(d) ? "That email hasn't been invited. Ask an admin for an invite." : "Sign-in failed");
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

async function idToken() {
  let t = store.get();
  if (!t) return null;
  if (jwt(t.id).exp * 1000 - 60000 > Date.now()) return t.id;
  try {
    const r = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh });
    t = { id: r.id_token, refresh: t.refresh };
    store.set(t);
    return t.id;
  } catch { store.clear(); return null; }
}

function logout() {
  store.clear();
  const q = new URLSearchParams({ client_id: cfg.clientId, logout_uri: cfg.redirectUri });
  location.assign(`https://${cfg.cognitoDomain}/logout?${q}`);
}

// ---------------- API ----------------
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

function putFile(url, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("content-type", contentType);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => (x.status < 300 ? resolve() : reject(new Error(`Storage upload failed (${x.status})`)));
    x.onerror = () => reject(new Error("Network error during upload"));
    x.send(file);
  });
}

// ---------------- state ----------------
let folderId = "root";
let openFile = null; // { file, versions }
let comments = [];

let me = { email: "", displayName: "" };
const isTrash = () => location.hash === "#/trash";
const route = () => {
  const m = /^#\/folder\/([\w-]+)/.exec(location.hash);
  return m ? m[1] : "root";
};
const setHead = (...cols) => $("head").replaceChildren(h("tr", {}, cols.map((c) => h("th", {}, c))));
const personName = (name, email) => name || email || "";

// ---------------- folder view ----------------
// ---------------- moving files ----------------
const DRAG_TYPE = "application/x-vdi-file";

// Makes el accept a dragged file row and move that file into folder targetId.
function dropTarget(el, targetId) {
  const ours = (e) => [...(e.dataTransfer?.types ?? [])].includes(DRAG_TYPE);
  el.addEventListener("dragover", (e) => { if (!ours(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; el.classList.add("drop-target"); });
  el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
  el.addEventListener("drop", (e) => {
    el.classList.remove("drop-target");
    if (!ours(e)) return;
    e.preventDefault();
    const f = JSON.parse(e.dataTransfer.getData(DRAG_TYPE));
    if (f.parentId !== targetId) moveFile(f, targetId);
  });
  return el;
}

async function moveFile(f, targetId) {
  try {
    await api("POST", `/files/${f.id}/move`, { parentId: targetId });
    toast(`Moved "${f.name}"`);
    if (openFile?.file.id === f.id) closePanel();
    await refresh();
  } catch (e) { toast(e.message); }
}

let pick = null; // { file, target }
async function openMove() {
  pick = { file: openFile.file, target: openFile.file.parentId };
  $("moveTitle").textContent = `Move “${pick.file.name}”`;
  $("moveDlg").showModal();
  await loadPicker(pick.target);
}

async function loadPicker(id) {
  try {
    const d = await api("GET", `/folders/${id}/contents`);
    pick.target = id;
    const crumbs = $("moveCrumbs");
    crumbs.replaceChildren(h("a", { onclick: () => loadPicker("root") }, "Home"));
    for (const c of d.breadcrumbs) crumbs.append(h("span", {}, "/"), h("a", { onclick: () => loadPicker(c.id) }, c.name));
    const list = $("moveList");
    list.replaceChildren();
    for (const f of d.folders) list.append(h("li", { onclick: () => loadPicker(f.id) }, "📁 " + f.name));
    if (!d.folders.length) list.append(h("li", { class: "muted" }, "No subfolders here."));
    $("moveHere").disabled = id === pick.file.parentId;
  } catch (e) { toast(e.message); }
}

async function confirmMove() {
  const { file, target } = pick;
  $("moveDlg").close();
  await moveFile(file, target);
}

async function loadTrash() {
  closePanel();
  const { items } = await api("GET", "/trash");
  $("crumbs").replaceChildren(h("a", { href: "#/" }, "Home"), h("span", {}, "/"), "Trash");
  $("trashBtn").textContent = "← Back to files";
  $("newFolder").hidden = $("upload").hidden = true;
  setHead("Name", "Was in", "Deleted", "By", "");
  const rows = $("rows");
  rows.replaceChildren();
  for (const n of items) {
    const where = "/" + (n.ancestors || []).map((a) => a.name).join("/");
    rows.append(h("tr", { class: "static" },
      h("td", {}, (n.type === "folder" ? "📁 " : "📄 ") + n.name), h("td", {}, where),
      h("td", {}, fmtDate(n.deletedAt)), h("td", {}, personName(n.deletedByName, n.deletedBy)),
      h("td", { class: "act" }, h("button", { onclick: () => restoreNode(n) }, "Restore"))));
  }
  $("empty").textContent = "Trash is empty.";
  $("empty").hidden = items.length > 0;
}

async function restoreNode(n) {
  try {
    await api("POST", `/${n.type === "folder" ? "folders" : "files"}/${n.id}/restore`);
    toast(`Restored "${n.name}"`);
    await loadTrash();
  } catch (e) { toast(e.message); }
}

async function deleteFolder(f) {
  if (!confirm(`Move folder "${f.name}" to the trash? It must be empty.`)) return;
  try { await api("DELETE", `/folders/${f.id}`); toast("Moved to trash"); await loadFolder(); } catch (e) { toast(e.message); }
}

async function loadFolder() {
  if (isTrash()) return loadTrash();
  $("trashBtn").textContent = "🗑 Trash";
  $("newFolder").hidden = $("upload").hidden = false;
  $("empty").textContent = "Empty folder. Drop files here or use Upload.";
  setHead("Name", "Version", "Size", "Modified", "By", "");
  folderId = route();
  const d = await api("GET", `/folders/${folderId}/contents`);
  const crumbs = $("crumbs");
  crumbs.replaceChildren(dropTarget(h("a", { href: "#/" }, "Home"), "root"));
  for (const c of d.breadcrumbs) crumbs.append(h("span", {}, "/"), dropTarget(h("a", { href: `#/folder/${c.id}` }, c.name), c.id));

  const rows = $("rows");
  rows.replaceChildren();
  for (const f of d.folders) {
    rows.append(dropTarget(h("tr", { onclick: () => { closePanel(); location.hash = `#/folder/${f.id}`; } },
      h("td", {}, "📁 " + f.name), h("td"), h("td"), h("td", {}, fmtDate(f.createdAt)), h("td", {}, personName(f.createdByName, f.createdBy)),
      h("td", { class: "act" }, h("button", { class: "link", title: "Move to trash", onclick: (e) => { e.stopPropagation(); deleteFolder(f); } }, "🗑"))), f.id));
  }
  for (const f of d.files) {
    rows.append(h("tr", { "data-id": f.id, draggable: "true", onclick: () => showFile(f.id), ondragstart: (e) => {
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ id: f.id, name: f.name, parentId: f.parentId }));
        e.dataTransfer.effectAllowed = "move";
      } },
      h("td", {}, "📄 " + f.name), h("td", {}, "v" + f.currentVersion),
      h("td", {}, fmtSize(f.size)), h("td", {}, fmtDate(f.updatedAt)), h("td", {}, personName(f.updatedByName, f.updatedBy)), h("td")));
  }
  $("empty").hidden = d.folders.length + d.files.length > 0;
}

async function refresh() {
  try { await loadFolder(); } catch (e) { toast(e.message); }
}

async function newFolder() {
  const name = prompt("Folder name");
  if (!name) return;
  try { await api("POST", "/folders", { name, parentId: folderId }); await loadFolder(); } catch (e) { toast(e.message); }
}

function trackUpload(label) {
  const bar = h("progress", { max: "1", value: "0" });
  const status = h("span", { class: "muted" }, "Starting…");
  const li = h("li", {}, h("span", {}, label), bar, status);
  $("uploads").append(li);
  return {
    progress: (p) => { bar.value = p; status.textContent = Math.round(p * 100) + "%"; },
    done: () => { status.textContent = "Done"; setTimeout(() => li.remove(), 2500); },
    fail: (e) => { status.textContent = "Failed: " + e.message; },
  };
}

async function uploadNewFile(file) {
  const ui = trackUpload(file.name);
  try {
    const contentType = file.type || "application/octet-stream";
    const r = await api("POST", "/files", { name: file.name, parentId: folderId, contentType, size: file.size });
    await putFile(r.uploadUrl, file, r.contentType, ui.progress);
    await api("POST", `/files/${r.file.id}/versions/${r.version}/complete`);
    ui.done();
  } catch (e) { ui.fail(e); toast(`${file.name}: ${e.message}`); }
}

async function uploadFiles(files) {
  if (isTrash()) return toast("Leave the trash to upload files");
  await Promise.all([...files].map(uploadNewFile));
  await refresh();
}

// ---------------- file panel ----------------
async function showFile(id) {
  const d = await api("GET", `/files/${id}`).catch((e) => { toast(e.message); });
  if (!d) return;
  openFile = d;
  editingSk = null;
  document.querySelectorAll("#rows tr").forEach((tr) => tr.classList.toggle("sel", tr.dataset.id === id));
  $("pName").textContent = d.file.name;
  renderVersions();
  $("panel").hidden = false;
  await loadComments();
}

function closePanel() {
  openFile = null;
  $("panel").hidden = true;
  document.querySelectorAll("#rows tr.sel").forEach((tr) => tr.classList.remove("sel"));
}

function renderVersions() {
  const { file, versions } = openFile;
  const ul = $("versions");
  ul.replaceChildren();
  for (const v of versions) {
    ul.append(h("li", { class: v.version === file.currentVersion ? "cur" : "" },
      h("div", { class: "row" },
        h("strong", {}, `v${v.version}`, v.version === file.currentVersion ? h("span", { class: "badge" }, "current") : null),
        h("button", { onclick: () => download(v.version) }, "Download")),
      h("div", {}, "📎 ", v.originalName || file.name),
      h("div", { class: "muted" }, `${fmtSize(v.size)} · ${fmtDate(v.uploadedAt)} · ${personName(v.uploadedByName, v.uploadedBy)}`),
      v.note ? h("div", {}, v.note) : null));
  }
  const opts = (first) => [first, ...versions.map((v) => h("option", { value: String(v.version) }, `Version ${v.version}`))];
  const prevFilter = $("cFilter").value;
  $("cFilter").replaceChildren(...opts(h("option", { value: "all" }, "All comments")));
  $("cFilter").value = [...$("cFilter").options].some((o) => o.value === prevFilter) ? prevFilter : "all";
  $("cVersion").replaceChildren(...opts(h("option", { value: "" }, "Whole file")));
  $("cVersion").value = String(file.currentVersion);
}

async function download(version) {
  try {
    const { url } = await api("GET", `/files/${openFile.file.id}/versions/${version}/download`);
    location.assign(url);
  } catch (e) { toast(e.message); }
}

async function uploadVersion(file) {
  const id = openFile.file.id;
  const ui = trackUpload(`${openFile.file.name} (new version)`);
  try {
    const contentType = file.type || "application/octet-stream";
    const r = await api("POST", `/files/${id}/versions`, { contentType, fileName: file.name, size: file.size, note: $("verNote").value.trim() });
    await putFile(r.uploadUrl, file, r.contentType, ui.progress);
    await api("POST", `/files/${id}/versions/${r.version}/complete`);
    ui.done();
    $("verNote").value = "";
    await refresh();
    await showFile(id);
  } catch (e) { ui.fail(e); toast(e.message); }
}

async function loadComments() {
  try { comments = (await api("GET", `/files/${openFile.file.id}/comments`)).comments; } catch (e) { toast(e.message); }
  renderComments();
}

function renderComments() {
  const f = $("cFilter").value;
  const ul = $("comments");
  ul.replaceChildren();
  const shown = comments.filter((c) => f === "all" || String(c.version ?? "") === f);
  if (!shown.length) ul.append(h("li", { class: "muted" }, "No comments."));
  for (const c of shown) {
    ul.append(h("li", {},
      h("div", { class: "row" },
        h("div", { class: "muted" }, personName(c.authorName, c.author), " · ", fmtDate(c.createdAt),
          c.version != null ? h("span", { class: "badge" }, "v" + c.version) : h("span", { class: "badge file" }, "file")),
        c.author && c.author.toLowerCase() === me.email.toLowerCase() && editingSk !== c.sk
          ? h("span", {}, h("button", { class: "link", onclick: () => { editingSk = c.sk; renderComments(); } }, "Edit"),
            h("button", { class: "link", onclick: () => removeComment(c) }, "Delete")) : null),
      editingSk === c.sk ? editForm(c) : h("div", { class: "cbody" }, c.text,
        c.editedAt ? h("span", { class: "muted", title: "Edited " + fmtDate(c.editedAt) }, " (edited)") : null)));
  }
}

async function postComment(e) {
  e.preventDefault();
  const text = $("cText").value.trim();
  if (!text) return;
  try {
    const c = await api("POST", `/files/${openFile.file.id}/comments`, { text, version: $("cVersion").value });
    comments.push(c);
    $("cText").value = "";
    renderComments();
  } catch (err) { toast(err.message); }
}

let editingSk = null;

function editForm(c) {
  const ta = h("textarea", { rows: "3", maxlength: "4000" });
  ta.value = c.text;
  const save = async () => {
    const text = ta.value.trim();
    if (!text) return;
    try {
      const u = await api("PUT", `/files/${openFile.file.id}/comments/${encodeURIComponent(c.sk)}`, { text });
      Object.assign(c, u);
      editingSk = null;
      renderComments();
    } catch (e) { toast(e.message); }
  };
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); editingSk = null; renderComments(); }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
  });
  setTimeout(() => ta.focus(), 0);
  return h("div", {}, ta, h("div", { class: "row", style: "margin-top:8px;justify-content:flex-end" },
    h("button", { onclick: () => { editingSk = null; renderComments(); } }, "Cancel"),
    h("button", { class: "primary", onclick: save }, "Save")));
}

async function removeComment(c) {
  if (!confirm("Delete this comment?")) return;
  try {
    await api("DELETE", `/files/${openFile.file.id}/comments/${encodeURIComponent(c.sk)}`);
    comments = comments.filter((x) => x.sk !== c.sk);
    renderComments();
  } catch (e) { toast(e.message); }
}

async function deleteFile() {
  if (!confirm(`Move "${openFile.file.name}" to the trash? You can restore it later.`)) return;
  try { await api("DELETE", `/files/${openFile.file.id}`); closePanel(); toast("Moved to trash"); await loadFolder(); } catch (e) { toast(e.message); }
}

// ---------------- user management (admins) ----------------
async function openUsers() {
  $("usersDlg").showModal();
  await loadUsers();
}

async function loadUsers() {
  try {
    const { users } = await api("GET", "/users");
    const rows = $("userRows");
    rows.replaceChildren();
    for (const u of users) {
      const locked = u.owner || u.email.toLowerCase() === me.email.toLowerCase();
      const off = u.status !== "active";
      const role = locked
        ? h("span", {}, "Administrator", u.owner ? h("span", { class: "badge owner" }, "owner") : null)
        : h("select", { onchange: (e) => changeUser(u, { role: e.target.value }) },
          h("option", { value: "member" }, "Member"), h("option", { value: "admin" }, "Administrator"));
      if (!locked) role.value = u.role;
      rows.append(h("tr", { class: "static" },
        h("td", {}, u.displayName ? h("strong", {}, u.displayName) : null, u.displayName ? h("br") : null, h("span", { class: "muted" }, u.email)),
        h("td", {}, role),
        h("td", {}, off ? h("span", { class: "badge off" }, "removed") : "Active"),
        h("td", { class: "act" }, locked ? null : off
          ? h("button", { onclick: () => changeUser(u, { status: "active" }) }, "Restore")
          : h("button", { class: "danger", onclick: () => removeUser(u) }, "Remove access"))));
    }
  } catch (e) { toast(e.message); }
}

async function changeUser(u, patch) {
  try { await api("PUT", `/users/${encodeURIComponent(u.email)}`, patch); } catch (e) { toast(e.message); }
  await loadUsers();
}

async function removeUser(u) {
  if (!confirm(`Remove access for ${u.displayName || u.email}? They're signed out immediately. You can restore them later.`)) return;
  await changeUser(u, { status: "disabled" });
}

async function inviteUser(e) {
  e.preventDefault();
  const email = $("inviteEmail").value.trim();
  try {
    await api("POST", "/invites", { email, role: $("inviteRole").value });
    toast(`Invitation sent to ${email.toLowerCase()}`);
    $("inviteEmail").value = "";
  } catch (err) { toast(err.message); }
  await loadUsers();
}

// ---------------- profile ----------------
function showProfile(prefill) {
  $("profileEmail").textContent = me.email;
  $("displayName").value = me.displayName || prefill || "";
  $("profileDlg").showModal();
}

async function saveProfile(e) {
  e.preventDefault();
  try {
    const r = await api("PUT", "/me", { displayName: $("displayName").value });
    me.displayName = r.displayName;
    $("who").textContent = me.displayName;
    $("profileDlg").close();
    toast("Profile saved");
    await refresh();
    if (openFile) await showFile(openFile.file.id);
  } catch (err) { toast(err.message); }
}

// ---------------- boot ----------------
async function main() {
  $("loginBtn").onclick = login;
  try { await handleCallback(); } catch (e) { $("loginMsg").textContent = e.message; toast(e.message); }
  const token = await idToken();
  if (!token) { $("login").hidden = false; return; }

  $("logout").onclick = $("deniedOut").onclick = logout;
  try {
    const m = await api("GET", "/me");
    me = { ...m, displayName: m.displayName || "" };
  } catch (e) {
    if (e.status !== 403) { toast(e.message); return; }
    $("deniedMsg").textContent = e.message;
    $("denied").hidden = false;
    return;
  }
  $("who").textContent = me.displayName || me.email;
  $("invite").hidden = !me.isAdmin;
  $("user").hidden = false;
  $("app").hidden = false;
  $("profile").onclick = () => showProfile();
  $("profileForm").onsubmit = saveProfile;
  $("profileCancel").onclick = () => $("profileDlg").close();
  $("trashBtn").onclick = () => { location.hash = isTrash() ? "#/" : "#/trash"; };
  if (!me.displayName) showProfile(me.name !== me.email ? me.name : "");
  $("invite").onclick = openUsers;
  $("usersClose").onclick = () => $("usersDlg").close();
  $("inviteForm").onsubmit = inviteUser;

  $("newFolder").onclick = newFolder;
  $("upload").onclick = () => $("picker").click();
  $("picker").onchange = (e) => { uploadFiles(e.target.files); e.target.value = ""; };
  $("newVer").onclick = () => $("verPicker").click();
  $("verPicker").onchange = (e) => { if (e.target.files[0]) uploadVersion(e.target.files[0]); e.target.value = ""; };
  $("pClose").onclick = closePanel;
  $("cFilter").onchange = renderComments;
  $("cForm").onsubmit = postComment;
  $("delFile").onclick = deleteFile;
  $("moveFile").onclick = openMove;
  $("moveHere").onclick = confirmMove;
  $("moveCancel").onclick = $("moveClose").onclick = () => $("moveDlg").close();

  const drop = $("drop");
  const hasOsFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { if (!hasOsFiles(e)) return; e.preventDefault(); drop.classList.add("over"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, (e) => { if (!hasOsFiles(e)) return; e.preventDefault(); drop.classList.remove("over"); });
  drop.addEventListener("drop", (e) => { if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); });

  // Click outside the side panel dismisses it. mousedown (not click) so targets that get
  // re-rendered by their own click handler are still attached when we check. Clicking another
  // file row is left alone: it swaps the panel's contents.
  document.addEventListener("mousedown", (e) => {
    if ($("panel").hidden) return;
    if (e.target.closest("#panel, #rows tr[data-id], dialog")) return;
    closePanel();
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("panel").hidden && !document.querySelector("dialog[open]")) closePanel();
  });

  addEventListener("hashchange", refresh);
  await refresh();
}
main();
