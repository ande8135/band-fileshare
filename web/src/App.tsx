import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { handleCallback, idToken } from "./lib/auth";
import { api, ApiError } from "./lib/api";
import { folderQuery, meQuery, qk } from "./lib/queries";
import { parseRoute, useRoute } from "./lib/route";
import { PanelCtx, type PanelState } from "./lib/panel";
import type { FileNode, FolderContents, Me } from "./lib/types";
import { Gate } from "./components/Gate";
import { Sidebar } from "./components/Sidebar";
import { DetailsPanel } from "./components/DetailsPanel";
import { DropOverlay } from "./components/DropOverlay";
import { useDialogs } from "./components/Dialogs";
import { useFail, useToast } from "./components/Toast";
import { useUploads } from "./components/Uploads";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FilesPage } from "./pages/FilesPage";
import { TrashPage } from "./pages/TrashPage";
import { MembersPage } from "./pages/MembersPage";

type Boot = { phase: "loading" } | { phase: "signedOut"; error?: string } | { phase: "ready" };

// Runs once per page load. (StrictMode runs effects twice in dev; a second run would try to
// redeem the same one-time sign-in code.)
let booting: Promise<Boot> | null = null;
function bootOnce(): Promise<Boot> {
  booting ??= (async (): Promise<Boot> => {
    try {
      await handleCallback();
    } catch (e) {
      return { phase: "signedOut", error: e instanceof Error ? e.message : String(e) };
    }
    return (await idToken()) ? { phase: "ready" } : { phase: "signedOut" };
  })();
  return booting;
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ phase: "loading" });
  const qc = useQueryClient();

  useEffect(() => {
    let live = true;
    void bootOnce().then((b) => {
      if (!live) return;
      // Fetch the first folder alongside /me rather than after it.
      const r = parseRoute(location.hash);
      if (b.phase === "ready" && r.view === "files") void qc.prefetchQuery(folderQuery(r.id));
      setBoot(b);
    });
    return () => { live = false; };
  }, [qc]);

  if (boot.phase === "loading") return null;
  if (boot.phase === "signedOut") return <Gate error={boot.error} />;
  return <SignedIn />;
}

function SignedIn() {
  const { data: me, error } = useQuery(meQuery);
  if (error) {
    return error instanceof ApiError && error.status === 403
      ? <Gate message={error.message} signIn={false} />
      : <Gate error={error.message} />;
  }
  if (!me) return null;
  return <Shell me={me} />;
}

function Shell({ me }: { me: Me }) {
  const route = useRoute();
  const qc = useQueryClient();
  const dialogs = useDialogs();
  const toast = useToast();
  const fail = useFail();
  const uploads = useUploads();
  const main = useRef<HTMLElement>(null);
  const [panel, setPanel] = useState<{ id: string; seed?: FileNode } | null>(null);

  const close = useCallback(() => setPanel(null), []);
  const panelApi = useMemo<PanelState>(() => ({
    openId: panel?.id ?? null,
    open: (id, seed) => setPanel({ id, seed }),
    close,
  }), [panel?.id, close]);

  const view = route.view === "members" && !me.isAdmin ? { view: "files" as const, id: "root" } : route;
  const routeKey = view.view === "files" ? `files:${view.id}` : view.view;

  useEffect(() => { main.current?.scrollTo({ top: 0 }); }, [routeKey]);

  const editProfile = useCallback(async (first = false) => {
    const name = await dialogs.prompt({
      title: first ? "Welcome! What should we call you?" : "Your profile",
      label: "Display name",
      value: me.displayName || (first && me.name && me.name !== me.email ? me.name : ""),
      placeholder: "e.g. Eric",
      hint: "Shown on your comments, uploads and edits.",
    });
    if (!name) return;
    try {
      await api("PUT", "/me", { displayName: name });
      toast("Profile saved");
      await qc.invalidateQueries(); // names appear everywhere
    } catch (e) { fail(e); }
  }, [dialogs, me, qc, toast, fail]);

  // First sign-in: ask for a display name once.
  const asked = useRef(false);
  useEffect(() => {
    if (!me.displayName && !asked.current) { asked.current = true; void editProfile(true); }
  }, [me.displayName, editProfile]);

  const currentFolder = view.view === "files" ? view.id : "root";
  const folderName = qc.getQueryData<FolderContents>(qk.folder(currentFolder))?.folder?.name ?? "Files";

  return (
    <PanelCtx.Provider value={panelApi}>
      <div id="shell">
        <Sidebar me={me} route={view} onEditProfile={() => void editProfile()} />
        <main id="main" ref={main}>
          <div id="view">
            <ErrorBoundary resetKey={routeKey}>
              {view.view === "files" && <FilesPage key={view.id} folderId={view.id} />}
              {view.view === "trash" && <TrashPage />}
              {view.view === "members" && <MembersPage me={me} />}
            </ErrorBoundary>
          </div>
        </main>
      </div>
      {panel && (
        <ErrorBoundary resetKey={panel.id} wrap={(fallback) => (
          <aside id="panel" aria-label="File details">
            <div className="p-head"><div className="p-title" /><button className="btn ghost icon-only" aria-label="Close" onClick={close}>✕</button></div>
            {fallback}
          </aside>
        )}>
          <DetailsPanel key={panel.id} id={panel.id} seed={panel.seed} me={me} />
        </ErrorBoundary>
      )}
      <DropOverlay enabled={view.view === "files"} label={folderName} onFiles={(files) => void uploads.uploadFiles(files, currentFolder)} />
    </PanelCtx.Provider>
  );
}
