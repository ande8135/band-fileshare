// Drag a file or folder row onto a folder row or breadcrumb to move it.
import { useState, type DragEvent } from "react";
import type { AnyNode } from "./types";

const DRAG_TYPE = "application/x-vdi-node";
type Payload = Pick<AnyNode, "id" | "type" | "name" | "parentId">;

export const dragProps = (node: AnyNode) => ({
  draggable: true,
  onDragStart: (e: DragEvent) => {
    const payload: Payload = { id: node.id, type: node.type, name: node.name, parentId: node.parentId };
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  },
});

const ours = (e: DragEvent) => [...e.dataTransfer.types].includes(DRAG_TYPE);

/** Props + highlight flag for an element that accepts dropped rows into folder `targetId`. */
export function useDropTarget(targetId: string, onDropNode: (node: Payload, targetId: string) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!ours(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        setOver(false);
        if (!ours(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const node = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as Payload;
        if (node.parentId !== targetId && node.id !== targetId) onDropNode(node, targetId);
      },
    },
  };
}
