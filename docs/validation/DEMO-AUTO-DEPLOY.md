# Demo 预览自动部署

日期：2026-09-24。**配置已准备，自动部署尚未启用，也尚未实测 GitHub 发起的 Cloudflare 部署。**实际状态以本页后续运行证据更新；[M1-C / D0](M1-C-D0.md) 的历史手动部署与回退验收保持原样。

## 固定范围

`dev` 推送触发原有 GitHub Actions 检查。仅当必需回归、Arc 只读、M1-A 原型及 M1-C Demo Worker 四个 job 全部成功时，`demo-deploy` 才可将**同一提交 SHA**发布到既有 `arcbox-web-demo`。PR、`main` 和失败的检查都不能触发此部署；手动运行也只允许在 `dev` 且显式选择 `deploy_demo`。部署前再次读取 `dev` 远端头，较旧的排队运行会跳过。部署后公网健康接口必须回报同一源码 SHA、`environment=demo`、`paymentsEnabled=false`，资金 API 仍为 JSON 404。

GitHub 环境 `arcbox_demo` 已创建，部署分支策略只允许 `dev`。环境中已有 `CLOUDFLARE_ACCOUNT_ID`；Cloudflare API Token 只存为该环境的 `CLOUDFLARE_API_TOKEN` Secret。仓库变量 `ARCBOX_DEMO_DEPLOY_ENABLED` 当前为 `false`，确保令牌配置和运行验证前没有自动发布。工作流只有 Wrangler 上传步骤接收两个 Cloudflare Secret；检查、构建和公网验收步骤不接收令牌。Cloudflare Workers Builds 的 Git 集成不启用，避免两个发布系统同时更新同一 Worker。

## 激活所需的凭证

Cloudflare 的 [GitHub Actions 指引](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)要求非交互部署使用 API Token 和账号 ID。负责人需在当前 Cloudflare 账号创建限定该账号的 **Workers Scripts Edit** Token，并自行保存到 GitHub 环境 `arcbox_demo` 的 `CLOUDFLARE_API_TOKEN`；不要发到聊天或提交到仓库。现有本机 Wrangler OAuth 不复制到 CI。该权限仍是账号级 Worker 写权限，不能声称只可修改 ArcBox 这一个 Worker；不附加 D1、R2、Queues 或 DNS 写权限。

令牌保存后，先核验 Secret 名称和 `dev` 分支策略，再将仓库变量 `ARCBOX_DEMO_DEPLOY_ENABLED` 改为 `true`。在 `dev` 手动运行一次现有 CI 并选择 `deploy_demo=true`，核对四项检查、`demo-deploy` 日志、Cloudflare 版本来源和公网健康接口，再以一次后续 `dev` 推送验证自动触发。未完成这些步骤之前，状态保持**待激活**，不能将已写好的工作流说成自动部署已生效。

## 运行边界

自动发布只更新无资金 Demo Worker；不创建测试网/生产资源，不迁移数据库，不发送链上交易，也不合并 `main`。当前公开网址仍为 [Demo 预览](https://arcbox-web-demo.iwbinb.workers.dev/)。若需回退，在 [D0 报告](M1-C-D0.md)所记版本记录中选择已验证版本；排查期间先关闭仓库部署开关，防止下一次 `dev` 推送再次覆盖回退版本。
