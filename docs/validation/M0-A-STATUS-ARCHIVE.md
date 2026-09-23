# M0 技术验证 · 当前状态

日期：2026-09-23。设计基线：`138d20ef2b3969b1a942723918f312e789855182`。

**状态：M0 IN PROGRESS。GitHub Actions 执行通道已实际验证成功；27项离线测试、6项真实测试网只读检查通过。不是完整 M0 PASS；未开始 M1，未部署网站或资金合约，未发送资金。**

## 最新结果：GitHub Actions 已可用

用户已授权在 ArcBox 配置 GitHub Actions。本轮新增 [M0 smoke 工作流](../../.github/workflows/m0-smoke.yml)，在 `feat/m0-validation` 分支实际触发一次 push 运行，没有合并到 main。

- [运行 #1](https://github.com/iwbinb/ArcBox/actions/runs/35820224910)：`completed / success`，run ID `35820224910`，attempt 1。
- [任务及原始日志](https://github.com/iwbinb/ArcBox/actions/runs/35820224910/job/107050287014)：job ID `107050287014`。已通过连接器重新读取步骤与完整日志，不只读取工作流文件。
- **实际测试的提交**：`f1eac018442e266327cf2bc6e3a2d5709b829052`。本状态文档之后的文档提交不属于该次测试代码版本。
- 运行开始：2026-09-23 04:54:21 UTC；运行完成记录：04:54:30 UTC。
- 执行环境：GitHub-hosted `ubuntu-24.04`，Node `v22.23.2`、npm `10.9.8`、Git `2.55.0`。这些是本次日志记录，不是已锁定的生产依赖。
- runner 工具检查、匿名拉取精确提交、语法/离线测试、真实只读 RPC、结果摘要步骤全部成功。

| 检查 | 实际结果 | 证据范围 |
|---|---|---|
| 执行器启动 | PASS | 日志输出 `RUNNER_SMOKE_PASS` |
| 代码拉取 | PASS | 匿名读取公开仓库，并确认 HEAD 等于触发提交 |
| 两个脚本语法 | PASS | 两次 `node --check` 成功 |
| 离线 fixture 测试 | 27 PASS / 0 FAIL / 0 SKIP | 模拟 RPC，不是27次真实链测试 |
| 真实测试网只读探针 | 6 PASS | 以下固定区块的实际 RPC 返回 |
| 日志回读 | PASS | 已读取 run、job steps 和完整 job logs |

### 实际测试网返回

观察时间：`2026-09-23T04:54:26.291Z`。RPC：`https://rpc.testnet.arc.io`。只读报告 `status=PASS`。

| 检查 ID | 返回/结果 |
|---|---|
| arc.chain_id | `5042002`，与期望一致 |
| arc.block_anchor | 区块 `63537631` |
| usdc.decimals | `6` |
| usdc.balance_relation | 同一示例地址、同一区块的原生值/10^12取整与ERC-20值一致 |
| usdc.allowance_read | `0`；只读取，没有执行 approve |
| arc.block_anchor_consistency | 重查同一区块，hash一致 |

区块 hash：`0x95a13104cb67e6cfa43d3e67666bbfe3cc347e1402f68ea13a0dbbb9b690828a`。

查询地址：`0x0000000000000000000000000000000000000001`；原生 U18：`61810139484743910260755`；ERC-20 U6：`61810139484`。该地址不是用户或项目钱包，不要向其转账。这个结果仅证明该地址该区块的数值关系，不证明所有地址、真实转账、receipt日志或终局性行为。

### 工作流权限与触发范围

`permissions: {}`；实际日志仅显示不可去除的 `Metadata: read`，没有仓库写权限。通过公开 HTTPS 匿名 fetch 代码，不使用额外 PAT、生产 Secrets、第三方 Actions、钱包签名或广播方法。执行脚本必须来自触发的精确 SHA。

job 最长5分钟，RPC命令最长90秒；同分支运行并发互斥。只在 main 或 feat/m0-validation 上，工作流自身或 scripts/m0 下文件变更时触发；没有定时任务，也不因本状态文档更新再次运行。包含 workflow_dispatch，但本轮通过 push 触发，尚未验证手动 dispatch；默认分支尚未包含该文件。

本次仅确认当前公开仓库与此执行通道可用；不能推断所有后续依赖下载、云端部署、Actions账单额度或私有仓库访问也已验证。

## 已交付与历史记录

- [只读 Arc 探针](../../scripts/m0/probe-arc.mjs)：固定 RPC 方法白名单、明确网络选择、chain ID、固定区块查询、USDC精度/余额/allowance读取、区块hash再次校验、错误分类及自定义RPC地址脱敏。
- [离线单元测试](../../scripts/m0/probe-arc.test.mjs)：27项测试，覆盖错误链、错误精度、BigInt精确性、错误RPC返回、重复区块锚点、超时、DNS失败及禁止广播/签名方法；本轮未修改脚本。
- [首次本地原始测试输出](m0/offline-tests.tap)：27通过，0失败，0跳过；本地 Node v22.16.0、npm 10.9.2。它不是本次GitHub执行器的原始日志。
- [首次容器联网失败记录](m0/testnet-readonly.json)：`2026-09-23T04:45:17.509Z` 首个 eth_chainId 因 EAI_AGAIN 失败。保留历史证据，不用最新成功结果覆盖旧文件。没有据此判定 Arc 服务故障。

脚本只用Node内置模块，无第三方依赖、私钥、部署代码或付款能力。整体TypeScript/React/Wrangler/Solidity依赖仍未锁定或验证。

## 如何复现

在仓库根目录执行；第一组不需要联网、钱包或Cloudflare账号：

```bash
node --check scripts/m0/probe-arc.mjs
node --check scripts/m0/probe-arc.test.mjs
node --test --test-reporter=tap scripts/m0/probe-arc.test.mjs
```

显式运行测试网只读检查：

```bash
node scripts/m0/probe-arc.mjs --network testnet
```

可选环境变量 `ARCBOX_TESTNET_RPC_URL` 指定HTTPS测试网RPC；凭证只放受控执行环境，不提交到Git。报告隐藏自定义地址。主网检查须显式 `--network mainnet`，同样无写方法；本轮未向主网发送真实请求。参数错误退出2，FAIL/BLOCKED退出1，全部只读检查通过才退出0。

## 执行环境边界

原代码容器与GitHub连接器、GitHub托管执行器是不同通道。此前容器的git clone、Arc RPC、npm registry发生DNS失败；本轮没有声称修复容器网络，而是已实测GitHub执行器可以拉取公开仓库并查询Arc测试网。

尚未在GitHub执行器安装Wrangler/完整npm依赖；尚未执行D1/R2/Queues的本地绑定测试。没有读取或配置用户Cloudflare账号、没有创建云资源、没有生产部署权限验证。

## M0验收矩阵

| 项目 | 状态 | 缺少的证据 |
|---|---|---|
| GitHub设计基线读取 | PASS | 已确认设计基线与M0分支 |
| GitHub Actions写入/触发/执行/日志读取 | PASS | 仅此次push运行；手动dispatch未测 |
| 探针语法与27项离线测试 | PASS_LOCAL / PASS_CI | 只代表脚本行为 |
| Arc测试网RPC只读探针 | PASS_CI_READONLY | 单RPC、单示例地址、固定区块 |
| USDC approve/transfer、SafeERC20、receipt双日志 | NOT_RUN | 隔离测试钱包、测试币、测试合约与真实交易证据 |
| SIWE/EOA/ERC1271/钱包切链 | NOT_RUN | 依赖锁定、测试钱包与浏览器实测 |
| Workers/D1事务与CAS/outbox | NOT_RUN | 可复现运行时与实际测试结果 |
| R2私有授权、对象hash、Queues重放 | NOT_RUN | 本地绑定测试；之后需云端资源验证 |
| 完整依赖版本/lockfile | NOT_RUN | 软件源下载与兼容性测试 |
| Cloudflare首次云端部署 | NOT_RUN | 明确账号授权及测试资源范围 |
| 主网合约或真实资金动作 | NOT_AUTHORIZED / NOT_RUN | 另行授权和安全门禁；本轮不执行 |

## 下一步与暂停点

GitHub Actions执行通道已获授权且实测可用，不需要再次询问相同授权。下一批仍属于M0：验证锁定的Workers运行时、D1 batch/CAS/outbox、私有R2访问和Queues重放；继续采用小范围PR、实际测试和可复核报告。

真实Cloudflare部署另行落实账号、资源权限和预算；域名、收费资源、生产变更、真实资产动作到相应阶段再确认。密钥不发在聊天正文或公开仓库。只读Actions成功不等于Cloudflare已部署、资金合约安全或完整M0已通过；PR #1继续保留Draft。

## 资料与可复核性

官方参数参考：[Arc网络连接](https://docs.arc.io/arc/references/connect-to-arc)、[USDC双接口](https://docs.arc.io/arc/concepts/stablecoin-native-model)、[Cloudflare本地开发](https://developers.cloudflare.com/workers/local-development/)。本次运行机制参考 [GitHub事件触发文档](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)。官方文档不替代真实执行日志。

首次本地最终源码SHA-256（本轮未修改源码）：

- `scripts/m0/probe-arc.mjs`：`a9b673c1defa09700dfb8b0124affd2527d0d85149d2aa5cc7c6b302e2a51fc5`
- `scripts/m0/probe-arc.test.mjs`：`07f5b7c64b26e59e0db82c08ae99d7ed1b7d854705091608b29211b851866ca8`

历史说明：首次离线运行有一条测试把RPC次数写成8，固定流程实际为7次；修正断言后重跑27/27通过。该修正发生在本次Actions配置之前；本轮没有放宽断言来使联网结果通过。
