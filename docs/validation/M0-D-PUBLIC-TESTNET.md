# M0-D · Arc 公开测试网写入验收

日期：2026-09-23。**M0-D 最小公开测试网兼容验证：PASS_PUBLIC_TESTNET。M0 整体仍在进行中；M0-E 尚未执行。** 本报告只覆盖两个最小探针及限定测试币操作，不代表六工具、浏览器钱包、Cloudflare 云资源或主网已验收。

## 执行版本与来源

- 执行源码：`dev` 提交 `a4e34201e58274438c58b9dfe04e8c505e3642dc`；[受保护 GitHub Actions 运行 35868308292](https://github.com/iwbinb/ArcBox/actions/runs/35868308292)。环境 `arcbox_testnet` 经审批后才向手动运行提供专用钱包 Secret；没有 push/PR 自动链上写入。
- 网络：Arc Testnet，chainId `5042002`；专用钱包 `0x20E31f11Aaf66420765969f98Dbd2Bad47Fc1b98`。执行前受保护预检在该提交上验证签名地址、余额 5.000000 测试 USDC、确认与待处理 nonce 均为 0。
- [原运行报告的无秘密结构化摘录](m0-d/public-testnet-35868308292.json)保留 12 项场景结果、9 笔交易哈希、回执区块与 Gas。它由运行日志提取，不冒充独立节点的原始证据。

## 交易与验证

| nonce | 动作 | 交易 | 回执 | Gas（测试 USDC） |
|---:|---|---|---|---:|
| 0 | 部署 ArcCompatibilityProbe | [0xd329…117f](https://explorer.testnet.arc.io/tx/0xd3294ae636012e55ec9582ba04e2f43cb47810d291e962ccdc13f0dfc83f117f) | 成功 | 0.022071609 |
| 1 | 部署 Probe1271Wallet | [0x58f8…77bc](https://explorer.testnet.arc.io/tx/0x58f88fae2f7d539ed0cb2b97d67699f44ee113bcfde7679be677f6af283277bc) | 成功 | 0.009096612 |
| 2 | ERC-20 转出 0.001 USDC | [0xb8be…dc3b6](https://explorer.testnet.arc.io/tx/0xb8be960c3a9f579b016a0920320dcc6452a8cc566e9acbeaed2e5056e32dc3b6) | 成功 | 0.001027698 |
| 3 | 固定 owner 收回 0.001 USDC | [0x7ab2…91e5a](https://explorer.testnet.arc.io/tx/0x7ab25793cdf894390e5285fa494b4e1612d719edb2078e68517dfe9b7a191e5a) | 成功 | 0.001065267 |
| 4 | 精确授权 0.01 USDC | [0x38e6…34c75](https://explorer.testnet.arc.io/tx/0x38e6c5937206a2b967ee2d5dc9857a633badd79272abff0f0e4f7d3fdb934c75) | 成功 | 0.001163946 |
| 5 | `transferFrom` 原子往返 0.01 USDC | [0x32ec…ab73fe](https://explorer.testnet.arc.io/tx/0x32ec4568149bc96dae132e1ff6fb24a6a8cced80634a0e7abe003f6ce7ab73fe) | 成功 | 0.001945251 |
| 6 | EOA 结构化签名消费 | [0xc9dd…3a3b6e](https://explorer.testnet.arc.io/tx/0xc9dd25d55cf1c02142c3b8295bf9eba673206d794e9935ecfe5e12b7c13a3b6e) | 成功 | 0.001112811 |
| 7 | ERC-1271 结构化签名消费 | [0x5f1e…2ef4](https://explorer.testnet.arc.io/tx/0x5f1e941d4e864b331529d5ae5d97eaf6c1c209aa464cd40b8af1914ed9232ef4) | 成功 | 0.001230684 |
| 8 | 预期的链上失败回执 | [0x39a1…6d131](https://explorer.testnet.arc.io/tx/0x39a19ee558a75d8cc6f705b171db9090f90c2f0aea1a7214a14428a13d36d131) | `reverted`，0 日志 | 0.000447153 |

执行报告中的 `ARC-01` 至 `ARC-12` 均为 PASS，覆盖精度、部署字节码、精确授权、转账与往返、业务事件、普通签名、EIP-712/ ERC-1271、错误链域及 nonce 重放拒绝、成功和刻意失败的回执。错误链域、无授权及重放是只读模拟/合约调用拒绝检查，没有额外广播失败交易。总共广播 **9 笔**，符合最多 12 笔的范围。

## 执行后独立只读核对

另用只读 RPC 在工作流结束后逐笔重取交易及回执，核对发送者、nonce 0–8、状态、Gas 和事件；该核对与执行脚本分开运行，但使用同一官方 RPC，不声称独立节点验证。

- 两个探针运行代码均存在：`ArcCompatibilityProbe` 为 `0xedf49e30c2843cefe4ef86959e809978c72e10df`，`Probe1271Wallet` 为 `0x8c2b3e1befa31085e314873487efe70435d28c09`。
- 0.001 转出与返还各有 6 位 ERC-20 和 18 位系统 Transfer；0.01 原子往返有两组对应事件。它们各代表一次实际移动，不双计业务金额。
- 探针及 ERC-1271 钱包的原生和 ERC-20 USDC 余额均为 **0**；owner 对探针的剩余授权为 **0**。
- 实际 Gas 合计 **0.039161031 测试 USDC**，最大单笔 **0.022071609**，分别低于 2 和 0.25 的上限。owner 最终余额 **4.960838969 测试 USDC**，恰为 5 减去实际 Gas；确认与待处理 nonce 均为 **9**，没有未决交易。
- 最后一笔失败回执是计划内的 `expectedFailure` 调用，消耗 Gas 但没有转走测试 USDC。

正常路径已完成并核对残余为零。后续不可把本次运行重新执行成第二轮测试；新增的一次性钱包 nonce 检查会在已使用钱包上阻止重复启动，复测须制定新计划和新专用钱包。

## 范围与下一步

未验证：浏览器钱包登录/多用户 SIWE、Cloudflare 真实账号资源、六工具业务合约、主网资金、安全审计及无法安全复现的冻结/网络边缘状态。它们分别留在后续阶段，不随 M0-D 一起标记通过。下一子阶段是 **M0-E 技术验证收口**：汇总各项状态、历史与本次证据、风险和后续阶段归属。
