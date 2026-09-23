# M0 技术验证 · 当前进度

2026-09-23。**M0 IN PROGRESS，不是整体 PASS。**本状态为分阶段证据索引，历史结果不覆盖为新版本结果。将代码合入 `dev` 不代表公开测试网交易或部署已通过。

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
| M0-D：Arc 兼容性开发与实际交易 | 开发和本地CI通过；PENDING_SIGNER_PREFLIGHT_AND_FUNDING | [开发报告](M0-D-STATUS.md)、[复现与边界](ARC-COMPATIBILITY.md)、[最终本地复验](https://github.com/iwbinb/ArcBox/pull/4#issuecomment-5791656905)；128项历史本地测试通过，公开测试网新签名交易仍未执行 |
| M0-E：技术验证收口 | NOT_RUN | M0-D真实测试网证据齐全后再综合审查 |

执行计划仍为 [v1.1](../delivery/01-CODEX-PLAN.md)。先前分支整合没有进入 M0-E 或 M1；PR #4 指向 main 的状态不因代码进入 dev 而被当作已合并或已验收。

## M0-D 当前阻塞与授权

用户已经明确授权专用测试钱包、官方水龙头测试币、两个最小探针，以及限定的授权、转账、签名和回执验证；**不再以“等待用户授权”为当前阻塞**。

[只读核验与阻塞记录](https://github.com/iwbinb/ArcBox/pull/4#issuecomment-5791882456)记录：旧地址 `0x6559E5550B0826D56b8052eec683F508a4090890` 在区块63565795观测到20测试USDC，nonce为0；这不是本轮新的余额查询。此前临时工作区的私钥已不在可访问环境，旧地址停止用于后续测试，不再向其转入任何资产。

2026-09-23 接续：已生成新的专用测试钱包，公开地址为 `0x20E31f11Aaf66420765969f98Dbd2Bad47Fc1b98`；本机离线签名和地址恢复匹配。私钥持久保存于本机登录钥匙串的 `ArcBox M0-D Arc Testnet Wallet` 条目，并写入 GitHub `arcbox_testnet` 环境的 `ARCBOX_TESTNET_PRIVATE_KEY` Secret；公开地址写入该环境的 `ARCBOX_TESTNET_EXPECTED_ADDRESS` Variable。该环境只允许 `dev`，且需 `iwbinb` 审批；同一 GitHub 账号的审批不构成独立双人审查。

[只读钱包检查 35852286276](https://github.com/iwbinb/ArcBox/actions/runs/35852286276) 在提交 `774d355` 上通过：Arc 测试网 chainId 为 5042002，区块 63581751 的公开地址余额为 0 测试 USDC、确认与待处理 nonce 均为 0。它不访问 GitHub Secret，不能证明受保护环境中的密钥可用。受保护签名工作流预检仍未运行、尚未领取测试币或发送新交易，不能据此标记 M0-D 通过。

剩余工作是先运行受保护的签名和只读网络预检，再领取测试币、核对到账，最后补齐公开测试网写入证据。私钥和助记词不进入聊天、普通变量、工作流正文或公开仓库。已授权上限保持：单次资产移动不超过0.01测试USDC、单笔Gas不超过0.25、整次Gas不超过2测试USDC、最多12笔。

## 历史证据边界

M0-B/M0-C/M0-D报告保留各自当时的准确source SHA；历史文件中的待合并或待授权字样由本索引与后续PR评论补充，不篡改旧测试结果。最初M0-D代码测试为 `b2c95666262ecc02e1505699203b459c9b225679`，后续head及PR合成版本均按对应Actions区分。

此前容器DNS失败保留为历史事实，已验证的安装和运行来自GitHub Actions，不宣称修复容器网络。公开测试网历史回执不是本项目发送的新交易，本地Arc引擎签名交易也不是公开链交易。**没有Cloudflare云端部署、主网资金操作或完整M0验收通过的结论。**
