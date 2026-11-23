import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand,
  QueryCommand, DeleteCommand, BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { CognitoIdentityProviderClient, AdminCreateUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import { randomUUID } from "node:crypto";

const NODES = process.env.NODES_TABLE;
const VERSIONS = process.env.VERSIONS_TABLE;
const COMMENTS = process.env.COMMENTS_TABLE;
const BUCKET = process.env.FILES_BUCKET;
const POOL = process.env.USER_POOL_ID;
const ADMINS = (process.env.ADMIN_EMAILS || "").split(",").filter(Boolean);
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
  const isAdmin = ADMINS.includes(email.toLowerCase()) && String(c.email_verified) === "true";
  return { id: c.sub, email, name: c.name || email || c.sub, isAdmin };
}

async function getNode(id) {
  const { Item } = await ddb.send(new GetCommand({ TableName: NODES, Key: { id } }));
  return Item;
}

async function getFile(id) {
  const n = await getNode(id);
  if (!n || n.type !== "file") throw new HttpError(404, "File not found");
  return n;
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
  if (!p || p.type !== "folder") throw new HttpError(404, "Parent folder not found");
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

async function batchDelete(table, keys) {
  for (let i = 0; i < keys.length; i += 25) {
    let req = { [table]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })) };
    for (let attempt = 0; attempt < 5 && Object.keys(req).length; attempt++) {
      const r = await ddb.send(new BatchWriteCommand({ RequestItems: req }));
      req = r.UnprocessedItems ?? {};
    }
  }
}

// Allocates the next version number and records it as pending until the upload is confirmed.
async function startVersion(file, user, { contentType, size, note }) {
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
      fileId: file.id, version, status: "pending", s3Key: s3Key(file.id, version),
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
  const items = await childrenOf(id);
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

async function deleteFolder(id) {
  const folder = await getNode(id);
  if (!folder || folder.type !== "folder") throw new HttpError(404, "Folder not found");
  if ((await childrenOf(id, false)).length) throw new HttpError(409, "Folder is not empty");
  await ddb.send(new DeleteCommand({ TableName: NODES, Key: { id } }));
  return json(200, { ok: true });
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
  const v = await startVersion(file, user, { contentType, size: body.size, note: body.note });
  return json(201, { file, ...v });
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
  return json(200, { file, versions, breadcrumbs: file.ancestors });
}

async function newVersion(id, body, user) {
  const file = await getFile(id);
  const v = await startVersion(file, user, {
    contentType: contentTypeOf(body), size: body.size, note: body.note,
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
      ConditionExpression: "attribute_not_exists(currentVersion) OR currentVersion < :v",
      UpdateExpression:
        "SET currentVersion = :v, #z = :z, contentType = :ct, #s = :a, updatedAt = :t, updatedBy = :u",
      ExpressionAttributeNames: { "#z": "size", "#s": "status" },
      ExpressionAttributeValues: {
        ":v": version, ":z": head.ContentLength, ":ct": ver.contentType, ":a": "active",
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
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`,
    }),
    { expiresIn: EXPIRY },
  );
  return json(200, { url });
}

async function deleteFile(id) {
  await getFile(id);
  const versions = await queryAll({
    TableName: VERSIONS, KeyConditionExpression: "fileId = :f", ExpressionAttributeValues: { ":f": id },
  });
  for (let i = 0; i < versions.length; i += 1000) {
    await s3.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: versions.slice(i, i + 1000).map((v) => ({ Key: v.s3Key })), Quiet: true },
    }));
  }
  await batchDelete(VERSIONS, versions.map((v) => ({ fileId: id, version: v.version })));
  const comments = await queryAll({
    TableName: COMMENTS, KeyConditionExpression: "fileId = :f", ExpressionAttributeValues: { ":f": id },
  });
  await batchDelete(COMMENTS, comments.map((c) => ({ fileId: id, sk: c.sk })));
  await ddb.send(new DeleteCommand({ TableName: NODES, Key: { id } }));
  return json(200, { ok: true });
}

async function listComments(id) {
  await getFile(id);
  const comments = await queryAll({
    TableName: COMMENTS, KeyConditionExpression: "fileId = :f", ExpressionAttributeValues: { ":f": id },
  });
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

async function invite(body, user) {
  if (!user.isAdmin) throw new HttpError(403, "Admins only");
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new HttpError(400, "Invalid email");
  try {
    await cognito.send(new AdminCreateUserCommand({
      UserPoolId: POOL,
      Username: email,
      UserAttributes: [{ Name: "email", Value: email }, { Name: "email_verified", Value: "true" }],
      DesiredDeliveryMediums: ["EMAIL"],
    }));
  } catch (e) {
    if (e.name === "UsernameExistsException") throw new HttpError(409, `${email} already has access`);
    throw e;
  }
  return json(201, { ok: true, email });
}

// ---------- router ----------
const routes = [
  ["GET", /^\/me$/, (_, e, u) => json(200, { email: u.email, name: u.name, isAdmin: u.isAdmin })],
  ["POST", /^\/invites$/, (_, e, u) => invite(parseBody(e), u)],
  ["GET", /^\/folders\/([^/]+)\/contents$/, ([id]) => listFolder(id)],
  ["POST", /^\/folders$/, (_, e, u) => createFolder(parseBody(e), u)],
  ["DELETE", /^\/folders\/([^/]+)$/, ([id]) => deleteFolder(id)],
  ["POST", /^\/files$/, (_, e, u) => createFile(parseBody(e), u)],
  ["GET", /^\/files\/([^/]+)$/, ([id]) => getFileDetail(id)],
  ["DELETE", /^\/files\/([^/]+)$/, ([id]) => deleteFile(id)],
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
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
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
