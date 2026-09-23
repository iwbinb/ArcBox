# Arc 兼容性探针 · 使用说明与边界

M0-D 开发交付，2026-09-23。真实测试网结果见 [M0-D 公开测试网验收](M0-D-PUBLIC-TESTNET.md)；最初的本地开发状态保留在 [历史报告](M0-D-STATUS.md)。这不是生产支付 SDK、六工具合约或钱包托管服务。

## 1. 文件职责

| 路径 | 责任 |
|---|---|
| probes/arc/runtime.json | Arc 执行器发行包/hash、网络、编译目标与测试限额登记 |
| scripts/toolchain/setup-arc-foundry.mjs | Linux x64 校验下载并安装本地执行器 |
| probes/arc/ArcCompatibilityProbe.sol | 受限原子往返、签名验证及 ERC-1271 fixture |
| probes/arc/TokenFixtures.sol | 仅 localhost 的错误返回/转账行为模型 |
| probes/arc/lib.mjs | 金额、网络、费用、回执、单笔回执日志和授权前置检查 |
| probes/arc/scenario.mjs | 本地与测试网复用的 12 项场景检查 |
| scripts/m0/compile-arc.mjs | 固定 solc / OpenZeppelin 编译与源文件 hash |
| scripts/m0/probe-arc-sdk.mjs | 无签名权限的公开测试网 SDK 只读观察 |
| scripts/m0/arc-testnet-write.mjs | 默认关闭的公开测试网写入口 |
| scripts/m0/arc-testnet-preflight.mjs | 受保护钱包的离线签名与公开测试网只读预检 |
| .github/workflows/m0-d-testnet.yml | 仅手动触发、仅 dev、需环境审批的预检与限定执行入口 |
| tests/arc/guards.test.mjs | 32 项负向/防护测试 |
| tests/arc/local.integration.test.mjs | 8 项本地 Arc EVM 集成测试 |
| scripts/m0/verify-arc.mjs | 汇总真实执行结果，保留公开写入 NOT RUN |

## 2. 无公开链写入的复现

使用仓库锁定的 Node / pnpm；当前自动安装器只支持 Linux x64。其他系统没有经过本轮验证，不自动下载不明替代发行包。

```bash
pnpm install --frozen-lockfile
pnpm setup:arc
pnpm verify
```

`setup:arc` 需要下载固定发行包；`verify` 执行原有 88 项回归与新增 40 项测试。本地 Arc 引擎只监听 127.0.0.1，使用无真实价值的本地开发账户，退出时终止子进程。不会连接 Cloudflare 账号，也不会广播公开链交易。

单独运行：

```bash
pnpm test:arc       # 编译 + 防护 + 本地 Arc 执行；先完成 setup:arc
pnpm probe:arc      # 原6项公开测试网只读检查
pnpm probe:arc:sdk  # 新7项SDK只读检查，有界读取历史回执
```

原 M0-C 回归报告和新 M0-D 报告分别保存，不篡改旧报告含义。每份证据使用实际 git HEAD / PR head / run ID。编译后产物在 dist/arc，本轮生成的 report 在 reports；均不提交为生产部署结果。

## 3. 证据矩阵

| 能力 | 本地 Arc | 公开测试网当前证据 |
|---|---|---|
| decimals / shared balance / allowance read | PASS | 新钱包和实际交易前后只读 PASS |
| 最小探针部署与运行字节码核对 | PASS | 两个新探针部署、链上代码核对 PASS |
| ERC-20 transfer / returnToken | PASS | 0.001 测试 USDC 转出及固定 owner 返还 PASS |
| 精确 approve / SafeERC20 transferFrom 原子往返 | PASS | 0.01 测试 USDC 授权与原子往返 PASS；执行后授权 0 |
| 双事件精度匹配、业务事件独立 | PASS | 新交易的 6 位 ERC-20 与 18 位系统日志对应，业务事件单列 PASS |
| receipt success / deliberate mined revert | PASS | 8 笔成功和 1 笔计划内失败回执 PASS |
| EOA personal-sign / EIP-712、已部署 ERC-1271 | PASS | EOA 与已部署 ERC-1271 签名验证/消费 PASS；并非生产 SIWE |
| 错 chain/domain/signer/expiry/nonce replay | PASS | 错 chain/domain 与 nonce 重放的公开链只读拒绝路径 PASS；其余边界保留本地证据，未额外广播失败交易 |
| 0/self/原生最小单位精度 | PASS | 未在公开链主动复现 |
| false/revert/no-return/扣费型代币 | 合成模型 PASS | 不声称改动/测试公开 USDC 黑名单 |
| 浏览器钱包登录、多用户 SIWE / RBAC | 不在本探针范围 | 留 M2，未通过 |
| 公共网络共识、拥堵、重组边缘行为 | 本地不能证明 | 未验证 |

12项共用场景检查属于 EVM-01 一个测试：共享余额→部署2个探针→直接转账→固定owner返还→无授权模拟拒绝→精确授权→原子往返/事件/Gas→订单重复拒绝→普通签名→EOA结构化签名→ERC1271结构化签名→刻意失败回执。正常执行9笔签名交易。

## 4. 金额与日志注意点

业务探针仅调用官方 ERC-20 USDC 接口，金额为6位最小单位整数；Gas和原生余额是18位，两份余额不能求和。直接转账为0.001测试USDC，原子往返为0.01测试USDC；不以浮点数计算。日志按 emitter 区分，Gas根据 receipt计算，不把Gas当Transfer。

`pairedTransfers` 是**单笔已经核验的 receipt.logs** 的核验器，调用者必须先确保网络/交易来源；它不是通用全链索引器，不要传入跨交易混合日志后据此给用户入账。它逐一匹配同一笔回执中的实际移动，不将双事件算成两笔业务付款。主产品仍需以后按实例白名单及业务事件核验订单。

零额和自转账的系统事件行为另有本地用例。依赖版本和网络行为改变后重跑，不把历史样本替代未来所有交易验证。

## 5. 一次性公开测试网执行确认卡（已完成）

用户已授权限定的 M0-D 测试网操作；以下条件已在 [受保护执行](https://github.com/iwbinb/ArcBox/actions/runs/35868308292)中核验。这是该专用钱包的一次性验证记录，不是重新执行的操作指引：

- 网络仅 Arc testnet，chainId 5042002，固定官方RPC；没有 mainnet 模式。
- 仅使用已登记的专用测试钱包和水龙头测试币；禁止主钱包、真实资产和公开开发助记词账户。
- 部署 ArcCompatibilityProbe 与 Probe1271Wallet 两个最小测试合约，不部署业务合约。
- 允许精确授权、小额转账与返还、原子 transferFrom 往返、签名消费、一次预期失败回执测试。
- 普通单次移动≤0.01测试USDC；单笔Gas最大0.25、整次运行最大2测试USDC、最多12笔，正常9笔。启动需要≥2.1测试USDC余量；这是保守额度，不是预估必须花2。
- 正常完成余额和授权归零；异常需先核对证据再继续，不自动换 nonce 重发。

GitHub `arcbox_testnet` 环境限制为 `dev` 并要求 `iwbinb` 审批；私钥只在环境 Secret，本机恢复材料只在登录钥匙串。预检在 5.000000 测试 USDC、nonce 0 时报告 `READY`；单独批准的 `execute` 随后完成 9 笔交易，钱包 nonce 已为 9。审批使用同一 GitHub 账号，不声称独立双人控制。常驻 CI 不读取私钥、不执行写入命令。**不要在这个钱包上重跑 `execute`；后续复测须另定方案和新专用钱包。**

入口要求显式确认标记、专用地址匹配以及受保护进程内的专用测试密钥。不能把环境值写到仓库、聊天或公开日志。没有配置时运行会在任何RPC之前返回 BLOCKED；此负向路径已实际测试。

## 6. 写入的行为限制与恢复

每次交易前再检查chainId、待确认nonce与目标白名单，模拟/估算后核对费用预算。新合约部署后核对运行代码（排除合法immutable填充）及固定owner/token，才将其加入目标集合。

签名前记录nonce/动作/目标，广播成功后立即记录hash；广播结果或回执不确定即停止。正常 `roundTrip` 的取款与返还在同一笔交易中完成，失败则整体回滚。直接转账测试先给新建的固定owner合约，再执行返还；两笔之间中断时，owner需核对余额并手动恢复，不能宣称永不留款。

恢复检查顺序：执行报告→已广播hash/nonce→合约代码和固定owner→剩余授权→探针/1271余额→只针对未完成动作制定新的确认方案。已有成功动作不盲目重做。USDC地址受限等外部原因可能阻止转出，不承诺脚本绕过代币规则。

运行记录保存在 GitHub runner 上忽略的 `.toolchain/live-runs/run-*` 私有文件夹，不保存私钥或原始签名交易；其无秘密报告已在运行摘要和 [结构化证据](m0-d/public-testnet-35868308292.json)中保留。实际广播与执行后状态见 [验收报告](M0-D-PUBLIC-TESTNET.md)。

## 7. 官方依据与本轮选择

- [Arc EVM differences](https://docs.arc.io/arc/references/evm-differences)：Arc模拟器差异、Osaka基线、Gas及网络行为。
- [Arc USDC system events](https://docs.arc.io/arc/references/usdc-system-events)：两套日志的地址与精度。
- [Arc网络配置](https://docs.arc.io/arc/references/connect-to-arc)：测试网连接参数。
- [官方Arc Foundry发行 v0.8.0-2](https://github.com/circlefin/arc-foundry/releases/tag/v0.8.0-2)：固定发行包；实际hash和二进制版本见验收报告。
- [OpenZeppelin cryptography](https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography)、[ERC-20工具](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20)：使用已锁定库，不手写替代签名/安全转账算法。
- [EIP-712](https://eips.ethereum.org/EIPS/eip-712)、[ERC-1271](https://eips.ethereum.org/EIPS/eip-1271)：签名接口及上下文；nonce和期限仍由探针显式限制。

资料不是本项目安全认证；本地测试不是公共测试网运行记录，也不是生产资金合约审计。
