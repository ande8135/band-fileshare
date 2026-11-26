export function fmtSize(n: number | null | undefined): string {
  if (n == null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i && n < 10 ? 1 : 0)} ${units[i]}`;
}

export const fullDate = (s?: string) =>
  s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";

export function ago(s?: string): string {
  if (!s) return "";
  const d = new Date(s);
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  if (sec < 172800) return "yesterday";
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== new Date().getFullYear() && { year: "numeric" }),
  });
}

export const personName = (name?: string, email?: string) => name || (email ? email.split("@")[0] ?? "" : "");

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export type FileKind = "audio" | "image" | "video" | "notation" | "pdf" | "doc" | "archive" | "other";

const KINDS: [RegExp, FileKind][] = [
  [/^(mp3|wav|flac|aiff?|m4a|ogg|aac|opus)$/, "audio"],
  [/^(png|jpe?g|gif|webp|heic|svg|bmp|tiff?)$/, "image"],
  [/^(mp4|mov|mkv|webm|avi|m4v)$/, "video"],
  [/^(gp|gpx|gp[345]|mscz?|musicxml|mxl|midi?|ptb|tg)$/, "notation"],
  [/^pdf$/, "pdf"],
  [/^(docx?|txt|md|rtf|pages|odt|xlsx?|csv|numbers|pptx?|key)$/, "doc"],
  [/^(zip|rar|7z|tar|gz)$/, "archive"],
];

export function extOf(name: string): string {
  return (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] ?? "").toLowerCase();
}

export function kindOf(name: string): FileKind {
  const ext = extOf(name);
  return KINDS.find(([re]) => re.test(ext))?.[1] ?? "other";
}
