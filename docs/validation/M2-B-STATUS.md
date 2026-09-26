# M2-B · 订单与链上同步验收

日期：2026-09-26。状态：**共享订单管线已完成本地实现验收；不是托管订单服务或真实收付款产品已上线。**

本阶段在 `dev` 开发，基于已合并 PR #13 的 `main` 提交 `71e4f5c36da5170db3c90da902935d00d10904fe`。没有自动合并 `main`、创建功能分支、强推或丢弃历史；下一子阶段为 **M2-C 文件、任务与后台**。

## 1. 实际验收证据

实现源码：`3c6a5df4d0224c2aaf2c842579c84205de582218`。

实际执行：[GitHub Actions 36212594841](https://github.com/iwbinb/ArcBox/actions/runs/36212594841)。已回读必需检查完整日志，并下载、解析 M2-B 机器报告；报告中的源码 SHA、测试数和真实本地回执捕获摘要一致。本文件是后续文档提交，最终 `dev` head 和 PR 合成合并版本必须分别运行 CI，结果在 PR 验收评论记录，不将本运行冒充后续版本的证据。

| 检查 | 该实现版本的实际结果 |
|---|---|
| 既有 Node、workerd、D1/R2/Queues、Assets、Arc 回归 | 135 项通过 |
| M2-A 身份、工作区与权限 | 55 项通过 |
| M2-B 订单、回执、投影、补扫与恢复 | **73 项通过，0 失败、0 待执行** |
| 上述自动化测试合计 | **263 项通过**，不重复累加多次 CI 运行 |
| M2-A 浏览器回归 | 另计 9 个场景通过；注入测试签名器，不是真实扩展 |
| 原 Demo 路由/绑定 | 另计 6 项通过 |
| 固定依赖安装、类型检查、构建、源码与锁文件无漂移 | 通过 |
| 实际本地 Arc 回执捕获及回放 | 11 笔本地交易，8 个业务事件，2 条完整流程；不是公开测试网交易 |

M2-B artifact：`10895944429`，名称 `m2-b-evidence-3c6a5df4d0224c2aaf2c842579c84205de582218`，ZIP SHA-256 **`bb9496f95e29976735d1dc98e83567b0ac1a65996f8e5082f0d5f24c3a42e444`**。实际下载文件哈希与 GitHub artifact digest 一致。保留期 7 天，过期后可按固定依赖及源码重新执行。

根依赖锁文件 SHA-256 保持 `34f6b3fa03a90cf3437196d5e7831993f89402ef38b6e84a385bc867d057f868`。本阶段没有新增依赖、改动前端页面或修改云资源配置。

## 2. 文件与模块

| 文件 | 责任 |
|---|---|
| `workers/orders/domain.ts` | bigint 金额、类型、状态、规范规则快照、测试适配器 ABI |
| `workers/orders/store.ts` | 不可变规则、幂等订单、受权限约束的交易尝试、只读交易计划 |
| `workers/orders/chain-reader.ts` | 固定 RPC 的只读查询、区块/交易/回执交叉核验、代码哈希和余额检查 |
| `workers/orders/projection.ts` | 业务事件解码、顺序投影、资金分类、账本、outbox、冲突隔离 |
| `workers/orders/sync.ts` | 快速核验、持久化补扫游标、租约、有限重试、历史重放与待处理恢复 |
| `workers/orders/routes.ts` | 复用 M2-A 的身份和权限，不提供签名/广播或“改成已付款”接口 |
| `workers/identity/index.ts` | 接入显式启用的订单路由和本地 scheduled 入口，保留原身份路径 |
| `migrations/0002_orders.sql` | 在 0001 后追加订单表、索引、约束和审计；没有部署名单或真实资金种子 |
| `tests/orders/*` | 实际 Worker/D1 集成、明确 RPC fixtures、真实本地回执回放及失败控制 |
| `probes/orders/OrderEventsProbe.sol` | 仅用于同步验证的本地订单事件合约，不是正式六工具合约 |
| `scripts/m2/capture-order-receipts.mjs` | 新建 loopback Arc 执行器、真实交易捕获、零残留检查 |
| `scripts/m2/verify-orders.mjs` | 验收、源码与回执哈希检查；失败或未执行不显示通过 |
| `vitest.orders.config.ts`、`tsconfig.orders.json` | 隔离运行时和类型检查 |
| `package.json`、`.github/workflows/ci.yml` | 接入必需检查与非敏感报告；保留 Demo 发布门禁 |

没有提交临时依赖导出工作流、私钥、钱包恢复材料、原始会话或 RPC 商业凭证。

## 3. 状态、金额与订单

交易尝试：`QUEUED / PENDING / CONFIRMED / REVERTED / REJECTED / REPLACED`。

订单付款：`UNPAID / CONFIRMED`。批准 USDC、提交 txHash、普通 Transfer 不改变付款状态。

资金归属：`NONE / LOCKED / REFUND_CREDIT / SETTLEMENT_CREDIT / REFUNDED / SETTLED`。可领取 credit 与实际转出分开；退款和结算不能同时终结一笔本金。交付与业务状态独立记录。已确认回执但缺前序事件显示 `PROJECTION_PENDING`；冲突显示 `PROJECTION_QUARANTINED`，不能隐藏成全部完成。

金额作为十进制字符串存储、bigint 运算。拒绝浮点输入、科学计数法、前后空白、多余前导零、超六位小数和 uint256 溢出。原生 18 位与 ERC-20 6 位 USDC 余额核对但不相加；Gas 另行检查。

规则快照固定 schema、链、实例、代币、精度、受益人、工作区、草稿版本、标题说明和金额，规范序列化后计算哈希。草稿修改不影响旧订单；数据库保护约束防止应用误改，但不是针对数据库管理员的密码学防篡改证明。

payer 来自已认证钱包，不信客户端自报金额、付款人或状态。买家无需创建商家工作区。幂等键按用户和操作隔离：相同请求返回原订单，不同请求返回 409；并发相同请求只产生一份订单和审计；重试不延长意图期限。

当前测试适配器意图期限 600 秒、单笔上限 100 USDC，每钱包最多 100 条未确认且未过期订单，每订单最多 32 次交易尝试。这些是本阶段保护值，不是生产资金额度已批准。

## 4. API 与权限

前缀 `/api/v1`，沿用会话、Origin、CSRF、输入大小和限流；私有响应 `no-store`。写入所需权限在原子操作中再次检查。

| 方法与路径 | 行为 |
|---|---|
| `GET /order-rules/:id` | 仅公开 owner 明确冻结的规则快照，不返回客户/尝试/会话 |
| `GET/POST /workspaces/:id/order-rules` | owner；冻结须 If-Match 匹配草稿版本 |
| `POST /orders` | 登录参与者；仅 ruleId 与 Idempotency-Key，无需商家成员资格 |
| `GET /me/orders` | 当前付款钱包的分页记录 |
| `GET /workspaces/:id/orders` | 当前工作区成员，不可跨工作区 |
| `GET /orders/:id`、`GET /orders/:id/ledger` | 付款人或有权成员；分维度状态、版本、事件和账本 |
| `GET /orders/:id/tx-plan?action=approve\|pay` | 仅付款人；校验链/代码/余额/授权/模拟后返回未签名 calldata |
| `POST /orders/:id/transactions` | 付款人或 owner/editor/operator；严格 txHash/purpose，202 不是付款成功 |
| `POST /orders/:id/transactions/:attemptId/refresh` | 同一订单与写权限校验，再执行固定 RPC 核验 |

viewer 不能提交写操作，已移除成员立即失去访问权限。没有部署注册 HTTP 接口、自制回执上传、任意 RPC 代理、管理员余额编辑或服务端钱包入口。重复提交已经确认的提示返回原尝试，不附带与真实状态矛盾的 `paymentConfirmed=false`。

## 5. 回执与同步验证

交易计划固定 `value=0`、精确 allowance，并返回订单、规则哈希、过期时间、模拟区块和 Gas。approve 与 pay 分开模拟；服务端不广播。

快速回执与补扫使用同一读取器和投影器。核对 chain ID、登记实例和代码哈希、交易目标及付款 calldata、receipt 状态、区块哈希、txHash、from/to、transactionIndex、logIndex，以及业务事件的 orderId/payer/nonce/金额/规则/固定受益人。拒绝重复或 removed 日志、歧义 ABI 数据、错误事件与回滚交易中的日志。

只有匹配业务事件能改变订单；原生/代币两种精度 Transfer 不各记一次收入。单一 RPC 的一致性检查不等于独立共识证明，提供者整体遗漏一笔交易时不能凭空证明其存在；多源核验及实际网络运行限制留在托管发布前验收。

### 持久 inbox 与原子应用

先将已验证原始事件和 PENDING 标记在同一 D1 batch 保存。随后在前序齐备、来源有效且版本匹配时，将**订单状态、APPLIED 标记、账本和 ORDER_PROJECTED outbox 同批提交**。使用 CHECK 断言门闩，避免条件 UPDATE 命中 0 行仍继续写入。

原始 inbox 与应用投影不是一个跨阶段大事务。晚到的账本/outbox 故障回滚整个应用步骤，保留原始事件供重试；`drainPending` 不依赖出现下一笔交易。乱序事件等待前序，随后按业务 sequence 与 block/transaction/log 位置收敛。事件/账本追加不改；金额分录精确平衡。

相同事件键内容变化、同一 sequence 冲突、受益人错误或非法终态，会隔离本地索引来源。**本地 HALTED 不会暂停合约提款，也不赋予平台没收用户资金的权限。**

### 游标与资源边界

从部署区块开始扫描；范围持久化且锚点一致才推进游标。短租约避免同时推进；快速 receipt 不推进历史游标。RPC 落后、锚点改变、getLogs 与 receipt 不一致时停止，不覆盖历史账本。

每范围最多 128 区块、64 个业务日志、8 笔相关交易。明确 RPC 范围上限才减半重试；普通网络失败不被误当范围限制。历史 replay 共用验证器但不改前向游标。单区块超限时失败关闭而不跳过；真实流量上线前须验证分片和资源预算。

本地 scheduled 入口需要显式开关，一次最多处理 2 条到期尝试和 1 个来源，没有托管 Cron 配置。自动尝试最多 8 次后保留未确认状态，后续可人工刷新；次数耗尽不是链上失败。outbox 已持久化，但 **Queues 分发、外部通知、DLQ 和运维重放 UI 尚未实施，归 M2-C**。

## 6. 真实本地 Arc 回执证据

捕获脚本不接受 RPC 或私钥参数，只启动新的 loopback Arc 执行器并使用公开 Anvil 测试账户。本地采用 chain ID 5042002，以免回放时篡改域/回执元数据；**它仍然不是公开测试网**。

一次运行真实部署 1 个探针、完成 2 次精确授权及 8 笔业务交易。两条流程分别付款→可用→退款 credit→退款，以及付款→可用→结算 credit→结算。每笔测试订单 0.001 本地 USDC；探针余额和买家残余授权最后均为零。

记录的原始区块/交易/回执作为测试输送层回放，实际 Worker 验证器、订单匹配、D1 事务与投影执行；后续回执反序输入并重复补扫，仍恰好产生一份账本与终态。其他负面场景使用明确标识的 RPC fixtures。捕获成功不能代替投影验收，两者都由 verify 脚本强制检查。

`OrderEventsProbe` 没有正式定价授权、交付证明、退款期、争议条款或经济安全审查，不能作为六工具生产合约。当前 `m2b-probe-v1` 只允许本地模式与显式开关，返回 `intentSigned=false`、`broadcastEnabled=false`，无云端登记实例。正式工具 ABI、quote 签名及资金规则在各工具 M3 以后纵向阶段接入，不把本地探针标为 Live。

## 7. 复现与报告

使用固定 Node 22.23.2、pnpm 10.34.5、锁文件及 Linux x64 Arc 本地执行器：

```bash
pnpm install --frozen-lockfile
pnpm setup:arc
pnpm verify:orders  # 类型、真实本地回执捕获、Worker/D1 回放与证据检查
pnpm verify         # 完整回归与 M2-A 浏览器验证
```

`pnpm test:orders` 也会先生成本轮真实本地回执。`verify:orders` 校验 EVM-REPLAY 用例实际执行、源码 SHA、capture SHA、交易/事件/流程数和零残留，不接受旧版本证据。

CI 上传 `reports/m2-b.json`、`reports/orders-tests.json`、`reports/order-evm-summary.json` 三个非敏感报告。原始 capture 仅存运行时，不进 Git 或 artifact。M2-A 截图单独保留；M2-B 没有新前端页面，因此不以旧截图冒充订单 UI 交付。

早期完整运行在 nullable receipt 类型检查处失败，修复后重新运行。首个完整候选通过 71 项，后增加严格请求类型与重复已确认提示两项回归，当前为 73 项。失败历史保留，没有跳过断言、放宽标准或沿用旧运行冒充当前通过。

## 8. 部署边界与下一阶段

没有部署新身份/订单 Worker、创建云端 D1/R2/Queues、应用远端迁移、操作用户钱包、广播公开链交易或触碰主网。既有 `dev` Demo 自动部署规则不变：四项检查通过才更新同一版本，PR/`main` 不发布。Demo 仍无真实身份、订单或支付能力。

M2-D / D1 检查点仍需独立云资源、迁移/备份、真实扩展、实时索引容量和最小测试合约联调；资金规则、安全审查与小额主网授权另行确认。263 项通过不等于安全审计或六工具产品全部完成。

审查合并阶段 PR、保留 `dev` 后，下一子阶段是 **M2-C 文件、任务与后台**。本轮不提前开发文件权益、Queue 发送、通知或六工具收付款页面。
