# M0-D · Arc 兼容性开发与验证状态

日期：2026-09-23。

**开发交付：PASS_LOCAL_CI。完整 M0-D 验收：BLOCKED_PUBLIC_TESTNET_WRITE_EVIDENCE。**

已实现兼容性探针、受保护的测试网执行入口和自动测试；已通过本地 Arc 执行及公开测试网只读核验。**尚未配置并获准使用专用测试钱包，没有向公开测试网广播交易，因此不将整个 M0-D 标记 PASS，也不进入 M0-E。**

## 1. 准确版本与证据

- 起点：PR #3 已合并，main `ca2a26f7f9da582a8ad9b17c7fcc0bce80952ecd`。
- 分支：`feat/m0-d-arc-compatibility`。
- 实际测试代码：`b2c95666262ecc02e1505699203b459c9b225679`。
- [Actions 35836560258](https://github.com/iwbinb/ArcBox/actions/runs/35836560258)，push 触发，两个 job 均 completed/success。
- [必需检查完整日志](https://github.com/iwbinb/ArcBox/actions/runs/35836560258/job/107101311674) 已读取，2026-09-23 08:20–08:21 UTC。
- [独立只读任务完整日志](https://github.com/iwbinb/ArcBox/actions/runs/35836560258/job/107101312005) 已读取。
- [从日志整理的证据摘要](m0-d/ci-evidence.json)。该文件是人工整理的摘要，不冒充未经修改的完整运行报告；原始结构化报告在上述任务日志中。

本报告加入后的提交与 PR 合成合并版本需要重新验证；最终结果写入 PR，不把本报告的旧 source SHA 改成未来提交 SHA。

## 2. 实际测试结果

| 测试组 | 数量 | 结果与证据范围 |
|---|---:|---|
| 原 Node 回归 | 46 | PASS，包含旧只读探针 fixture 和工具链负向控制 |
| 原 workerd 启动 | 1 | PASS |
| D1 / R2 / Queues / Scheduled | 33 | PASS，本地绑定，不是 Cloudflare 云端资源 |
| 构建产物 / Assets HTTP | 8 | PASS |
| 新增金额、签名入口、费用、日志、回执防护 | 32 | PASS，无失败、跳过或取消 |
| 新增本地 Arc EVM 集成 | 8 | PASS，在 Arc Foundry 本地 Arc 引擎执行 |
| **本地测试合计** | **128** | **0 FAIL / 0 SKIP / 0 CANCELLED** |
| 原公开测试网只读检查 | 6 | PASS，单独统计 |
| 新增 viem 公开测试网只读检查 | 7 | PASS，包括三笔历史交易回执样本 |
| 新的公开测试网部署与签名交易 | — | **NOT RUN，待专用钱包与操作范围确认** |

冻结安装、13 项直接依赖核验、三份 TypeScript 配置、静态检查、Vite/Worker dry-run/两组 Solidity 编译、检查后源码与锁文件不漂移均通过。安装与编译不额外计入测试数量。

EVM-01 内部包含 12 个场景检查、9 笔本地签名交易，属于一个集成测试，不额外增加 12 个测试来夸大总数。新探针目标 Osaka；原 M0-B Paris 编译探针不变。

## 3. 本地场景已验证的内容

使用 Arc 专用本地引擎而非普通以太坊 Anvil，核验 `anvil_nodeInfo.network=arc`。共用场景覆盖：官方接口 USDC 精度与共享余额；两个最小探针部署和运行字节码核对；小额 ERC-20 转账及返还；精确 approve；SafeERC20 transferFrom 原子往返；业务事件与底层双日志分离；Gas 单独核算；普通钱包和已部署 ERC-1271 签名；错误 chain/domain、过期和 nonce 重放；一笔刻意广播并执行失败的本地交易。

另外测试零额/自转账事件、原生最小精度、非操作人/附带原生 value 的调用拒绝、ERC-1271 撤销，以及 false/revert/no-return/扣费型代币模型。**这些错误代币是 localhost 合成 fixture，不是实际控制了公开网络的 USDC 黑名单。**

正常共用流程结束时：探针 ERC-20 本金余额为 0、对应 allowance 为 0、没有未确认交易。正常路径不能证明进程任意中断后都会自动清理；中断后必须先核对报告中的 nonce、hash、合约和剩余授权。

## 4. 公开测试网只读观察

viem 检查锚定区块 `63562302`，区块 hash：
`0x88217f0b95078fa7620a42df2dc5672265212aa31f83c753aea000feed4c4069`。

扫描有界的 129 个区块，取三笔历史回执，均观察到一条 ERC-20 Transfer 与一条对应的系统 Transfer，整数精度匹配。交易 hash 见证据摘要。它们是公开链上的历史交易，**不是本项目刚发送的交易，不能替代专用钱包的部署、授权、转账或签名执行验收**。

读取当前区块、固定区块状态及历史回执也不构成共识终局、安全性或所有边缘行为的证明。无样本时脚本报告 INCONCLUSIVE，而非声称双日志观察通过。

## 5. 依赖和执行器

原 Node 22.23.2 / pnpm 10.34.5 及原 11 项直接依赖不升级；新增 viem `2.56.8`、OpenZeppelin Contracts `5.6.1`，均写入精确版本及真实生成的锁文件。

新锁文件 SHA-256：
`107ca799fd9f6f3a351174fbf1e0b44a7f4d87fe5b9aa5d1f95e43b820bca075`。

官方 Arc Foundry release 为 `v0.8.0-2`；已下载 Linux x64 发行包，SHA-256：
`088bdb96a84418b757f9825d491e702792f1d1d1e29a9145af305a6600a79556`。

实际二进制内部版本显示 `anvil 1.7.1-dev`，commit `d497beea7096ff2a8e583c8b307941f24a61b06b`。发行标签与内部版本不同，均如实保留；不将其称为上游最新稳定 Foundry。安装器先校验发行包再提取，不执行远程安装脚本。

## 6. 权限、隔离与未执行项

一次性依赖解析 [35835324772](https://github.com/iwbinb/ArcBox/actions/runs/35835324772) 暂时使用 contents:write，仅保存生成的未挂接 Git blobs；没有由工作流创建 commit/ref、改 main 或使用生产 Secrets。该临时工作流已从最终树移除，常驻 CI 仍 contents:read，外部 Actions 固定 SHA。没有为测试网私钥配置自动 CI 入口。

新代码位于 probes/arc、scripts/m0、tests/arc；没有改产品 UI、根应用 Worker、六工具业务合约或 Cloudflare 资源配置。测试账户为仅用于 loopback 的公开本地开发账户，公开测试网入口会拒绝这些账户。

真实测试网入口默认关闭，限制固定网络、匹配的专用账户、固定代码/合约目标、精确授权、单次最多 0.01 测试 USDC、单笔 Gas 上界 0.25 测试 USDC、单次运行 Gas 上界 2 测试 USDC及最多12笔交易。正常流程为9笔；估算超过额度则停止，不擅自扩额。测试币是测试资源，不涉及主网资金。

未执行：公开测试网写交易、真实浏览器钱包流程、生产 SIWE、云端部署、资金业务、安全审计。写交易 CLI 的网络专用路径和受保护执行配置还需下一轮实际验证，不能从本地共用逻辑通过推定其已在公开链运行。

首轮完整实现 CI 无失败。后续尝试增加三项额外边界断言时，工具写入被平台拦截；该操作未产生提交，未重试，也未计入测试或本次交付。当前代码证据仍对应上述成功 SHA。

## 7. 下一步仍是 M0-D

先审查本 PR，并确认专用测试钱包、官方水龙头测试币、限定动作与 Gas 预算；秘密通过受保护环境配置，不发聊天或公开仓库。随后在公开测试网实际运行已开发探针、保存真实交易和剩余余额/授权核对证据，再决定 M0-D 是否通过。

完成真实测试网写入之前，不进入 M0-E、不把 M0 标完成、不部署六工具或网站。复现和细项矩阵见 [ARC-COMPATIBILITY.md](ARC-COMPATIBILITY.md)。
