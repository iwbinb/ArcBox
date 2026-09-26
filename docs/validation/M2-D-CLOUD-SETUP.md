# M2-D · 独立云端测试环境配置

日期：2026-09-26。本文是**待执行的配置步骤**，不是部署成功报告。当前阻塞与实际 HTTP 结果见 [M2-D 状态](M2-D-STATUS.md)。本轮未创建测试资源，也未升级付费套餐。

## 1. 用户需要准备的最少配置

### Cloudflare 专用凭证

保留已有 `arcbox_demo` 的凭证和权限，不修改它。为同一个目标 Cloudflare 账号新建仅用于 ArcBox 测试环境的自定义 API Token。建议名称 `ArcBox Testnet`，选择 **Include → Specific account → 运行现有 ArcBox Demo 的账号**。

| Account 权限 | 级别 | 用途 |
|---|---|---|
| Workers Scripts | Edit | 读取/发布测试 Web/API 和 Jobs Worker |
| D1 | Edit | 创建/绑定测试数据库、应用迁移和恢复验证 |
| Workers R2 Storage | Edit | 私有文件桶与测试对象读写 |
| Queues | Edit | 测试队列、消费者与死信配置 |
| Workers Tail | Read | 读取测试 Worker 的实时日志 |

以上名称按 [Cloudflare 官方权限表](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) 核对。不要使用 Global API Key，不授予所有账号、DNS、账单修改或创建其他 Token 的权限。尽量配置合理的到期时间；不要添加与 GitHub 托管执行器出口不匹配的固定 IP 限制。

**账号级 Edit 不等于仅能操作某个 Worker。**它仍可能覆盖同账号的其他相关资源；测试与 Demo 分开存放凭证只是运行流程隔离，不是凭证在 Cloudflare 端的单资源沙箱。后续变更脚本必须限定已审查的 ArcBox 测试资源清单；新建资源后继续评估能否缩窄资源范围。不要把正式生产密钥加入测试环境。

R2 需要账号已有 R2 subscription。若控制台提示未开通，先检查 [官方启用说明](https://developers.cloudflare.com/r2/get-started/) 和结算页面；涉及结算确认由用户完成。当前 403 **不能证明**账号没开 R2，可能只是凭证权限不足。免费用量不是无限免费，不自动开通或升级收费套餐。

### GitHub 受保护环境

进入仓库 **Settings → Environments → New environment**，名称固定为 **`arcbox_testnet`**，不要复用 `arcbox_demo` 或 M0-D 钱包环境。

1. 配置 **Required reviewers**，由用户指定审批者。若唯一审批者和工作流触发者都是 `iwbinb`，不要同时启用 Prevent self-review；否则需另一个有权限的审批者。
2. Deployment branches and tags 选择 **Selected branches and tags**，添加 Branch `dev`。不使用“无保护分支时全允许”的泛化规则，不放行 `main`、PR 合成引用或任意标签。
3. 添加以下 **Environment secrets**（不是聊天消息、文件或前端变量）：

| 名称 | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 上述专用 Token |
| `CLOUDFLARE_ACCOUNT_ID` | 同一目标 Cloudflare 账号的 Account ID |

审批通过前，环境 Secrets 不能提供给作业；具体步骤见 [GitHub 环境保护说明](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)。目前可用连接器没有配置这些管理设置的动作，因此这一步需要仓库拥有者完成。

**先配置环境保护，再打开开关。**不要通过运行工作流自动创建环境；这种环境不会自动拥有审批规则。

### 打开只读预检开关

环境和 Secrets 准备好后，进入 **Settings → Secrets and variables → Actions → Variables**，新增 **Repository variable**：

`ARCBOX_M2D_PREFLIGHT_ENABLED = true`

该变量必须是仓库变量，不能只放在 Environment variables：作业级门禁在进入环境之前求值。开关只允许固定 Cloudflare GET 预检，**不批准资源创建、付费操作、合约部署或转账**。

完成后告知“环境已配置”以及可接受的测试预算；不要发送 Token、钱包私钥或助记词。下一次受保护预检若显示 Waiting for review，由审批者在 Actions 中批准。由于工作流当前只在 dev，新工作流尚未进入默认分支时未必有 Run workflow 按钮；无需因此合并未完成阶段，开发者可通过该工作流声明的 dev 路径变更触发。

## 2. 资源范围与费用：仍待确认/实施

计划沿用架构中的命名；表内资源**尚未创建或确认不存在**：

| 资源 | 候选名称 | 数量 |
|---|---|---|
| Web/API Worker | `arcbox-web-testnet` | 1 |
| Jobs Worker | `arcbox-jobs-testnet` | 1 |
| D1 | `arcbox-db-testnet` | 1 |
| 私有 R2 | `arcbox-private-testnet` | 1 |
| Queue / DLQ | `arcbox-jobs-testnet` / `arcbox-jobs-dlq-testnet` | 各 1 |

实际账号全量清单核验后，已有的匹配资源应先审查，不盲目重复创建或接管未知资源。默认不买域名、不升级套餐、不增加外部付费 RPC/邮件/扫描服务。使用账号实际可用额度，制定低频 Cron、受限测试量及用量阈值；预算数值由用户确认，不能把监控阈值当 Cloudflare 的硬性封顶。

测试资源的建立不等于允许公开任意上传或收款。仍只用受控文件、受邀测试账号；正式工具和主网开关保持关闭。

## 3. 配置到位后的开发顺序

- 重跑固定端点只读预检，获取并核对完整资源清单、目标账号和权限。不把“list 成功”当成“创建/迁移一定成功”。
- 实现独立 testnet 配置、严格环境/资源/ABI 白名单及受保护部署入口；保留本地和 Demo 的既有门禁。**不直接部署 `wrangler.platform.jsonc`**，不简单删除 local-only 检查。
- 经明确资源/费用范围批准后创建或绑定资源，先迁移再部署；Web/API 与 Jobs 职责分离，R2 不公开，Secrets 不进入构建制品。
- 实测 HTTPS、Cookie/CSRF、真实钱包登录/拒签/切链/刷新、权限隔离、R2 文件和访问、Queue/Cron/DLQ、日志与恢复。自动化签名器与真实钱包扩展证据分别记录。
- 测试合约索引需要先核对现有部署、ABI/代码哈希、钱包 nonce 与操作预算。不能照搬旧 M0-D 私钥方案或重播已完成交易；新的公开链写入先按具体范围确认。
- 保存 URL、版本/源码 SHA、资源清单、每个真实测试和恢复结果、成本告警验证。全部满足 M2-D 后才将草稿 PR 改为阶段交付，交由用户合并；不提前进入 M3。

## 4. 不应采用的处理方式

不将现有 Demo Token 扩大权限、不通过复制 Secrets 到聊天诊断、不把权限拒绝改成测试通过、不部署零 ID/localhost 配置、不让失败队列改写链上资金事实、不声称 R2 校验等于病毒扫描。当前无可用连接器管理动作的设置，交给拥有者一次配置；其他可做的代码工作留在 dev。
