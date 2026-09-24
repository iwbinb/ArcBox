import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const element = document.getElementById("root");
if (!element) throw new Error("ArcBox root element is missing");
const root = createRoot(element);
// Only the explicitly selected identity build exposes the M2-A workspace.
// Normal and Demo builds keep the existing no-wallet experience unchanged.
const mode = (import.meta as ImportMeta & { env: { MODE: string } }).env.MODE;
if (mode === "identity" && (location.pathname === "/app" || location.pathname.startsWith("/app/"))) {
  void import("./identity/WorkspaceApp").then(({ WorkspaceApp }) => {
    root.render(<React.StrictMode><WorkspaceApp /></React.StrictMode>);
  }).catch(() => { root.render(<p role="alert">Workspace could not load. Please reload. / 工作区加载失败，请刷新。</p>); });
} else {
  root.render(<React.StrictMode><App /></React.StrictMode>);
}
