# Demo 预览自动部署

日期：2026-09-24。**GitHub 手动调度的首次成功部署已验收；后续 `dev` 推送自动触发仍待实测。**[M1-C / D0](M1-C-D0.md) 的历史手动部署与回退验收保持原样。

## 固定范围

`dev` 推送触发原有 GitHub Actions 检查。仅当必需回归、Arc 只读、M1-A 原型及 M1-C Demo Worker 四个 job 全部成功时，`demo-deploy` 才可将**同一提交 SHA**发布到既有 `arcbox-web-demo`。PR、`main` 和失败的检查都不能触发此部署；手动运行也只允许在 `dev` 且显式选择 `deploy_demo`。部署前再次读取 `dev` 远端头，较旧的排队运行会跳过。部署后公网健康接口必须回报同一源码 SHA、`environment=demo`、`paymentsEnabled=false`，资金 API 仍为 JSON 404。

GitHub 环境 `arcbox_demo` 已创建，部署分支策略只允许 `dev`。环境中两个 Secret 名称 `CLOUDFLARE_ACCOUNT_ID` 与 `CLOUDFLARE_API_TOKEN` 均已存在，值不能从 GitHub 回读。仓库变量 `ARCBOX_DEMO_DEPLOY_ENABLED` 已设为 `true`。工作流只有 Wrangler 上传步骤接收两个 Cloudflare Secret；检查、构建和公网验收步骤不接收令牌。Cloudflare Workers Builds 的 Git 集成不启用，避免两个发布系统同时更新同一 Worker。

## 激活所需的凭证

Cloudflare 的 [GitHub Actions 指引](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)要求非交互部署使用 API Token 和账号 ID。[首次手动运行 35955954871](https://github.com/iwbinb/ArcBox/actions/runs/35955954871) 的四个检查 job 全部成功，Demo job 也接收到非空的两个 Secret；但 Cloudflare 在读取 `/workers/services/arcbox-web-demo` 时返回 `No access to the specified service`。没有上传新版本，公网健康接口仍报告手动部署源码 `69985bc`。负责人需核对 `CLOUDFLARE_API_TOKEN` 的资源是否为正确账号，权限是否包含 **Account → Workers Scripts → Edit**；必要时更新该 GitHub Environment Secret。不要发到聊天或提交到仓库。现有本机 Wrangler OAuth 不复制到 CI。该权限仍是账号级 Worker 写权限，不能声称只可修改 ArcBox 这一个 Worker；不附加 D1、R2、Queues 或 DNS 写权限。

用户调整权限后，[第二次手动运行 35957693628](https://github.com/iwbinb/ArcBox/actions/runs/35957693628) 的四项检查及 `demo-deploy` 全部成功。Cloudflare 新增活动部署 `c2abe93e-27f1-4da4-a8a5-857b7458c682`，版本 `5170a819-0c0d-4290-80ae-825cbf27a9a0`，消息为 `GitHub dev 7b7494a332578da4cd4bcf232ddba6995a411e93`；公网健康接口独立回读该完整 SHA、`environment=demo`、`paymentsEnabled=false`。**这证明 GitHub 凭证和部署路径可用，但手动调度成功不能替代自动推送验收。**下一步由一个实际 `dev` 推送触发完整 CI 与发布，再记录 GitHub `event=push`、新活动 Worker 版本和公网 SHA。

## 运行边界

自动发布只更新无资金 Demo Worker；不创建测试网/生产资源，不迁移数据库，不发送链上交易，也不合并 `main`。当前公开网址仍为 [Demo 预览](https://arcbox-web-demo.iwbinb.workers.dev/)。若需回退，在 [D0 报告](M1-C-D0.md)所记版本记录中选择已验证版本；排查期间先关闭仓库部署开关，防止下一次 `dev` 推送再次覆盖回退版本。
