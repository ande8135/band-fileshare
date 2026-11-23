import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, BatchGetCommand, ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  CognitoIdentityProviderClient, AdminCreateUserCommand, ListUsersCommand,
  AdminDisableUserCommand, AdminEnableUserCommand, AdminUserGlobalSignOutCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { randomUUID } from "node:crypto";

const NODES = process.env.NODES_TABLE;
const VERSIONS = process.env.VERSIONS_TABLE;
const COMMENTS = process.env.COMMENTS_TABLE;
const PROFILES = process.env.PROFILES_TABLE;
const USERS = process.env.USERS_TABLE;
const BUCKET = process.env.FILES_BUCKET;
const POOL = process.env.USER_POOL_ID;
// Owners: permanent administrators from Terraform (admin_emails). They can't be demoted or removed in the app.
const OWNERS = (process.env.ADMIN_EMAILS || "").split(",").filter(Boolean);
const cognito = new CognitoIdentityProviderClient({});
const EXPIRY = Number(process.env.PRESIGN_EXPIRY || 900);

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
// WHEN_REQUIRED keeps newer SDKs from baking CRC32 checksum params into presigned PUTs.
const s3 = new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED" });

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

// NOTE: this service never performs a hard delete. "Deleting" marks rows status=deleted /
// deletedAt, S3 objects are kept, and the Lambda role has no delete permissions at all.

// ---------- helpers ----------
function cleanName(raw) {
  const name = String(raw ?? "").trim();
  if (!name || name.length > 255) throw new HttpError(400, "Name must be 1-255 characters");
  if (/[\/\\\u0000-\u001f]/.test(name)) throw new HttpError(400, "Name contains invalid characters");
  if (name === "." || name === "..") throw new HttpError(400, "Invalid name");
  return name;
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body;
  try { return JSON.parse(raw); } catch { throw new HttpError(400, "Invalid JSON body"); }
}

function userFrom(event) {
  const c = event.requestContext?.authorizer?.jwt?.claims ?? {};
  const email = c.email ?? "";
  return { id: c.sub, email, name: c.name || email || c.sub, verified: String(c.email_verified) === "true", isAdmin: false };
}

// ---------- access control ----------
// The users table is the source of truth for who may use the app and with which role. It is
// checked on every request, so removing someone takes effect immediately (not when their token expires).
function normEmail(raw) {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!/^[^\s@"\\]+@[^\s@"\\]+\.[^\s@"\\]+$/.test(email) || email.length > 254) throw new HttpError(400, "Invalid email");
  return email;
}

const cognitoUsersByEmail = async (email) =>
  (await cognito.send(new ListUsersCommand({ UserPoolId: POOL, Filter: `email = "${email}"`, Limit: 10 }))).Users ?? [];

async function getUserRec(email) {
  return (await ddb.send(new GetCommand({ TableName: USERS, Key: { email } }))).Item;
}

// People invited before the users table existed only exist in Cognito; adopt them as members.
async function adoptFromCognito(email) {
  const native = (await cognitoUsersByEmail(email)).find((u) => u.UserStatus !== "EXTERNAL_PROVIDER");
  if (!native) return undefined;
  const rec = {
    email, role: "member", status: native.Enabled ? "active" : "disabled",
    invitedBy: "migrated", invitedAt: new Date().toISOString(),
  };
  try {
    await ddb.send(new PutCommand({ TableName: USERS, Item: rec, ConditionExpression: "attribute_not_exists(email)" }));
    return rec;
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return getUserRec(email);
    throw e;
  }
}

async function authorize(user) {
  const email = user.email.toLowerCase();
  if (!email || !user.verified) throw new HttpError(403, "Your email address is not verified");
  user.owner = OWNERS.includes(email);
  if (user.owner) { user.role = "admin"; user.isAdmin = true; return; }
  const rec = (await getUserRec(email)) ?? (await adoptFromCognito(email));
  if (!rec) throw new HttpError(403, "You haven't been invited. Ask an administrator for an invitation.");
  if (rec.status !== "active") throw new HttpError(403, "Your access has been removed. Ask an administrator to restore it.");
  user.role = rec.role;
  user.isAdmin = rec.role === "admin";
}

async function setCognitoEnabled(email, enabled) {
  // Best effort: the users table already blocks the API; this also stops new logins and ends sessions.
  try {
    for (const u of await cognitoUsersByEmail(email)) {
      if (enabled) {
        await cognito.send(new AdminEnableUserCommand({ UserPoolId: POOL, Username: u.Username }));
      } else {
        await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId: POOL, Username: u.Username }));
        await cognito.send(new AdminDisableUserCommand({ UserPoolId: POOL, Username: u.Username }));
      }
    }
  } catch (e) { console.error("cognito sync failed", e); }
}

async function getNode(id) {
  const { Item } = await ddb.send(new GetCommand({ TableName: NODES, Key: { id } }));
  return Item;
}

async function getFile(id) {
  const n = await getNode(id);
  if (!n || n.type !== "file" || n.status === "deleted") throw new HttpError(404, "File not found");
  return n;
}

const emailOf = (user) => (user.email || user.id).toLowerCase();

// Display names live in the profiles table (keyed by lowercase email) and are resolved at read
// time, so a name change shows up on everything the person ever did.
async function displayNames(emails) {
  const uniq = [...new Set(emails.filter(Boolean).map((e) => String(e).toLowerCase()))];
  const names = {};
  for (let i = 0; i < uniq.length; i += 100) {
    let req = { [PROFILES]: { Keys: uniq.slice(i, i + 100).map((email) => ({ email })) } };
    for (let attempt = 0; attempt < 3 && Object.keys(req).length; attempt++) {
      const r = await ddb.send(new BatchGetCommand({ RequestItems: req }));
      for (const p of r.Responses?.[PROFILES] ?? []) names[p.email] = p.displayName;
      req = r.UnprocessedKeys ?? {};
    }
  }
  return names;
}

// pairs: [[emailField, nameField], ...] -> sets item[nameField] when the person has a display name.
async function decorate(items, pairs) {
  const names = await displayNames(items.flatMap((i) => pairs.map(([f]) => i[f])));
  for (const i of items) {
    for (const [f, n] of pairs) {
      const dn = names[String(i[f] ?? "").toLowerCase()];
      if (dn) i[n] = dn;
    }
  }
  return items;
}

async function queryAll(params) {
  const items = [];
  let key;
  do {
    const r = await ddb.send(new QueryCommand({ ...params, ExclusiveStartKey: key }));
    items.push(...(r.Items ?? []));
    key = r.LastEvaluatedKey;
  } while (key);
  return items;
}

const childrenOf = (parentId, filter = true) =>
  queryAll({
    TableName: NODES,
    IndexName: "by-parent",
    KeyConditionExpression: "parentId = :p",
    ...(filter && {
      FilterExpression: "#s = :a",
      ExpressionAttributeNames: { "#s": "status" },
    }),
    ExpressionAttributeValues: { ":p": parentId, ...(filter && { ":a": "active" }) },
  });

async function resolveParent(parentId) {
  if (!parentId || parentId === "root") return { id: "root", ancestors: [] };
  const p = await getNode(parentId);
  if (!p || p.type !== "folder" || p.status !== "active") throw new HttpError(404, "Parent folder not found");
  return { id: p.id, ancestors: [...p.ancestors, { id: p.id, name: p.name }] };
}

async function assertNameFree(parentId, name, type) {
  const siblings = await childrenOf(parentId);
  const clash = siblings.find((s) => s.nameLower === name.toLowerCase());
  if (clash) {
    throw new HttpError(
      409,
      clash.type === "file" && type === "file"
        ? `A file named "${name}" already exists here. Upload it as a new version instead.`
        : `"${name}" already exists in this folder`,
    );
  }
}

const s3Key = (fileId, version) => `files/${fileId}/${version}`;

async function presignPut(fileId, version, contentType) {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: s3Key(fileId, version), ContentType: contentType }),
    { expiresIn: EXPIRY },
  );
}

function contentTypeOf(body) {
  const ct = String(body.contentType || "application/octet-stream");
  if (ct.length > 200 || /[\r\n]/.test(ct)) throw new HttpError(400, "Invalid contentType");
  return ct;
}

// Allocates the next version number and records it as pending until the upload is confirmed.
async function startVersion(file, user, { contentType, size, note, fileName }) {
  const { Attributes } = await ddb.send(new UpdateCommand({
    TableName: NODES,
    Key: { id: file.id },
    UpdateExpression: "ADD versionCounter :one",
    ExpressionAttributeValues: { ":one": 1 },
    ReturnValues: "UPDATED_NEW",
  }));
  const version = Attributes.versionCounter;
  await ddb.send(new PutCommand({
    TableName: VERSIONS,
    Item: {
      fileId: file.id, version, status: "pending", s3Key: s3Key(file.id, version), originalName: fileName,
      contentType, declaredSize: Number(size) || 0, note: note ? String(note).slice(0, 500) : undefined,
      uploadedBy: user.email || user.id, uploadedByName: user.name, uploadedAt: new Date().toISOString(),
    },
  }));
  return { version, uploadUrl: await presignPut(file.id, version, contentType), contentType };
}

// ---------- handlers ----------
async function listFolder(id) {
  let folder = null;
  if (id !== "root") {
    folder = await getNode(id);
    if (!folder || folder.type !== "folder") throw new HttpError(404, "Folder not found");
  }
  const items = await decorate(await childrenOf(id), [["createdBy", "createdByName"], ["updatedBy", "updatedByName"]]);
  return {
    folder,
    breadcrumbs: folder ? [...folder.ancestors, { id: folder.id, name: folder.name }] : [],
    folders: items.filter((i) => i.type === "folder").sort((a, b) => a.nameLower.localeCompare(b.nameLower)),
    files: items.filter((i) => i.type === "file").sort((a, b) => a.nameLower.localeCompare(b.nameLower)),
  };
}

async function createFolder(body, user) {
  const name = cleanName(body.name);
  const parent = await resolveParent(body.parentId);
  await assertNameFree(parent.id, name, "folder");
  const now = new Date().toISOString();
  const item = {
    id: randomUUID(), type: "folder", status: "active", name, nameLower: name.toLowerCase(),
    parentId: parent.id, ancestors: parent.ancestors, createdBy: user.email || user.id, createdAt: now,
  };
  await ddb.send(new PutCommand({ TableName: NODES, Item: item }));
  return json(201, item);
}

async function softDelete(id, type, user) {
  const node = await getNode(id);
  if (!node || node.type !== type || node.status !== "active") throw new HttpError(404, `${type === "file" ? "File" : "Folder"} not found`);
  if (type === "folder" && (await childrenOf(id)).length) {
    throw new HttpError(409, "Folder is not empty. Move its contents to the trash first.");
  }
  await ddb.send(new UpdateCommand({
    TableName: NODES,
    Key: { id },
    ConditionExpression: "#s = :a",
    UpdateExpression: "SET #s = :d, deletedAt = :t, deletedBy = :u",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":a": "active", ":d": "deleted", ":t": new Date().toISOString(), ":u": user.email || user.id },
  }));
  return json(200, { ok: true });
}

async function restore(id, user) {
  const node = await getNode(id);
  if (!node || node.status !== "deleted") throw new HttpError(404, "Nothing to restore");
  if (node.parentId !== "root") {
    const parent = await getNode(node.parentId);
    if (!parent || parent.status !== "active") throw new HttpError(409, "Restore the parent folder first");
  }
  await assertNameFree(node.parentId, node.name, node.type);
  await ddb.send(new UpdateCommand({
    TableName: NODES,
    Key: { id },
    ConditionExpression: "#s = :d",
    UpdateExpression: "SET #s = :a, restoredAt = :t, restoredBy = :u REMOVE deletedAt, deletedBy",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":a": "active", ":d": "deleted", ":t": new Date().toISOString(), ":u": user.email || user.id },
  }));
  return json(200, { ok: true });
}

async function listTrash() {
  const items = await queryAll({
    TableName: NODES,
    IndexName: "by-status",
    KeyConditionExpression: "#s = :d",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":d": "deleted" },
    ScanIndexForward: false,
  });
  await decorate(items, [["deletedBy", "deletedByName"]]);
  return json(200, { items });
}

async function createFile(body, user) {
  const name = cleanName(body.name);
  const contentType = contentTypeOf(body);
  const parent = await resolveParent(body.parentId);
  await assertNameFree(parent.id, name, "file");
  const now = new Date().toISOString();
  const file = {
    id: randomUUID(), type: "file", status: "pending", name, nameLower: name.toLowerCase(),
    parentId: parent.id, ancestors: parent.ancestors, createdBy: user.email || user.id, createdAt: now,
    updatedAt: now, updatedBy: user.email || user.id, contentType, size: 0, versionCounter: 0,
  };
  await ddb.send(new PutCommand({ TableName: NODES, Item: file }));
  const v = await startVersion(file, user, { contentType, size: body.size, note: body.note, fileName: name });
  return json(201, { file, ...v });
}

async function moveFile(id, body, user) {
  const file = await getFile(id);
  if (file.status !== "active") throw new HttpError(409, "File isn't available to move");
  const parent = await resolveParent(body.parentId);
  if (parent.id === file.parentId) throw new HttpError(400, "File is already in that folder");
  await assertNameFree(parent.id, file.name, "file");
  try {
    await ddb.send(new UpdateCommand({
      TableName: NODES,
      Key: { id },
      ConditionExpression: "#s = :a AND parentId = :old",
      UpdateExpression: "SET parentId = :p, ancestors = :anc, movedAt = :t, movedBy = :u",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":a": "active", ":old": file.parentId, ":p": parent.id, ":anc": parent.ancestors,
        ":t": new Date().toISOString(), ":u": user.email || user.id,
      },
    }));
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") throw new HttpError(409, "The file changed while moving. Refresh and try again.");
    throw e;
  }
  return json(200, { ok: true, parentId: parent.id });
}

async function getFileDetail(id) {
  const file = await getFile(id);
  const versions = await queryAll({
    TableName: VERSIONS,
    KeyConditionExpression: "fileId = :f",
    FilterExpression: "#s = :c",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":f": id, ":c": "complete" },
    ScanIndexForward: false,
  });
  await decorate(versions, [["uploadedBy", "uploadedByName"]]);
  return json(200, { file, versions, breadcrumbs: file.ancestors });
}

async function newVersion(id, body, user) {
  const file = await getFile(id);
  const v = await startVersion(file, user, {
    contentType: contentTypeOf(body), size: body.size, note: body.note,
    fileName: body.fileName ? cleanName(body.fileName) : file.name,
  });
  return json(201, v);
}

async function completeVersion(id, version, user) {
  const file = await getFile(id);
  const { Item: ver } = await ddb.send(new GetCommand({ TableName: VERSIONS, Key: { fileId: id, version } }));
  if (!ver) throw new HttpError(404, "Version not found");
  if (ver.status === "complete") return json(200, { ok: true });

  let head;
  try {
    head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: ver.s3Key }));
  } catch {
    throw new HttpError(400, "Upload not found in storage; upload the file first");
  }
  const now = new Date().toISOString();
  await ddb.send(new UpdateCommand({
    TableName: VERSIONS,
    Key: { fileId: id, version },
    UpdateExpression: "SET #s = :c, #z = :z, completedAt = :t",
    ExpressionAttributeNames: { "#s": "status", "#z": "size" },
    ExpressionAttributeValues: { ":c": "complete", ":z": head.ContentLength, ":t": now },
  }));
  try {
    // Only move "current" forward, so out-of-order completions can't regress it.
    await ddb.send(new UpdateCommand({
      TableName: NODES,
      Key: { id },
      ConditionExpression: "(attribute_not_exists(currentVersion) OR currentVersion < :v) AND #s <> :del",
      UpdateExpression:
        "SET currentVersion = :v, #z = :z, contentType = :ct, #s = :a, updatedAt = :t, updatedBy = :u",
      ExpressionAttributeNames: { "#z": "size", "#s": "status" },
      ExpressionAttributeValues: {
        ":v": version, ":z": head.ContentLength, ":ct": ver.contentType, ":a": "active", ":del": "deleted",
        ":t": now, ":u": user.email || user.id,
      },
    }));
  } catch (e) {
    if (e.name !== "ConditionalCheckFailedException") throw e;
  }
  return json(200, { ok: true, version, size: head.ContentLength, name: file.name });
}

async function downloadUrl(id, version) {
  const file = await getFile(id);
  const { Item: ver } = await ddb.send(new GetCommand({ TableName: VERSIONS, Key: { fileId: id, version } }));
  if (!ver || ver.status !== "complete") throw new HttpError(404, "Version not found");
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: ver.s3Key,
      ResponseContentType: ver.contentType,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(ver.originalName || file.name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`,
    }),
    { expiresIn: EXPIRY },
  );
  return json(200, { url });
}

async function listComments(id) {
  await getFile(id);
  const comments = await queryAll({
    TableName: COMMENTS,
    KeyConditionExpression: "fileId = :f",
    FilterExpression: "attribute_not_exists(deletedAt)",
    ExpressionAttributeValues: { ":f": id },
  });
  await decorate(comments, [["author", "authorName"]]);
  return json(200, { comments });
}

async function addComment(id, body, user) {
  await getFile(id);
  const text = String(body.text ?? "").trim();
  if (!text || text.length > 4000) throw new HttpError(400, "Comment must be 1-4000 characters");
  let version;
  if (body.version !== undefined && body.version !== null && body.version !== "") {
    version = Number(body.version);
    const { Item } = await ddb.send(new GetCommand({ TableName: VERSIONS, Key: { fileId: id, version } }));
    if (!Item || Item.status !== "complete") throw new HttpError(400, "Unknown version");
  }
  const now = new Date().toISOString();
  const cid = randomUUID();
  const item = {
    fileId: id, sk: `${now}#${cid}`, id: cid, text, version,
    author: user.email || user.id, authorName: user.name, createdAt: now,
  };
  await ddb.send(new PutCommand({ TableName: COMMENTS, Item: item }));
  return json(201, item);
}

function requireAdmin(user) {
  if (!user.isAdmin) throw new HttpError(403, "Administrators only");
}

const ROLES = ["admin", "member"];

async function invite(body, user) {
  requireAdmin(user);
  const email = normEmail(body.email);
  const role = body.role ?? "member";
  if (!ROLES.includes(role)) throw new HttpError(400, "Invalid role");
  if (OWNERS.includes(email) || (await getUserRec(email))) {
    throw new HttpError(409, `${email} already has an account. Use the user list to change their role or restore access.`);
  }
  try {
    await cognito.send(new AdminCreateUserCommand({
      UserPoolId: POOL,
      Username: email,
      UserAttributes: [{ Name: "email", Value: email }, { Name: "email_verified", Value: "true" }],
      DesiredDeliveryMediums: ["EMAIL"],
    }));
  } catch (e) {
    if (e.name !== "UsernameExistsException") throw e; // already has a password account: just grant access
  }
  await ddb.send(new PutCommand({
    TableName: USERS,
    Item: { email, role, status: "active", invitedBy: user.email, invitedAt: new Date().toISOString() },
    ConditionExpression: "attribute_not_exists(email)",
  }));
  return json(201, { ok: true, email });
}

async function listUsers(user) {
  requireAdmin(user);
  const users = [];
  let key;
  do {
    const r = await ddb.send(new ScanCommand({ TableName: USERS, ExclusiveStartKey: key }));
    users.push(...(r.Items ?? []));
    key = r.LastEvaluatedKey;
  } while (key);
  for (const o of OWNERS) {
    if (!users.some((u) => u.email === o)) users.push({ email: o, role: "admin", status: "active" });
  }
  for (const u of users) if (OWNERS.includes(u.email)) { u.owner = true; u.role = "admin"; u.status = "active"; }
  await decorate(users, [["email", "displayName"]]);
  users.sort((a, b) => a.email.localeCompare(b.email));
  return json(200, { users });
}

async function updateUser(rawEmail, body, user) {
  requireAdmin(user);
  const email = normEmail(rawEmail);
  if (OWNERS.includes(email)) throw new HttpError(409, "Owners are managed in Terraform (admin_emails)");
  if (email === user.email.toLowerCase()) throw new HttpError(409, "You can't change your own access");
  const { role, status } = body;
  if (role === undefined && status === undefined) throw new HttpError(400, "Nothing to change");
  if (role !== undefined && !ROLES.includes(role)) throw new HttpError(400, "Invalid role");
  if (status !== undefined && !["active", "disabled"].includes(status)) throw new HttpError(400, "Invalid status");
  const rec = await getUserRec(email);
  if (!rec) throw new HttpError(404, "User not found");

  const sets = ["updatedAt = :t", "updatedBy = :u"];
  const names = {};
  const vals = { ":t": new Date().toISOString(), ":u": user.email };
  if (role !== undefined) { sets.push("#r = :r"); names["#r"] = "role"; vals[":r"] = role; }
  if (status !== undefined) {
    sets.push("#s = :s"); names["#s"] = "status"; vals[":s"] = status;
    if (status === "disabled") { sets.push("disabledAt = :t"); }
  }
  const { Attributes } = await ddb.send(new UpdateCommand({
    TableName: USERS,
    Key: { email },
    UpdateExpression: `SET ${sets.join(", ")}${status === "active" ? " REMOVE disabledAt" : ""}`,
    ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
    ExpressionAttributeValues: vals,
    ReturnValues: "ALL_NEW",
  }));
  if (status !== undefined && status !== rec.status) await setCognitoEnabled(email, status === "active");
  return json(200, Attributes);
}

async function deleteComment(id, sk, user) {
  await getFile(id);
  const { Item } = await ddb.send(new GetCommand({ TableName: COMMENTS, Key: { fileId: id, sk } }));
  if (!Item || Item.deletedAt) throw new HttpError(404, "Comment not found");
  if (String(Item.author).toLowerCase() !== emailOf(user)) throw new HttpError(403, "You can only delete your own comments");
  await ddb.send(new UpdateCommand({
    TableName: COMMENTS,
    Key: { fileId: id, sk },
    UpdateExpression: "SET deletedAt = :t, deletedBy = :u",
    ExpressionAttributeValues: { ":t": new Date().toISOString(), ":u": user.email || user.id },
  }));
  return json(200, { ok: true });
}

async function getMe(user) {
  const { Item } = await ddb.send(new GetCommand({ TableName: PROFILES, Key: { email: emailOf(user) } }));
  return json(200, { email: user.email, name: user.name, displayName: Item?.displayName, isAdmin: user.isAdmin, role: user.role, owner: user.owner });
}

async function setProfile(body, user) {
  const displayName = String(body.displayName ?? "").trim();
  if (!user.email) throw new HttpError(400, "Your account has no email address");
  if (!displayName || displayName.length > 60 || /[\u0000-\u001f<>]/.test(displayName)) {
    throw new HttpError(400, "Display name must be 1-60 characters and can't contain < or >");
  }
  await ddb.send(new PutCommand({
    TableName: PROFILES,
    Item: { email: emailOf(user), displayName, updatedAt: new Date().toISOString() },
  }));
  return json(200, { displayName });
}

// ---------- router ----------
const routes = [
  ["GET", /^\/me$/, (_, e, u) => getMe(u)],
  ["PUT", /^\/me$/, (_, e, u) => setProfile(parseBody(e), u)],
  ["GET", /^\/trash$/, () => listTrash()],
  ["POST", /^\/(?:files|folders)\/([^/]+)\/restore$/, ([id], e, u) => restore(id, u)],
  ["DELETE", /^\/files\/([^/]+)\/comments\/([^/]+)$/, ([id, sk], e, u) => deleteComment(id, sk, u)],
  ["POST", /^\/invites$/, (_, e, u) => invite(parseBody(e), u)],
  ["GET", /^\/users$/, (_, e, u) => listUsers(u)],
  ["PUT", /^\/users\/([^/]+)$/, ([email], e, u) => updateUser(email, parseBody(e), u)],
  ["GET", /^\/folders\/([^/]+)\/contents$/, ([id]) => listFolder(id)],
  ["POST", /^\/folders$/, (_, e, u) => createFolder(parseBody(e), u)],
  ["DELETE", /^\/folders\/([^/]+)$/, ([id], e, u) => softDelete(id, "folder", u)],
  ["POST", /^\/files$/, (_, e, u) => createFile(parseBody(e), u)],
  ["GET", /^\/files\/([^/]+)$/, ([id]) => getFileDetail(id)],
  ["DELETE", /^\/files\/([^/]+)$/, ([id], e, u) => softDelete(id, "file", u)],
  ["POST", /^\/files\/([^/]+)\/move$/, ([id], e, u) => moveFile(id, parseBody(e), u)],
  ["POST", /^\/files\/([^/]+)\/versions$/, ([id], e, u) => newVersion(id, parseBody(e), u)],
  ["POST", /^\/files\/([^/]+)\/versions\/(\d+)\/complete$/, ([id, v], e, u) => completeVersion(id, Number(v), u)],
  ["GET", /^\/files\/([^/]+)\/versions\/(\d+)\/download$/, ([id, v]) => downloadUrl(id, Number(v))],
  ["GET", /^\/files\/([^/]+)\/comments$/, ([id]) => listComments(id)],
  ["POST", /^\/files\/([^/]+)\/comments$/, ([id], e, u) => addComment(id, parseBody(e), u)],
];

// Normally API Gateway answers preflights itself from its CORS config; this is a safety net
// in case an OPTIONS request is ever routed to the function.
function preflight(event) {
  const origin = event.headers?.origin;
  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",");
  if (!origin || !allowed.includes(origin)) return { statusCode: 403, body: "" };
  return {
    statusCode: 204,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
      "access-control-allow-headers": "authorization,content-type",
      "access-control-max-age": "3600",
    },
  };
}

export async function handler(event) {
  try {
    const method = event.requestContext.http.method;
    if (method === "OPTIONS") return preflight(event);
    const path = event.rawPath.replace(/\/+$/, "") || "/";
    const user = userFrom(event);
    if (!user.id) throw new HttpError(401, "Unauthorized");
    await authorize(user);
    for (const [m, re, fn] of routes) {
      const match = m === method && re.exec(path);
      if (match) return await fn(match.slice(1).map(decodeURIComponent), event, user);
    }
    throw new HttpError(404, "Not found");
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error(e);
    return json(500, { error: "Internal error" });
  }
}
