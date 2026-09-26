# M2-C · 文件、任务与后台操作说明

适用范围：本地 `workers/identity` + `workers/platform`，不是公开 Demo、托管测试网或生产收付款服务。验收源码、实际运行与未测边界见 [M2-C 验收报告](M2-C-STATUS.md)。

## 1. 本地运行

沿用 Node 22.23.2、pnpm 10.34.5 和已提交的锁文件；不升级依赖。完整回归：

```bash
pnpm install --frozen-lockfile
pnpm setup:arc
pnpm verify
```

`verify` 先执行已有回归，再执行 M2-C 的真实本地 D1/R2/Queue broker 和 Chrome 测试。Chrome、中文字体及固定 Playwright 安装沿用 M2-A 测试环境。单独执行 `pnpm test:platform` 只运行后台用例；`pnpm verify:platform` 还运行页面构建、Worker dry-run 与浏览器验收，需要先准备 Chrome 和中文字体。

人工查看后台，使用单独的本地持久化目录：

```bash
pnpm build:identity
pnpm exec wrangler d1 migrations apply arcbox-platform-local \
  --local --config wrangler.platform.jsonc --persist-to .wrangler/platform-local
pnpm dev:platform --persist-to .wrangler/platform-local
```

打开 `http://127.0.0.1:8790/app/operations`。通过页头进入 `/app` 创建工作区和管理成员，然后返回文件、任务与后台。登录仅为 SIWE 身份签名；请使用无真实资产的测试钱包。普通参与者可以没有商家工作区，直接查看自己的通知和订单恢复。

**不得部署 `wrangler.platform.jsonc`。**它包含全零数据库 ID、本地来源校验、仅本地队列名称和阶段性探针开关，不是云端配置模板。不能复用已有 Demo Worker、数据库或钱包作为资金环境。

## 2. 文件状态与版本

当前仅接受代码中两个审核过的纯文本样本 `sample-v1` / `sample-v2`。目录公开固定样本内容；存储和访问通道仍使用私有 R2 绑定和会话权限。用于证明文件访问机制，**不代表已支持真实客户文件或已安装病毒扫描器**。

处理流程：

`创建上传会话 → 验证固定内容 → QUARANTINED → 持久化校验任务 → READY`

- 上传需 owner/editor，且正文上传者必须是创建该上传会话的用户。创建会话使用按用户/工作区隔离的幂等键；重试不会创建第二个文件版本或续期旧会话。
- 只接受固定 MIME、长度和 SHA-256；拒绝 HTML、脚本、压缩正文、额外状态/存储路径字段及任意新哈希。大小硬上限 64 KiB；实际当前目录只有小型文本样本。
- 上传窗口 10 分钟，单工作区最多 100 个版本。R2 使用条件创建，重试不能覆盖既有版本字节。对象内容、元数据与冻结版本再次交叉核验。
- `QUARANTINED` 不表示可下载，也不表示恶意；它表示仍在等待受控内容校验。完整性失败转为 `REJECTED`，不能通过“重试”强制批准。
- 新版本必须建立新记录，旧版本和旧订单绑定不可修改。当前没有删除或自动垃圾回收入口，不会因上传新版破坏旧订单。
- 只有 owner 可冻结 Deliver 本地规则及文件版本；文件 ID、版本、字节哈希和保留期限进入规则哈希，并与绑定在同一 D1 batch 提交。旧 M2-B 规则不能事后补绑文件。

## 3. 下载与撤销

订单业务状态来自 M2-B 已核验事件投影。M2-C 异步任务核对事件指纹、APPLIED 标记、规则哈希和当前订单，产生文件 entitlement；不接受截图、普通等额 Transfer 或管理员“标为已付”。

下载先创建短期凭证，再通过固定 Worker 路径读取文件：

1. 买家申请凭证。凭证有效期取 **60 秒、会话剩余期限、文件访问剩余期限** 的最小值。
2. 令牌只放在响应正文和 `X-ArcBox-Download` 请求头，不放在 URL、日志或浏览器持久存储。数据库仅存令牌哈希。
3. 读取 R2 后再次原子校验订单、退款状态、文件、会话和凭证；单次消费，两个并发下载请求只有一个成功。缺失对象不提前消耗凭证。

文件访问保留期为付款事件时间起 30 天，不因异步任务重试或延迟处理续期。同一订单最多 20 个未消费且未过期的凭证。Range、URL 参数传令牌、其他钱包、其他登录会话、已用/过期凭证均被拒绝。

退款已形成链上投影后，即使撤销 entitlement 的队列尚未追上，也立即拒绝新的下载。暂停的索引来源会关闭新下载，不改变链上退款/领取权。响应强制 attachment、no-store、nosniff 和受限 CSP；不提供公开 R2 地址。

**无法撤回用户已经下载的副本，也不承诺中止已经完成最终权限检查并开始传送的字节。**浏览器“可下载”只作显示提示，实际接口总会重复核验。

## 4. 任务与故障恢复

事件 outbox 先持久化；桥接后只向 Queue 发送 `schema/jobId/generation`，不发送 Cookie、签名、文件正文或下载令牌。处理者从 D1 重新读取受信任来源，不执行任意 URL 或任意任务类型。

任务类型为 `VERIFY_FILE`、`VERIFY_RECEIPT`、`ORDER_PROJECTED`。后者负责文件访问投影和站内通知。任务可以重复送达；效果使用持久 inbox、唯一约束、租约和 D1 原子 batch 去重，不宣称 exactly-once delivery。

- “运行待办任务”只做有界分发：每次最多桥接 20 条 outbox、尝试分发 10 个任务；202 不是任务已执行成功。
- 正常状态：`PENDING → QUEUED → RUNNING → SUCCEEDED`。暂时故障进入 `RETRY`；执行或分发最多 5 次，保留安全错误码，达到上限进入 `DEAD`。
- 租约 60 秒。发送成功后未写回标记、队列丢失重试机会或 Worker 中断，都可由后续有界分发重新发现；重复处理不会重复授予访问或生成通知。
- 队列自身耗尽重试会送至真实死信消费者，写入 `DEAD`。本地交互配置与测试配置的 broker 重试次数不同；测试缩短次数以实际验证死信路径，不代表生产调优结果。
- owner/operator 可手动重试 DEAD 任务；必须提交显示版本的 If-Match。重试增加 generation，旧死信或旧消息不能终结新一代任务。
- `FILE_INTEGRITY_FAILURE` 不能手动放行。恢复临时存储故障后再重试；恢复旧对象必须保持原始字节和哈希，不能把新文件替换进旧订单。
- 上传会话过期后不能用旧上传入口修补对象。若需备份恢复，由独立环境运维流程恢复同版本对象；本阶段未验收云端备份恢复，也不能据此宣称旧订单文件已恢复。

本地配置**没有启用自动 Cron 触发器**。scheduled 处理入口有自动化测试；本地人工演示使用“运行待办任务”和“刷新状态”。托管 Cron、容量、告警和备份恢复在 M2-D 验证。页面不会在后台代签或重复广播付款。

## 5. 后台与权限

| 页面 / 操作 | 权限与行为 |
|---|---|
| 文件版本 | 工作区成员可查看；owner/editor 可导入受控样本与继续自己的上传 |
| 任务与故障 | 成员查看；owner/operator 分发和按版本重试；显示真实任务状态和安全错误码 |
| 我的通知 | 仅当前用户；支持标已读；是历史事件，不等于订单当前状态 |
| 操作日志 | 工作区成员可分页读取；只追加，禁止原地修改；不返回敏感载荷 |
| 订单恢复 | 订单买家或有相应工作区权限的成员；展示当前付款/资金/交付分类，只有买家可以申请下载 |

支持中文/英文、1440/375 宽度、空态/加载/失败/无权限、跨工作区切换和分页。钱包/网络变化、退出登录或确认会话失效会清理私有界面，旧异步响应不能重新填回其他身份的记录。

## 6. API 摘要

以下路径均带 `/api/v1` 前缀。除下载本身为 GET 外，写操作都校验同源和会话 CSRF；错误返回 JSON 与 requestId，不回显底层存储异常。

| 方法与路径 | 输入 / 说明 |
|---|---|
| GET `/files/catalog` | 登录后读取固定受控目录；无目录写接口 |
| POST `/files/upload-sessions` | `{workspaceId,catalogId,seriesId?}` + Idempotency-Key |
| POST `/files/:id/content` | 固定 text/plain 正文，不接受 multipart 或远程 URL |
| POST `/files/:id/complete` | `{}`；持久化校验任务，返回202 |
| GET `/workspaces/:id/files` | 每页25，cursor 为文件ID |
| POST `/workspaces/:id/file-rules` | `{draftId,deploymentId,amountU6,fileId}` + If-Match；本地探针部署须先内部核验登记 |
| GET `/workspaces/:id/jobs` | 每页25，仅返回安全任务字段 |
| POST `/workspaces/:id/jobs/:job/retry` | `{}` + If-Match；只恢复 DEAD |
| GET `/workspaces/:id/operations` | 绑定配置、任务计数和同步故障；不是托管服务健康承诺 |
| POST `/workspaces/:id/operations/run` | `{}`；按工作区有限分发 |
| GET `/workspaces/:id/activity` | 每页25，数字cursor |
| GET `/me/notifications` | 每页25，返回自己的站内通知 |
| POST `/me/notifications/read` | `{id}`；仅修改自己的已读标记 |
| GET `/recovery/:orderId` | 稳定展示字段：paymentState/fundsState/deliveryState/amountU6；原 M2-B 订单详情接口不变 |
| POST `/orders/:id/downloads` | `{}`；单次、限时、会话绑定凭证 |
| GET `/orders/:id/download` | `X-ArcBox-Download` 请求头；禁止 query/Range |

没有公开支付状态写接口、文件强制审批接口、任意任务创建接口或存储路径读取接口。

## 7. 验收证据如何理解

后台测试使用真实本地 D1/R2/Queue broker；链上输入沿用 M2-B 的只读 RPC fixture，并运行真实回执解析、投影和任务效果。真实本地 Arc 回执捕获/回放仍由 M2-B 回归独立执行。

浏览器使用真实 Chrome、真实本地 API/存储/队列及注入的测试登录签名器。付款投影、故障任务和分页记录中需要的种子都在临时本地数据库显式标注；不是测试网交易、真实钱包扩展或正式 Deliver 合约的证据。截图来自上述实际页面，不是概念图。

不包含任意用户文件上传、恶意文件扫描器、外部邮件/Webhook 通知、公开测试网部署/写入、生产资源和独立安全审计。下一子阶段为 **M2-D：D1 云端联调与安全回归**。
