import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const element = document.getElementById("root");
if (!element) throw new Error("ArcBox root element is missing");
const root = createRoot(element);
// Only explicit identity builds expose workspace and operations code.
// The ordinary no-funds Demo keeps its original entry and capability boundary.
const mode = (import.meta as ImportMeta & { env: { MODE: string } }).env.MODE;
if (mode === "identity" && (location.pathname === "/app" || location.pathname.startsWith("/app/"))) {
  const operations = location.pathname === "/app/operations";
  const load = operations
    ? import("./platform/OperationsApp").then(({ OperationsApp }) => <OperationsApp />)
    : import("./identity/WorkspaceApp").then(({ WorkspaceApp }) => <><div style={{padding:"12px 24px",textAlign:"right",fontSize:14}}><a href="/app/operations">文件、任务与后台 / Operations</a></div><WorkspaceApp /></>);
  void load.then(view => root.render(<React.StrictMode>{view}</React.StrictMode>))
    .catch(() => { root.render(<p role="alert">Workspace could not load. Please reload. / 工作区加载失败，请刷新。</p>); });
} else {
  root.render(<React.StrictMode><App /></React.StrictMode>);
}
