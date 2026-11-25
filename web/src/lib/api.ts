import { cfg } from "./config";
import { clearSession, idToken, login } from "./auth";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const token = await idToken();
  if (!token) {
    void login();
    throw new ApiError("Signing in…", 401);
  }
  const r = await fetch(cfg.apiUrl + path, {
    method,
    headers: { authorization: token, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as { error?: string };
  if (r.status === 401) {
    clearSession();
    void login();
    throw new ApiError("Session expired", 401);
  }
  if (!r.ok) throw new ApiError(data.error ?? `Request failed (${r.status})`, r.status);
  return data as T;
}

/** Uploads straight to S3 with a presigned URL. XHR (not fetch) because fetch has no upload progress. */
export function putFile(url: string, file: Blob, contentType: string, onProgress: (fraction: number) => void): Promise<void> {
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
