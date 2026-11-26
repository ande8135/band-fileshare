import { lazy, Suspense } from "react";
import type { TabViewerProps } from "./TabViewer";

// Separate chunk: alphaTab is only downloaded when a tab is opened.
const TabViewer = lazy(() => import("./TabViewer"));

export function LazyTabViewer(props: TabViewerProps) {
  return (
    <Suspense fallback={<div className="tv-boot" role="status"><span className="tv-spinner" />Opening preview…</div>}>
      <TabViewer {...props} />
    </Suspense>
  );
}
