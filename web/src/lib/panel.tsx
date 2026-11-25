import { createContext, useContext } from "react";
import type { FileNode } from "./types";

export interface PanelState {
  openId: string | null;
  open: (id: string, seed?: FileNode) => void;
  close: () => void;
}
export const PanelCtx = createContext<PanelState>({ openId: null, open: () => {}, close: () => {} });
export const usePanel = () => useContext(PanelCtx);
