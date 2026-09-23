# M0 技术验证 · 当前进度

2026-09-23。**M0 按 v1.1 的限定技术探针范围完成；[M0-E 收口报告](M0-E-CLOSURE.md)列明后续 `NOT_RUN` 项。**本状态为分阶段证据索引，历史结果不覆盖为新版本结果。M0-E 的文档及 CI 分支整理仍在 `dev`，经 PR 审查后才进入 `main`；技术基线通过不代表产品或云端已部署。

## 分支整合

按用户要求，将所有现存分支的提交整合到 `dev`，保留原分支与历史，不改动 `main`。整合前核对的提交：

| 分支 | 整合前 SHA | 处理 |
|---|---|---|
| dev | `afe18f88a00120ebeba598270c6b13346fbf791b` | 保留原有提交与早期 M0 证据 |
| main | `ca2a26f7f9da582a8ad9b17c7fcc0bce80952ecd` | 已包含于 M0-D 历史，纳入 dev；main 本身不移动 |
| feat/m0-b-toolchain | `d41aa0e8f5c48592891bb6f37bce3e63ea2486f7` | 已包含于 M0-D 历史，纳入 dev |
| feat/m0-c-runtime | `bfa7811550eb0eabdb6828747729f0c1947e410f` | 已包含于 M0-D 历史，纳入 dev |
| feat/m0-d-arc-compatibility | `9dec92d88e29ba7b13e0207536ebd99f48f28200` | 纳入开发代码、测试与报告；不提升阶段验收状态 |

同名状态文档采用最新进度；原 dev 的完整旧报告以相同 blob 原样保存为 [M0-A 历史报告](M0-A-STATUS-ARCHIVE.md)。其中“当前”“下一步”等表述只代表当时记录，不是本轮状态。原始 [离线输出](m0/offline-tests.tap)、[早期网络失败记录](m0/testnet-readonly.json) 和只读 smoke 工作流均保留。双方的两个原始只读探针脚本 blob 相同，无需改动。

为验证整合结果，现有 `ci.yml` 的 push/PR 分支范围增加 `dev`，同步更新对应策略断言；其只读权限、固定依赖、失败检查、禁止公开链写入和无 Secrets 的边界不变。CI 实际结果以合并提交对应 Actions 为准，不用旧结果代替新提交验收。本轮没有新功能、Cloudflare 资源变更或链上交易。

## 子阶段状态

| 子阶段 | 状态 | 证据与边界 |
|---|---|---|
| M0-A：GitHub/Actions 与只读探针 | PASS_CI_READONLY | [运行35820224910](https://github.com/iwbinb/ArcBox/actions/runs/35820224910)，27项离线fixture+6项测试网只读；没有签名/转账 |
| M0-B：工具链与 CI | PASS_CI，PR #2 已合并 | [验收报告](M0-B-STATUS.md)、[复现说明](TOOLCHAIN.md)、[PR #2](https://github.com/iwbinb/ArcBox/pull/2) |
| M0-C：绑定与运行时语义 | PASS_LOCAL_CI，PR #3 已合并 | [验收报告](M0-C-STATUS.md)、[探针说明](RUNTIME-PROBES.md)、[PR #3](https://github.com/iwbinb/ArcBox/pull/3)；新增41项+回归47项通过，合并基线ca2a26f |
| M0-D：Arc 兼容性开发与实际交易 | PASS_PUBLIC_TESTNET | [历史开发报告](M0-D-STATUS.md)、[真实测试网验收](M0-D-PUBLIC-TESTNET.md)、[受保护运行](https://github.com/iwbinb/ArcBox/actions/runs/35868308292)；9 笔限定交易及 12 项场景通过，执行后余额和授权已核对 |
| M0-E：技术验证收口 | PASS_EVIDENCE_REVIEW（dev，待 PR 审查） | [M0-E 收口报告](M0-E-CLOSURE.md)对照早期矩阵、当前 main CI、真实测试网交易和后续阶段门禁；Cloudflare 云端、浏览器钱包和主网明确保留 NOT_RUN |

执行计划仍为 [v1.1](../delivery/01-CODEX-PLAN.md)。先前分支整合没有进入 M0-E 或 M1；PR #4 指向 main 的状态不因代码进入 dev 而被当作已合并或已验收。

## M0-D 授权、历史阻塞与实际验收

用户已经明确授权专用测试钱包、官方水龙头测试币、两个最小探针，以及限定的授权、转账、签名和回执验证；**不再以“等待用户授权”为当前阻塞**。

[只读核验与阻塞记录](https://github.com/iwbinb/ArcBox/pull/4#issuecomment-5791882456)记录：旧地址 `0x6559E5550B0826D56b8052eec683F508a4090890` 在区块63565795观测到20测试USDC，nonce为0；这不是本轮新的余额查询。此前临时工作区的私钥已不在可访问环境，旧地址停止用于后续测试，不再向其转入任何资产。

2026-09-23 接续：已生成新的专用测试钱包，公开地址为 `0x20E31f11Aaf66420765969f98Dbd2Bad47Fc1b98`；本机离线签名和地址恢复匹配。私钥持久保存于本机登录钥匙串的 `ArcBox M0-D Arc Testnet Wallet` 条目，并写入 GitHub `arcbox_testnet` 环境的 `ARCBOX_TESTNET_PRIVATE_KEY` Secret；公开地址写入该环境的 `ARCBOX_TESTNET_EXPECTED_ADDRESS` Variable。该环境只允许 `dev`，且需 `iwbinb` 审批；同一 GitHub 账号的审批不构成独立双人审查。

[只读钱包检查 35852286276](https://github.com/iwbinb/ArcBox/actions/runs/35852286276) 在提交 `774d355` 上通过：Arc 测试网 chainId 为 5042002，区块 63581751 的公开地址余额为 0 测试 USDC、确认与待处理 nonce 均为 0。这是收款前的历史基线，不证明当时受保护环境中的密钥可用。

2026-09-23 更新：[PR #6](https://github.com/iwbinb/ArcBox/pull/6) 已合并到 main `307da49`。新钱包收到测试网原生 USDC；[回执 `0x2927695…9ccb`](https://explorer.testnet.arc.io/tx/0x292769537299b461dc283c378598ce5c3d83c4f97dc8869614481db2ae8b9ccb) 在区块 63588366 成功，含一条 18 位精度的系统 Transfer。它是用户资金到达的证据，不是 ArcBox 发出的探针交易。[只读余额检查 35865428988](https://github.com/iwbinb/ArcBox/actions/runs/35865428988) 在提交 `a3cf060`、区块 63597209 观察到 2.000000 测试 USDC、确认与待处理 nonce 均为 0。

[受保护签名预检 35865525540](https://github.com/iwbinb/ArcBox/actions/runs/35865525540) 经环境审批后在 `dev` 提交 `a3cf060` 成功运行：Secret 派生地址与预期地址匹配，离线签名恢复匹配，Arc 测试网 chainId 5042002，区块 63597525 余额 2.000000 测试 USDC、nonce 0。报告状态 `UNFUNDED` 表示**低于执行脚本要求的 2.1 测试 USDC 启动余额**，不是钱包无余额；该运行没有广播交易。

补款后，[只读检查 35866759833](https://github.com/iwbinb/ArcBox/actions/runs/35866759833)在提交 `a4e3420`、区块 63598591 确认余额 5.000000 测试 USDC、nonce 0。[受保护预检 35866829296](https://github.com/iwbinb/ArcBox/actions/runs/35866829296)在同一提交上报告 `READY`、签名地址匹配、余额 5.000000、nonce 0，没有广播交易。

随后[受保护执行 35868308292](https://github.com/iwbinb/ArcBox/actions/runs/35868308292)经单独审批，在 `a4e3420` 上完成两探针部署和 9 笔限定交易；`ARC-01` 至 `ARC-12` 全部通过，最后一笔为计划内的链上失败回执。执行后另外以只读 RPC 逐笔重取交易和回执：Gas 合计 0.039161031 测试 USDC，钱包余额 4.960838969、确认/待处理 nonce 均为 9，两探针余额及剩余授权均为 0。详情和交易哈希见 [M0-D 公开测试网验收](M0-D-PUBLIC-TESTNET.md)。**M0-D 在限定范围内通过；当时 M0-E 尚未收口。**已使用的钱包不可盲目重跑探针。

## M0-E 当前收口

[M0-E 收口报告](M0-E-CLOSURE.md)在已合并 main `a48c205` 的 CI、真实测试网运行及区块 63603869 的只读回查上逐项核验：M0-A/B/C/D 的限定技术能力已通过，早期 Cloudflare 云端及完整浏览器钱包项目分别转入 D0/D1 和 M2 且仍为 NOT_RUN。M0 技术探针基线可收口；**M0-E 文档进入 main 尚待本轮 PR 审查合并，M1-A 是下一子阶段**。这不代表六工具、生产环境或主网可用。

## 历史证据边界

M0-B/M0-C/M0-D报告保留各自当时的准确source SHA；历史文件中的待合并或待授权字样由本索引与后续PR评论补充，不篡改旧测试结果。最初M0-D代码测试为 `b2c95666262ecc02e1505699203b459c9b225679`，后续head及PR合成版本均按对应Actions区分。

此前容器DNS失败保留为历史事实，已验证的安装和运行来自GitHub Actions，不宣称修复容器网络。公开测试网历史回执不是本项目发送的新交易，本地Arc引擎签名交易也不是公开链交易。**没有Cloudflare云端部署、主网资金操作或完整M0验收通过的结论。**
