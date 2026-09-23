# M0-E · 技术验证收口

日期：2026-09-23。**结论：M0-A 至 M0-E 按开发与部署总计划 v1.1 的最小技术探针范围完成，状态 `PASS_SCOPED_TECHNICAL`。**这表示可以开始 M1-A 视觉基准工作；不表示 ArcBox 网站、六工具、Cloudflare 云资源、主网资金或生产安全已交付。本文的仓库审计基线为已合并 `main` 提交 `a48c2052fd96f2b6dd971b42c60aa978cf014e09`；本次收口文档和分支触发范围修正仍须通过 `dev → main` PR 由用户审查合并。

## 1. 证据规则与当前基线

- [已合并 main 的 CI 35871393114](https://github.com/iwbinb/ArcBox/actions/runs/35871393114) 两个 job 均成功，运行源码为 `a48c205`。必需 job 的结构化报告显示：Node 46、workerd 启动 1、D1/R2/Queues/Scheduled 本地绑定 33、Assets 路由 8、Arc 防护 33、Arc 本地执行 8，共 **129 项通过、0 失败、0 跳过/待执行**。静态检查、三份 TypeScript 配置、冻结安装、构建和源文件/锁文件无漂移检查通过。独立只读 job 的原探针 6 项与 SDK 探针 7 项也通过。
- 上述 CI 的 M0-D 报告刻意标为 `PASS_LOCAL_ONLY`、`publicTestnetWrites=NOT_RUN_AUTHORIZATION_REQUIRED`，因为**常驻 CI 没有私钥且不发送交易**。公开测试网写入的唯一证据另见受保护的 [运行 35868308292](https://github.com/iwbinb/ArcBox/actions/runs/35868308292)，执行源码 `a4e3420`；不能把两次不同运行或提交混成一份结果。
- [M0-D 公开测试网验收](M0-D-PUBLIC-TESTNET.md)记录两个最小探针、9 笔交易和 12 项场景。执行后分开的只读回查确认 8 笔成功、1 笔预期失败，实际 Gas 合计 0.039161031 测试 USDC，合约余额与授权为 0。回查使用同一官方 RPC，不宣称独立节点验证。
- 本次 M0-E 再次只读检查 Arc Testnet chainId `5042002`：区块 `63603869`、hash `0x2f69286d888cd6dafd44b99115cdbc49a6b81693478fe1ccd4ac5f239d308a5e` 时，专用钱包余额 `4.960838969` 测试 USDC，确认/待处理 nonce 都为 `9`；两个探针仍有链上代码、原生及 ERC-20 USDC 余额均为 `0`，owner 对探针的 allowance 为 `0`。这是一时点观察，不保证以后余额不变。

## 2. 子阶段判定

| 子阶段 | 判定 | 环境、准确证据与边界 |
|---|---|---|
| M0-A 执行通道与只读探针 | **PASS_CI_READONLY** | 源码 `f1eac018`、[Actions 35820224910](https://github.com/iwbinb/ArcBox/actions/runs/35820224910)：27 项离线 fixture 与 6 项真实测试网只读检查；原容器 DNS 失败保留为历史记录，不算链故障。 |
| M0-B 工具链与 CI | **PASS_CI** | 源码 `febce62a`、[Actions 35825856375](https://github.com/iwbinb/ArcBox/actions/runs/35825856375)：固定 Node/pnpm 与锁文件、46 项 Node、1 项 workerd、构建和编译。最小产物不是产品网站。 |
| M0-C Workers 运行时 | **PASS_LOCAL_CI** | 源码 `11cd2a49`、[Actions 35832021323](https://github.com/iwbinb/ArcBox/actions/runs/35832021323)：D1 事务/CAS/outbox、R2 对象与合成授权、Queues 重放/DLQ、定时处理和 Assets 路由；共 88 项含回归。运行于 CI 的本地 workerd/Miniflare，不是 Cloudflare 账号资源。 |
| M0-D Arc 最小真实兼容 | **PASS_PUBLIC_TESTNET** | 受保护执行源码 `a4e3420`、[Actions 35868308292](https://github.com/iwbinb/ArcBox/actions/runs/35868308292)：两探针、9 笔限定交易、12 项场景及链上回查。执行后加的一次性 nonce 防重跑保护由 `6be012b` 和已合并 `main` 的 CI 验证，没有因此重发交易。 |
| M0-E 证据与风险收口 | **PASS_EVIDENCE_REVIEW** | 本报告逐项回查原 M0 清单、准确 SHA/环境、历史失败、延期项目和合并范围；本报告及 CI 分支清理由本次 `dev → main` PR 的检查单独验证。 |

当前 M0 最小探针范围内 **FAIL 0、BLOCKED 0**。早期失败的 M0-A 容器 DNS、M0-B 首次测试控制和 M0-C 两次绑定/断言集成运行均保留在历史报告，后来在各自准确提交上修复并复验；不删除失败记录，也不把旧失败说成当前通过运行的一部分。

## 3. 原 M0 清单逐项对照

以下对照 [M0-A 历史矩阵](M0-A-STATUS-ARCHIVE.md)及总计划 v1.1 第 3.3 节。`NOT_RUN` 是后续阶段门禁，不能从 M0 的通过推断已完成。

| 原清单项目 | 当前结果 | 证据或后续归属 |
|---|---|---|
| GitHub 设计基线读取；Actions 写入、触发、精确 SHA 与日志 | **PASS** | M0-A 及当前 `main` CI；没有因此获得生产发布能力。 |
| 探针语法、离线 fixture、冻结依赖、构建/编译 | **PASS** | M0-A/B，当前 main 的冻结安装和 129 项回归；构建产物仍是探针。 |
| Arc RPC、USDC 精度/共享余额、SDK 只读 | **PASS_READONLY** | M0-A/B 与当前 main 独立只读 job；单 RPC 的观察有边界。 |
| approve/transfer/transferFrom、双日志、回执、EOA/ERC-1271 最小签名 | **PASS_PUBLIC_TESTNET** | M0-D 受保护运行及独立于执行进程的回查；仅两个最小探针。 |
| D1 batch/CAS/outbox、R2 对象/hash/合成授权、Queues 重放/DLQ/定时 | **PASS_LOCAL_CI** | M0-C 的本地 workerd/Miniflare；真实 Cloudflare 账号中的 D1/R2/Queues **NOT_RUN → D1 部署检查点**。 |
| 完整浏览器钱包、切链/拒签/刷新恢复、生产 SIWE/session/RBAC | **NOT_RUN → M2** | M0-D 的离线签名和 ERC-1271 fixture 不等于多用户产品登录。 |
| 无资金预览网站与 Cloudflare 首次真实部署 | **NOT_RUN → M1-C / D0** | 未创建可访问的产品预览 URL；CI 的 Wrangler dry-run 和 GitHub 环境记录不是 Cloudflare 部署。 |
| 私有 R2 公网访问/预签名、大文件与云端配额/故障恢复 | **NOT_RUN → M2-D / D1** | 本地小型 fixture 不替代云端权限与恢复实测。 |
| 六工具订单、付款/退款/领取、跨工具守恒和产品 UI | **NOT_RUN → M3–M10** | `docs/delivery/02-TEST-AND-ACCEPTANCE.md` 是将来的测试计划；局部探针覆盖不等于其 CORE/SEC/OPS/UI 或六工具用例通过。 |
| 地址冻结、拥堵等无法安全强制复现的公开网边缘状态 | **NOT_RUN / 模型覆盖** | 合成代币与本地 Arc 场景保留；不尝试冻结真实地址，不外推到所有网络行为。 |
| 主网合约、真实资金、独立安全审查与生产放行 | **NOT_RUN → M6 / D2 及对应工具门禁** | M0 使用的全是测试网资源，没有主网交易或审计结论。 |

## 4. 分支、PR 与部署边界

| 范围 | 当前状态 |
|---|---|
| PR #1 | **CLOSED，未合并**。最初只读/DNS 阻塞正文是历史快照；M0-E 给正文添加带日期的当前状态说明，原始内容保留。 |
| PR #2 / #3 | **MERGED**，分别形成 `55bf663` / `ca2a26f`；M0-B/C 历史测试提交可在当前 main 历史中找到。 |
| PR #4 | **CLOSED，未直接合并**；其 M0-D 开发代码经整合进入 dev，再由 PR #5 到 main，不能把草稿 PR 标为已合并。 |
| PR #5 / #6 / #7 | **MERGED**，分别形成 `9a457c7` / `307da49` / `a48c205`；M0-A 至 M0-D 的已审查范围现均包含于 main。 |
| M0-E 本轮 | 从 `a48c205` 安全快进同步 `dev`；仅收口文档、当前工作流分支范围和相应策略断言待本轮 PR 审查合并。不需要恢复已删功能分支、改写历史或再部署探针。 |

GitHub API 显示的三个 `arcbox_testnet` deployment 记录对应 GitHub 环境审批与手动工作流，**不是 Cloudflare 云部署记录**。现有常驻 CI 不读取测试网私钥；`arcbox_testnet` 仅允许 `dev`、需 reviewer 审批，Secret 名称为 `ARCBOX_TESTNET_PRIVATE_KEY`，公开地址为环境 Variable。部署与审批由同一 GitHub 身份完成，不构成独立双人复核。测试钱包剩余测试币仍在用户控制的专用地址中；该钱包 nonce 已用，不可盲目重跑 M0-D。

## 5. 收口结论与下一步

M0 最小技术验证在上述限定范围内 **PASS**，历史差异与后续 `NOT_RUN` 项均有归属。这个决定不放宽资金不变量或任何生产门禁；实际 Cloudflare 账号、完整浏览器钱包、六工具合约、主网资金和审计仍需要各自阶段的证据。

本轮唯一后续子阶段是 **M1-A 视觉基准**：先按产品与页面规格确认首页、创建向导、付款页、后台四类视觉方向，再进入 M1-B 网站骨架；D0 无资金预览在 M1-C 单独验收与部署。
