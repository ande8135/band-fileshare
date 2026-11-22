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
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
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

const route = () => {
  const m = /^#\/folder\/([\w-]+)/.exec(location.hash);
  return m ? m[1] : "root";
};

// ---------------- folder view ----------------
async function loadFolder() {
  folderId = route();
  const d = await api("GET", `/folders/${folderId}/contents`);
  const crumbs = $("crumbs");
  crumbs.replaceChildren(h("a", { href: "#/" }, "Home"));
  for (const c of d.breadcrumbs) crumbs.append(h("span", {}, "/"), h("a", { href: `#/folder/${c.id}` }, c.name));

  const rows = $("rows");
  rows.replaceChildren();
  for (const f of d.folders) {
    rows.append(h("tr", { onclick: () => { closePanel(); location.hash = `#/folder/${f.id}`; } },
      h("td", {}, "📁 " + f.name), h("td"), h("td"), h("td", {}, fmtDate(f.createdAt)), h("td", {}, f.createdBy)));
  }
  for (const f of d.files) {
    rows.append(h("tr", { "data-id": f.id, onclick: () => showFile(f.id) },
      h("td", {}, "📄 " + f.name), h("td", {}, "v" + f.currentVersion),
      h("td", {}, fmtSize(f.size)), h("td", {}, fmtDate(f.updatedAt)), h("td", {}, f.updatedBy)));
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
  await Promise.all([...files].map(uploadNewFile));
  await refresh();
}

// ---------------- file panel ----------------
async function showFile(id) {
  const d = await api("GET", `/files/${id}`).catch((e) => { toast(e.message); });
  if (!d) return;
  openFile = d;
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
      h("div", { class: "muted" }, `${fmtSize(v.size)} · ${fmtDate(v.uploadedAt)} · ${v.uploadedBy}`),
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
    const r = await api("POST", `/files/${id}/versions`, { contentType, size: file.size, note: $("verNote").value.trim() });
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
      h("div", { class: "muted" }, c.authorName || c.author, " · ", fmtDate(c.createdAt),
        c.version != null ? h("span", { class: "badge" }, "v" + c.version) : h("span", { class: "badge file" }, "file")),
      h("div", { class: "cbody" }, c.text)));
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

async function deleteFile() {
  if (!confirm(`Delete "${openFile.file.name}" and all its versions and comments?`)) return;
  try { await api("DELETE", `/files/${openFile.file.id}`); closePanel(); await loadFolder(); } catch (e) { toast(e.message); }
}

// ---------------- boot ----------------
async function main() {
  $("loginBtn").onclick = login;
  try { await handleCallback(); } catch (e) { toast(e.message); }
  const token = await idToken();
  if (!token) { $("login").hidden = false; return; }

  const claims = jwt(token);
  $("who").textContent = claims.email || claims.name || "";
  $("user").hidden = false;
  $("app").hidden = false;
  $("logout").onclick = logout;

  $("newFolder").onclick = newFolder;
  $("upload").onclick = () => $("picker").click();
  $("picker").onchange = (e) => { uploadFiles(e.target.files); e.target.value = ""; };
  $("newVer").onclick = () => $("verPicker").click();
  $("verPicker").onchange = (e) => { if (e.target.files[0]) uploadVersion(e.target.files[0]); e.target.value = ""; };
  $("pClose").onclick = closePanel;
  $("cFilter").onchange = renderComments;
  $("cForm").onsubmit = postComment;
  $("delFile").onclick = deleteFile;

  const drop = $("drop");
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); });
  drop.addEventListener("drop", (e) => { if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); });

  addEventListener("hashchange", refresh);
  await refresh();
}
main();
