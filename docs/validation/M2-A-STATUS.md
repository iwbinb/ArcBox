# M2-A · 身份、工作区与权限

2026-09-24。**PASS_LOCAL_IMPLEMENTATION**：身份 API、D1 协作数据与隔离工作区 UI 已实现，并在 GitHub Linux Runner 的实际本地 Worker/D1 和 Chrome 中验证。尚未部署 Cloudflare 身份后台；不是整个 M2 或生产安全验收。

## 1. 准确版本与证据

完整实现复验源码：`f9853b3a7105e0862323c7ab9ee9c515056bbad8`；[运行 35967225410](https://github.com/iwbinb/ArcBox/actions/runs/35967225410)。必需回归、Arc 只读、M1 原型、Demo 检查、既有 Demo 发布五个 job 均成功。身份报告与四张截图已经下载并回读；截图中的中文字体和桌面/手机布局已检查。

本文件可能随后单独提交文档更新；最后 PR head 与合成合并版本必须另外通过 CI，不把上面的源码 SHA 当成后续提交的实际运行对象。最终 PR 评论记录最新运行和源码，不改写历史报告。

| 检查 | 实际结果与环境 |
|---|---|
| 原有回归 | 135 项通过：Node 52、workerd 1、绑定 33、Assets 8、Arc guards 33、Arc 本地执行 8；没有公开链写入 |
| 新增身份/API/D1 | 55 项通过、0 失败、0 pending；真实本地 Worker/D1，只有外部 ERC-1271 RPC 是受控 fixture |
| 浏览器交互 | 9 个端到端场景通过；真实本地 HTTP API/D1，注入测试 EIP-1193 签名器，不是真实浏览器扩展 |
| 视觉检查 | owner/viewer，1440/375 CSS px，4 张截图；Chrome 153.0.8010.52，Noto Sans CJK SC；无横向溢出 |
| 浏览器错误 | 0 未解释控制台/pageerror；8 个计划内 API 错误响应来自未登录、冲突、越权和失效用例 |
| 类型/构建 | 原有及身份 TypeScript、正常与独立身份 Vite 构建、Worker dry-run 通过 |
| Demo 回归 | 原有 6 项 Demo Worker/Assets 检查通过；身份构建未混入 Demo |
| 依赖/源码 | root pnpm 冻结安装及无漂移检查通过；浏览器测试使用独立 npm 锁文件 |

机器可读证据位于该运行的 `m2-a-evidence-f9853b3a7105e0862323c7ab9ee9c515056bbad8` artifact（ID `10794596794`，保留 7 天），包含 `m2-a.json`、`identity-tests.json`、`identity-browser.json`、`m2-a-owner-1440.png`、`m2-a-owner-375.png`、`m2-a-viewer-1440.png`、`m2-a-viewer-375.png`。没有字体文件、私钥、原始会话 cookie 或云凭证。

## 2. 实现内容

- `workers/identity` 独立于 Demo Worker，只允许明确开启的 local/testnet、固定 Arc Testnet chainId 5042002 与配置域名；身份签名不授权支付。
- SIWE 消息服务端生成并逐字匹配；5 分钟一次性挑战绑定 HttpOnly 浏览器 cookie。会话最长 8 小时、随机 token 只以 SHA-256 存储；退出撤销、登录轮换、CSRF、同源校验、限流和有界输入。
- EOA 签名使用既有固定 viem。非 EOA 仅以限 Gas 的只读调用验证已部署 ERC-1271，合同会话每次请求重新核验，拒绝撤销后的签名；RPC 不可用返回明确失败。没有 ERC-6492 factory、托管用户私钥或任何付款入口。
- 工作区创建/选择/改名 API；owner/editor/operator/viewer；owner 可邀请、调角色、移除成员。受邀地址必须主动签名登录并接受，不以知道邀请 ID 授权。所有者转移不在本版。
- 草稿按工作区隔离；仅 owner/editor 可写，operator/viewer 只读。`If-Match` 版本冲突返回 409；内容、版本和审计由同一 D1 语句/触发器原子提交，失败全回滚。
- 版本历史、归档及分页审计；不允许 API 修改历史审计或旧 revision。成员移除/降权在后续请求生效；写入 SQL 本身再次限定角色。
- 独立 `identity` 构建的 `/app` 提供双语登录、会话、工作区、成员/邀请、草稿、历史和审计。钱包变化清除私有状态，旧请求不得覆盖新身份；取消丢弃保留输入，版本冲突保留输入并要求明确加载新版。

## 3. 复现

使用仓库锁定的 Node 22.23.2 / pnpm 10.34.5：

```bash
pnpm install --frozen-lockfile
pnpm setup:arc
pnpm verify
```

`verify` 在原回归后运行 M2-A 类型、55 项 API/D1 测试、身份页面构建、Worker dry-run 和浏览器测试。`setup:arc` 当前支持 Linux x64；macOS 不应把该本地二进制不可用改成“测试通过”，完整回归以 Linux CI 为准。

浏览器独立测试使用 `tests/identity/browser/package-lock.json` 的 playwright-core 1.55.1，npm ci 且禁用 install scripts。Chrome 来自 Runner，实际版本记录进报告，不声称浏览器版本固定。GitHub Runner 缺中文字体时只安装 Ubuntu `fonts-noto-cjk` 包用于截图；本地需安装 Chrome 和可显示中文的系统字体。不会上传字体文件。

本机身份页面：

```bash
pnpm build:identity
pnpm exec wrangler d1 migrations apply arcbox-identity-local --local --config wrangler.identity.jsonc
pnpm dev:identity
# 浏览器打开 http://127.0.0.1:8789/app
```

`wrangler.identity.jsonc` 的全零 database_id 是明确本地占位符，不是云资源。不要运行该配置的真实部署。正常 Demo 构建不会启用 `/app` 的身份模块，不能以 Demo 上未出现登录后台判断代码没有实现。

## 4. API 契约

统一前缀 `/api/v1`。GET 响应 `{data: ...}`，错误 `{error:{code,requestId}}`；私有接口 `Cache-Control: no-store`。POST/PATCH/DELETE 要求精确 Origin；登录后写请求还需 `X-CSRF-Token`，版本更新需 `If-Match: "1"` 等。

| 方法/路径 | 作用 |
|---|---|
| POST `/auth/nonce`, `/auth/verify`, `/auth/logout` | 发出绑定挑战、签名验证、撤销会话 |
| GET `/session` | 恢复会话及其 CSRF token，不返回原始 session token |
| GET/POST `/workspaces` | 本人工作区列表及创建 |
| GET/PATCH `/workspaces/:id` | 查看/owner 改名，版本受控 |
| GET `/workspaces/:id/members` | 成员列表 |
| PATCH/DELETE `/workspaces/:id/members/:userId` | owner 调角色/移除非 owner 成员 |
| GET/POST `/workspaces/:id/invitations` | owner 管理待接受邀请 |
| DELETE `/workspaces/:id/invitations/:invitationId` | 撤销邀请 |
| GET `/invitations`, POST `/invitations/:id/accept` | 当前钱包查询/接受指定邀请 |
| GET/POST `/workspaces/:id/drafts` | 分页列表/创建草稿 |
| GET/PATCH `/workspaces/:id/drafts/:draftId` | 查看、更新或归档，版本受控 |
| GET `/workspaces/:id/drafts/:draftId/revisions` | 分页版本记录 |
| GET `/workspaces/:id/audit` | 分页工作区审计 |

限额：每钱包 50 个工作区成员关系，每工作区 100 成员、100 有效待接受邀请、500 草稿；邀请 7 天过期。草稿只包含工具类型/名称/说明/版本，不接受金额或已付款状态；不擅自提前实现 M2-B 订单。

## 5. 浏览器实际流程

入口 `/app` → 拒绝一次签名并确认未登录 → 签名登录 → 建工作区 → 通过 Worker/D1 保存草稿 → 刷新恢复（localStorage 无业务数据）→ 另一请求更新造成版本冲突 → 保留原输入并显式读取新版 → 取消丢弃草稿 → owner 桌面/手机截图 → 邀请 viewer → 钱包切换清空身份 → 新钱包接受邀请 → UI 只读且直接 API 写入 403 → viewer 双语/手机截图 → 服务端注销后可见性刷新清空旧私有 UI → 再登录/退出。

首次截图发现 Runner 缺中文字形，未将方框截图当视觉通过；补齐 Runner 字体后重新截图检查。原来仅 7 条场景的历史运行 35966503628 保留，不替代最终增强后的 9 条场景。

## 6. 保留边界与后续检查

**未部署 Cloudflare 身份 Worker、未创建或迁移云端 D1/R2/Queues、未接入真实浏览器扩展进行公开网络端到端验证、未发送公开链交易、未部署工具合约或操作主网。**这些分别在 M2-D/D1 和后续工具阶段验收。既有 Demo 自动流水线继续只发布无资金 Demo，不能复用为资金测试环境。

M2-A 的草稿是基本协作记录，不是完整工具规则编辑器；工具专用字段在对应工具阶段加入。协作视图不是实时推送，其他成员的修改通过刷新、重新选择或后续数据加载读取；写入始终受服务端版本限制。所有者转移、通知、文件、订单仍不在本阶段。

ERC-1271 的外部 RPC fixture 和注入浏览器签名器验证的是当前代码路径，不是某个实际钱包的兼容认证。签名服务失效时合同钱包会话失败关闭；真实扩展/合同钱包浏览器行为、RPC 限额、云端存储配额和完整威胁审阅留 M2-D。数据库 append-only 约束不是管理员不可篡改证明，本实现没有独立第三方安全审计。

下一子阶段：**M2-B 订单与链上同步**。本阶段提交 `dev → main` PR，由用户审查合并后再继续。

## 7. 实现依据

[ERC-4361](https://eips.ethereum.org/EIPS/eip-4361)、[Cloudflare D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[Playwright BrowserType](https://playwright.dev/docs/api/class-browsertype)。官方规格不是本实现的安全认证。
