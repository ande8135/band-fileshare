import { useSyncExternalStore } from "react";

export type Route = { view: "files"; id: string } | { view: "trash" } | { view: "members" };

const subscribe = (cb: () => void) => {
  addEventListener("hashchange", cb);
  return () => removeEventListener("hashchange", cb);
};

export function parseRoute(hash: string): Route {
  if (hash === "#/trash") return { view: "trash" };
  if (hash === "#/members") return { view: "members" };
  const m = /^#\/folder\/([\w-]+)/.exec(hash);
  return { view: "files", id: m?.[1] ?? "root" };
}

/** Hash routing: works on S3/CloudFront with no rewrite rules. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return parseRoute(hash);
}

export const folderHref = (id: string) => (id === "root" ? "#/" : `#/folder/${id}`);
