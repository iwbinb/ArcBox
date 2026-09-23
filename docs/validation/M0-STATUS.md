# M0 技术验证 · 第一批交付

日期：2026-09-23。设计基线：`138d20ef2b3969b1a942723918f312e789855182`。

**状态：M0 IN PROGRESS / BLOCKED，不是 M0 PASS。仅离线探针测试通过；没有开始 M1、部署网站、发布合约或发送资金。**

## 已交付

- [只读 Arc 探针](../../scripts/m0/probe-arc.mjs)：固定 RPC 方法白名单、明确网络选择、chain ID、固定区块查询、USDC精度/余额/allowance读取、区块hash再次校验、错误分类及自定义RPC地址脱敏。
- [离线单元测试](../../scripts/m0/probe-arc.test.mjs)：27项测试，覆盖错误链、错误精度、BigInt精确性、错误RPC返回、重复区块锚点、超时、DNS失败及禁止广播/签名方法。
- [原始测试输出](m0/offline-tests.tap)：27通过，0失败，0跳过，退出码0。**RPC响应全部使用本地合成fixture；这不是27项真实链或Cloudflare测试。**
- [真实联网尝试结果](m0/testnet-readonly.json)：`2026-09-23T04:45:17.509Z`尝试测试网读取，首个`eth_chainId`因`EAI_AGAIN`失败，状态BLOCKED、退出码1。未取得链上返回，因此不能据此判断Arc服务故障或兼容性失败。

脚本只用Node内置模块，无第三方依赖、私钥、部署代码或付款能力；不存在需要安装的npm依赖。当前执行版本Node v22.16.0、npm 10.9.2。**这只是本次执行环境，不是已完成安全评估的生产版本锁定；整体TypeScript/React/Wrangler/Solidity依赖尚未选择或验证。**

## 如何复现

在仓库根目录执行；第一组不需要联网、钱包或Cloudflare账号：

```bash
node --check scripts/m0/probe-arc.mjs
node --check scripts/m0/probe-arc.test.mjs
node --test --test-reporter=tap scripts/m0/probe-arc.test.mjs
```

网络环境可用后，显式运行测试网只读检查：

```bash
node scripts/m0/probe-arc.mjs --network testnet
```

可选环境变量`ARCBOX_TESTNET_RPC_URL`指定HTTPS测试网RPC；凭证放执行环境秘密配置，不提交到Git。报告会隐藏整个自定义地址。主网读检查必须显式`--network mainnet`，同样没有写方法；本轮未对主网发请求。参数错误退出2，FAIL/BLOCKED退出1，全部只读检查通过才退出0。

脚本中的`SAMPLE`只是被查询的公共合成地址，不是用户、运营方或部署者钱包，**不要向其转账**。即使两个余额均为零而通过关系检查，也只表示该地址该区块的数值关系，不构成真实转账验证或全链证明。

## 当前环境限制

GitHub连接器的读取/提交正常；代码执行容器与连接器是不同通道。容器实际尝试git clone、Arc RPC和npm registry均遇到DNS解析失败。没有尝试绕过网络限制，也没有把web文档阅读当作运行时联网测试。

当前容器未发现Wrangler命令，软件源不可达，因此D1/R2/Queues的Cloudflare本地运行时验证也**未执行**；未验证任何用户Cloudflare账号的授权。尚未为此PR创建GitHub Actions、云资源或生产Secrets。

## M0验收矩阵

| 项目 | 状态 | 缺少的证据 |
|---|---|---|
| GitHub设计基线读取 | PASS | 当前main仍为设计提交 |
| 探针语法与27项离线测试 | PASS_LOCAL | 仅脚本行为；无真实网络/合约结论 |
| Arc官方参数阅读 | DOCUMENTED | 文档值与实际RPC返回仍需对照 |
| Arc测试网RPC只读探针 | BLOCKED | 当前执行容器DNS不可用 |
| USDC approve/transfer、SafeERC20、receipt双日志 | NOT_RUN | 隔离测试钱包、测试币、测试合约与联网执行环境 |
| SIWE/EOA/ERC1271/钱包切链 | NOT_RUN | 依赖锁定、测试钱包与浏览器实测 |
| Workers/D1事务与CAS/outbox | NOT_RUN | 可安装的锁定运行时与实际结果 |
| R2私有授权、对象hash、Queues重放 | NOT_RUN | 本地绑定测试；之后需云端资源验证 |
| 完整依赖版本/lockfile | NOT_RUN | 可访问的软件源与兼容性测试 |
| Cloudflare首次云端部署 | NOT_RUN | 明确账号授权及测试资源范围 |
| 主网合约或真实资金动作 | NOT_AUTHORIZED / NOT_RUN | 另行授权和安全门禁；M0不默认执行 |

## 下一步与暂停点

建议先在独立、可联网的CI执行环境运行此只读探针及后续Cloudflare本地绑定测试，而不是让用户交出钱包私钥或购买VPS。可以使用限时、无生产Secrets、只读仓库权限的GitHub Actions；本批次未添加或触发该工作流，先向用户确认执行通道。

真实Cloudflare部署需要单独落实账号、资源权限和预算；测试域名可优先使用账号的workers.dev地址，正式域名后置。首次申请收费资源、生产变更或任何真实资产操作必须暂停确认。密钥不发在聊天正文或公开仓库。

M0余项通过后才进入M1网站骨架。不得因为离线单测通过就把设计文档中的安全检查标记已完成；后续每阶段独立PR并在阶段末停止。

## 资料与可复核性

官方参数依据（2026-09-23读取）：[Arc网络连接](https://docs.arc.io/arc/references/connect-to-arc)、[USDC双接口](https://docs.arc.io/arc/concepts/stablecoin-native-model)、[Cloudflare本地开发](https://developers.cloudflare.com/workers/local-development/)。这些是文档证据，不替代真实交易或云端测试。

本地最终源码SHA-256：

- `scripts/m0/probe-arc.mjs`：`a9b673c1defa09700dfb8b0124affd2527d0d85149d2aa5cc7c6b302e2a51fc5`
- `scripts/m0/probe-arc.test.mjs`：`07f5b7c64b26e59e0db82c08ae99d7ed1b7d854705091608b29211b851866ca8`

首次离线运行有一条测试将预期RPC次数写成8，实际固定流程为7次；修正该断言并完整重跑后得到所附27/27结果。未放宽错误链、精度、广播禁止或其他安全断言。
