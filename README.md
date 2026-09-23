# ArcBox

**你的链上实用工具箱 · Practical USDC tools, in one place.**

ArcBox 是面向创作者、小团队、活动组织者的 **Arc / USDC 工具集合站**。六个工具能独立使用，也能通过订单、交付权限和已结算收入组合使用。它不是单一支付产品，也不是跳转到第三方的工具导航站；品牌不绑定 NodeStake。

> **文档基线：产品设计规格 v1.0；全阶段开发与部署总计划 v1.1，2026-09-23。M0-B 工具链已合并，M0-C 本地运行时验证已有通过记录；不是已经部署的产品应用。**
> 文档包含产品、页面、交互、六工具业务规则、合约边界、数据/API、Cloudflare 部署、安全、测试和分阶段开发计划。示例均为模拟数据；不代表真实用户、交易、安全审计或获奖承诺。

## 六个工具

| 工具 | 用户要完成的事 | 规格 |
|---|---|---|
| 交付收款 Deliver | 卖数字文件，付款后获得访问权限 | [完整设计](docs/tools/01-DELIVER.md) |
| 成团收款 Group | 达到付费席位门槛才成团，否则退回本金 | [完整设计](docs/tools/02-GROUP.md) |
| 合伙分账 Split | 将已可结算收入按固定比例分给成员 | [完整设计](docs/tools/03-SPLIT.md) |
| 报名保证金 Attend | 报名存保证金，经核验到场后可领取退款 | [完整设计](docs/tools/04-ATTEND.md) |
| 分阶段付款 Milestones | 先为当前阶段入金，再提交、验收和放款 | [完整设计](docs/tools/05-MILESTONES.md) |
| 奖励领取 Rewards | 按不可变名单，让合资格地址自助领取 USDC | [完整设计](docs/tools/06-REWARDS.md) |

## 阅读入口

1. [从这里开始：范围与文档导航](docs/00-START-HERE.md)
2. [产品策略](docs/01-PRODUCT-STRATEGY.md) · [网站与用户路径](docs/02-SITE-IA-AND-UX.md)
3. [设计系统](docs/03-DESIGN-SYSTEM.md) · [页面规格](docs/04-SCREEN-SPECIFICATIONS.md) · [共享流程](docs/05-SHARED-FLOWS.md)
4. [系统架构](docs/architecture/01-SYSTEM.md) · [数据/API](docs/architecture/02-DATA-AND-API.md) · [合约与资金](docs/architecture/03-CONTRACTS-AND-FUNDS.md)
5. [Cloudflare 部署](docs/architecture/04-CLOUDFLARE-DEPLOYMENT.md) · [安全与运维](docs/architecture/05-SECURITY-AND-OPERATIONS.md)
6. **[全阶段开发与部署总计划 v1.1](docs/delivery/01-CODEX-PLAN.md)** · [验收清单](docs/delivery/02-TEST-AND-ACCEPTANCE.md) · [演示与参赛](docs/delivery/03-DEMO-AND-SUBMISSION.md)
7. [决策记录](docs/06-DECISIONS.md) · [来源与待验证假设](docs/research/SOURCES-AND-ASSUMPTIONS.md)
8. [M0-B 验收报告](docs/validation/M0-B-STATUS.md) · [工具链与复现](docs/validation/TOOLCHAIN.md)
9. **[M0-C 验收报告](docs/validation/M0-C-STATUS.md)** · [运行时探针与用例矩阵](docs/validation/RUNTIME-PROBES.md) · [M0 进度](docs/validation/M0-STATUS.md)

开发者先读 [AGENTS.md](AGENTS.md) 和总计划 v1.1。执行拆分为 **M0—M10 共 11 个开发阶段 + D0—D3 共 4 个部署检查点**，每轮只完成一个明确子阶段，测试、提交、汇报后停止。M0-B 已通过并合并；M0-C 新增 41 项本地运行时/HTTP 测试，与原有 47 项回归均通过，交付待 PR 审查合并。完整 M0 尚未通过；下一项 **M0-D：Arc 最小真实兼容验证** 需先确认专用测试钱包与测试币操作范围，本轮不执行链上写操作。

## 工具链与运行时复现

先使用 `.node-version` 的 Node 22.23.2 和 `packageManager` 指定的 pnpm 10.34.5，再运行：

```bash
pnpm install --frozen-lockfile
pnpm verify
```

没有 pnpm 时参照 [工具链说明](docs/validation/TOOLCHAIN.md)。`pnpm verify` 执行静态/类型检查、Node 单元测试、Vite/Worker/Solidity 编译、workerd 启动与 D1/R2/Queues 本地绑定测试，以及实际构建产物的 Assets 路由测试；不会部署或转账。可用 `pnpm test:bindings`、`pnpm test:assets` 单独检查新增部分。报告保存准确源码 SHA、结果与锁文件哈希。

Arc 测试网只读检查使用独立命令 `pnpm probe:arc`。`apps/web` 当前仅为明确标识的编译探针，不是正式网站 UI；本地绑定通过不代表真实 Cloudflare 账号的资源、限额或 S3 签名访问已经验证。

## 架构基线

**Cloudflare Workers + Static Assets** 承载网站和 API；D1 保存业务配置及链上状态索引，私有 R2 保存交付文件，Queues/Cron 处理异步任务。资金规则部署到 Arc 的独立合约实例。**首版不需要 VPS；Pages 不是本版默认部署路径。**

应用金额只用 ERC-20 USDC 的 6 位精度，Gas 单独读取原生 18 位精度。网络、合约地址和运行行为必须在 M0 按官方资料与真实 RPC 重新验证，不能把旧教程、演示配置或对话中的例子直接当成部署结果。

## 交付与上线分开

完整设计覆盖全部六工具。建议按 **共享基础 → Split → Deliver → Group → Rewards → Attend → Milestones** 开发。参赛最小可用主线是 Deliver + Group + Split；这不删减其余工具规格。未上线工具标注“规划中 / Preview”，不允许真实入金。

资金不得进入运营方通用钱包；可退款本金不得进入分账。暂停新业务不能剥夺已经获得的退款/领取权。合约托管、代码公开、主网运行均不等于无风险。正式收款前必须完成兼容性实测、资金不变量与权限测试、独立安全审查，以及适用业务规则/合规审阅。
