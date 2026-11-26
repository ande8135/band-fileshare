// Query definitions. TanStack Query gives us what the old app hand-rolled: cached listings
// that render instantly and revalidate in the background, request de-duplication, prefetch.
import { QueryClient, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import type { FileDetail, FolderContents, Me, Member, TrashItem } from "./types";

export const qk = {
  me: ["me"] as const,
  folder: (id: string) => ["folder", id] as const,
  file: (id: string) => ["file", id] as const,
  trash: ["trash"] as const,
  users: ["users"] as const,
};

export const meQuery = { queryKey: qk.me, queryFn: () => api<Me>("GET", "/me"), retry: false } as const;

export const folderQuery = (id: string) => ({
  queryKey: qk.folder(id) as QueryKey,
  queryFn: () => api<FolderContents>("GET", `/folders/${id}/contents`),
});

export const fileQuery = (id: string) => ({
  queryKey: qk.file(id) as QueryKey,
  queryFn: () => api<FileDetail>("GET", `/files/${id}?include=comments`),
});

export const trashQuery = { queryKey: qk.trash, queryFn: () => api<{ items: TrashItem[] }>("GET", "/trash") };
export const usersQuery = { queryKey: qk.users, queryFn: () => api<{ users: Member[] }>("GET", "/users") };

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000, // a prefetch on hover is still fresh when the click lands
        gcTime: 30 * 60_000, // keep folders around so going back is instant
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      },
    },
  });
}

/** Warms a folder listing (hover/press on a folder row). */
export function usePrefetchFolder() {
  const qc = useQueryClient();
  return (id: string) => void qc.prefetchQuery({ ...folderQuery(id), staleTime: 15_000 });
}
