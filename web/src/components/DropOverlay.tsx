import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

const hasOsFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");

/** Files dragged in from the computer can be dropped anywhere in the window. */
export function DropOverlay({ enabled, label, onFiles }: { enabled: boolean; label: string; onFiles: (files: File[]) => void }) {
  const [show, setShow] = useState(false);
  const depth = useRef(0);
  const latest = useRef({ enabled, onFiles });
  latest.current = { enabled, onFiles };

  useEffect(() => {
    const enter = (e: DragEvent) => { if (!hasOsFiles(e) || !latest.current.enabled) return; depth.current++; setShow(true); };
    const leave = (e: DragEvent) => { if (!hasOsFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setShow(false); };
    const over = (e: DragEvent) => { if (hasOsFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasOsFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setShow(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (latest.current.enabled && files.length) latest.current.onFiles(files);
    };
    addEventListener("dragenter", enter);
    addEventListener("dragleave", leave);
    addEventListener("dragover", over);
    addEventListener("drop", drop);
    return () => {
      removeEventListener("dragenter", enter);
      removeEventListener("dragleave", leave);
      removeEventListener("dragover", over);
      removeEventListener("drop", drop);
    };
  }, []);

  if (!show) return null;
  return (
    <div id="dropOverlay">
      <div><Icon name="upload" /><p>Drop to upload to {label}</p></div>
    </div>
  );
}
