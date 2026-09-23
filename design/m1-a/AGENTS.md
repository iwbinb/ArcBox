# Prototype Instructions

M1-A 选定视觉方向：对话中展示的第一张“任务搜索优先”首页稿，项目副本在 `references/home-selected.png`。四类页面使用同一浅色模块化语言；首页布局应忠于该稿，同时工具识别色以仓库 `docs/03-DESIGN-SYSTEM.md` 为准。本目录仅用于视觉基准和交互演示，不能接真实钱包、链上资金或 Cloudflare 资源；正式网站骨架属于 M1-B。

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
