# M2-A · 身份、工作区与权限

2026-09-24。当前候选实现等待本提交实际 CI；没有声明验收通过。更新后的最终证据将在 PR 中绑定准确 SHA。

## 交付范围

- `workers/identity`：与 Demo Worker 隔离的身份与协作 API，固定 Arc Testnet 域/链；不是支付服务。
- SIWE 消息由服务端生成并逐字匹配；5 分钟一次性挑战绑定 HttpOnly 浏览器 cookie；8 小时上限会话。随机 session token 只以哈希存储，退出撤销、登录轮换、CSRF 与同源检查。
- EOA 签名用现有固定 viem；非 EOA 仅支持已部署 ERC-1271 的只读核验，并在每次会话请求重验以处理签名权限撤销。不执行 ERC-6492 factory，不接触用户私钥。
- 工作区创建/选择/改名、owner/editor/operator/viewer；只允许 owner 邀请、更改角色或移除成员。所有者转移不在 v1；受邀钱包必须先登录接受，知道邀请 ID 不足以加入。
- 草稿按工作区隔离，仅 owner/editor 可写；operator/viewer 可读。`If-Match` 乐观版本控制，数据库触发器原子追加版本/审计；冲突不能静默覆盖，也不创建额外 revision。
- 独立 `identity` 构建在 `/app` 提供中英文钱包登录、工作区、邀请/成员、草稿及版本/审计界面。普通 Demo 构建不启用该入口，既有钱包/资金禁用规则不变。

## 执行方式

使用仓库锁定的 Node/pnpm：`pnpm install --frozen-lockfile`；`pnpm setup:arc`；`pnpm verify`。M2-A 会在原有回归之后执行 API/数据库测试、独立身份构建、Worker dry-run 和浏览器回归。测试使用本地 D1，不创建云端资源，不配置新的 Secrets。

本机体验：先 `pnpm build:identity`，执行 `pnpm exec wrangler d1 migrations apply arcbox-identity-local --local --config wrangler.identity.jsonc`，再 `pnpm dev:identity`，打开 `http://127.0.0.1:8789/app`。此 local 配置仅供开发；全零 database_id 是明确本地占位符，不能拿来部署。

身份 API：`/api/v1/auth/nonce`、`/auth/verify`、`/auth/logout`、`/session`、`/workspaces`、`/workspaces/:id/members`、`/workspaces/:id/invitations`、`/invitations/:id/accept`、`/workspaces/:id/drafts`、`/drafts/:id/revisions`、`/workspaces/:id/audit`。POST/PATCH/DELETE 需同源；已登录写请求还需 X-CSRF-Token；版本更新需 `If-Match: "1"` 等。

## 验证范围与真实性

测试覆盖挑战重放/错域/错链/过期、会话固定与注销、CSRF、ERC-1271 撤销的受控 RPC fixture、跨工作区越权、邀请接受/过期/撤销、角色变更、草稿冲突、D1 回滚、不可变审计与无资金接口。

浏览器用 regular Playwright（当前会话没有 Browser plugin），以注入的 EIP-1193 测试签名器操作真实本地 Worker/D1；不是 MetaMask 等真实扩展，也没有公共链交易。截图输出到忽略的 reports，不作为已审核的生产效果图。

## 保留边界

当前没有在 Cloudflare 云端部署身份 Worker、应用生产迁移或接入真实浏览器扩展；这些属于 M2-D/D1 验收。Demo 自动更新仍只发布原无资金 Worker。没有订单、资金 Intent、文件交付、正式工具合约或主网变更；不把 M2-A 当整个 M2 完成。

API 响应、活动日志不返回私钥、签名或 session token；少量会话内的 ERC-1271 签名仅用于重验，随过期会话清理。schema 的 append-only 约束不等于数据库管理员无法更改数据，不宣称第三方审计。

下一子阶段：M2-B 订单与链上同步。等待本阶段 PR 审查后继续。

## 实现依据

[ERC-4361](https://eips.ethereum.org/EIPS/eip-4361)、[Cloudflare D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[Playwright BrowserType](https://playwright.dev/docs/api/class-browsertype)。官方规格不是本实现的安全认证。
