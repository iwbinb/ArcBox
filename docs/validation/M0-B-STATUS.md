# M0-B · 开发工具链与 CI 基线验收

日期：2026-09-23。状态：**PASS_CI / 开发交付待 PR 审查合并**。完整 M0 仍未通过，M0-C/M0-D/M0-E 未执行；没有部署网站、创建 Cloudflare 云资源或发送资金。

## 1. 证据与精确版本

本报告保存的是已读取的 GitHub Actions 日志中的结果，不是本地重新执行的结果。

- 测试源码：`febce62a21c8a3b127cdc4ad2465da9662fd6506`。
- [成功运行 35825856375](https://github.com/iwbinb/ArcBox/actions/runs/35825856375)，push 触发，2026-09-23 06:14:38–06:15:05 UTC，completed/success。
- [必需检查任务 107067290687](https://github.com/iwbinb/ArcBox/actions/runs/35825856375/job/107067290687)：已读取完整日志。
- [独立只读 RPC 任务 107067290839](https://github.com/iwbinb/ArcBox/actions/runs/35825856375/job/107067290839)：已读取完整日志。
- [日志提取的结构化报告](m0-b/ci-report.json)；该 JSON 保留运行生成的 source SHA、时间与结果，没有改成后续文档提交的 SHA。
- 本报告加入后的提交会再次运行 CI；最新提交/PR 合成合并版本的结果在 Actions 与 PR 记录中核验，不能用本次报告替代任何未来代码测试。

## 2. 实际结果

| 项目 | 结果 | 证据范围 |
|---|---|---|
| 固定 Node/pnpm | PASS | 22.23.2 / 10.34.5；pnpm tarball SHA-512 校验 |
| 冻结安装 | PASS | 读取已提交 lock；日志 resolution step skipped；91 个包实际下载、0缓存复用 |
| 依赖/脚本/权限检查 | PASS | 11 项直接依赖、锁文件、已装版本、工作流限制与秘密文件忽略 |
| TypeScript | PASS | web、worker、tools 三份配置均通过 |
| Node 单元测试 | 46 PASS / 0 FAIL / 0 SKIP | 原27项探针 fixture +19项工具链/负向控制 |
| workerd 启动探针 | 1 PASS / 0 FAIL / 0 PENDING | 在固定 Cloudflare Vitest 运行时执行；不是D1/R2/Queues验收 |
| 静态资产构建 | PASS | Vite生成HTML与JS；不是产品UI验收 |
| Worker 构建 | PASS | Wrangler deploy --dry-run；日志明确退出，没有上传 |
| Solidity 编译 | PASS | 0.8.37+commit.f401782d.Emscripten.clang；ABI/bytecode生成，不代表EVM执行通过 |
| 安装/检查后源文件未变 | PASS | git diff及未跟踪文件检查通过；lock未自动改写 |
| Arc 测试网只读 | 6 PASS | 独立job，单一示例钱包与固定区块读取 |

合计是47项本地运行时/单元测试，其中仅1项workerd启动测试；另有6项真实RPC只读检查。它们不等于53项资金或链上业务测试。

## 3. 直接依赖基线

Node22.23.2、pnpm10.34.5、TypeScript5.9.3、Vite7.3.6、Vitest4.1.11、Cloudflare Vitest plugin1.2.1、Wrangler4.136.1、Workers types5.20260921.1、Node types22.20.4、solc0.8.37、yaml2.9.1、Vitest runner/snapshot4.1.11。详细来源、升级与限制见 [TOOLCHAIN](TOOLCHAIN.md)。没有配置 React 产品组件、钱包 SDK 或 Foundry EVM 测试。

## 4. 构建产物证据

下列哈希来自上述成功运行，产物未提交到源码仓库；构建脚本会重新生成并输出哈希。

| 产物 | bytes | SHA-256 |
|---|---:|---|
| dist/contracts/CompilerProbe.json | 920 | f1980530afbf78f9a595c30819ca344f741b740ff7d7d66bbcd4037280f30ac9 |
| dist/web/assets/index-C6dnOzMI.js | 826 | 92b32e469c962a0d7ded51b285cf33e7dbbf31561aae52f85dbb44e40ecd413d |
| dist/web/index.html | 559 | 5f3903aff4f5534a2cf461867e6e41fc120837aaa8649fe7adcfc589c6d9d800 |
| dist/worker/index.js | 563 | 7a7b121a1e68020d3de5f419d5b706a5de5bcb889e776cdec44bae92f8ba1382 |

锁文件 SHA-256：`1f28da280847509789c0b82ab52bd87e27c62c60e20c0c2c7c67d9b2bb7b9b05`；生成与 Git blob 校验流程见 TOOLCHAIN。供应商的间接预发行依赖已明确记录，不声称通过完整供应链安全审计。

## 5. 真实只读观察

时间2026-09-23T06:14:46.502Z；chainId5042002；区块63547235；hash `0x2d09d98cf6d0fe9256d74300e9a5046823b1389e4a71ef3b8dc7bca578c914bd`。USDC decimals6；固定示例地址的原生U18除10^12取整与ERC20U6一致；allowance0；再次读取区块hash一致。

示例地址 `0x0000000000000000000000000000000000000001` 不是用户/项目钱包，不能向其入金。余额关系仅针对这一地址这一块，不能外推为全链证明。未执行approve、transfer、钱包签名、receipt双日志或终局性验证。

## 6. 本轮修正与透明记录

首个完整 CI [35825704745](https://github.com/iwbinb/ArcBox/actions/runs/35825704745) 的冻结安装/类型检查通过，但46项Node测试有1项失败。原因是故意失败的子node:test继承父runner的NODE_TEST_CONTEXT，递归发现被跳过并退出0。

修复仅隔离子进程测试环境，并增加实际tests1/fail1/skipped0断言；没有跳过负向用例或忽略失败。修正后重新完整运行得到上述46+1通过。

历史临时锁文件任务曾使用一次contents:write，仅创建未挂接的Git blob；未修改分支/主分支，也无生产Secrets。该临时工作流已从最终树删除；常驻CI是contents:read。不能把历史临时写权限说成全程只读。

## 7. 交付与未做项

已有：精确工具链、生成锁文件、三个类型检查目标、编译探针、权限/版本回归检查、真实负向控制、只读CI、可复现命令和证据。原PR #1已关闭且未合并，本分支从最新main独立建立，并复用原只读探针源文件；不恢复或合并旧PR。

未做：Cloudflare账号授权/云资源，D1/R2/Queues行为测试，钱包签名/测试币合约交易，正式产品UI，业务合约，生产Secrets，分支保护变更，主网部署，真实资金。workflow_dispatch尚未实际触发；Linux结果不代表macOS/Windows已验证。

下一项：**M0-C：Workers 运行时与 D1/R2/Queues 最小验证**。本次在M0-B交付处停止，不将整体M0改为PASS。
