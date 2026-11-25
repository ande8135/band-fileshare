import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { makeQueryClient } from "./lib/queries";
import { ToastProvider } from "./components/Toast";
import { MenuProvider } from "./components/Menu";
import { DialogProvider } from "./components/Dialogs";
import { UploadsProvider } from "./components/Uploads";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={makeQueryClient()}>
      <ToastProvider>
        <MenuProvider>
          <DialogProvider>
            <UploadsProvider>
              <App />
            </UploadsProvider>
          </DialogProvider>
        </MenuProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
