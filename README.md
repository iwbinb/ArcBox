# ArcBox

**你的链上实用工具箱 · Practical USDC tools, in one place.**

ArcBox 是一个面向独立创作者、小团队、活动组织者的 **Arc / USDC 工具集合站**。六个工具可单独使用，也可通过共享订单、规则快照、交付权限及分账配置组合使用。它不是单一支付产品，不是工具链接导航站，也不绑定 NodeStake。

> 当前仓库是产品与工程设计交付，不是已经部署的应用。所有示例金额、页面数据和验收目标均为设计示例；没有真实客户、交易量、安全审计或获奖承诺。

## 六个工具

| 工具 | 一句话用途 | 设计文档 |
|---|---|---|
| 交付收款 Deliver | 卖数字商品，确认付款后提供文件访问 | [详细设计](docs/tools/01-DELIVER.md) |
| 成团收款 Group | 人数达标才成团，不达标可取回本金 | [详细设计](docs/tools/02-GROUP.md) |
| 合伙分账 Split | 按事先确认的比例分配可结算收入 | [详细设计](docs/tools/03-SPLIT.md) |
| 报名保证金 Attend | 报名交保证金，核验到场后可领回 | [详细设计](docs/tools/04-ATTEND.md) |
| 分阶段付款 Milestones | 资金先到位，再按阶段提交和验收 | [详细设计](docs/tools/05-MILESTONES.md) |
| 奖励领取 Rewards | 导入名单，让符合资格的地址自助领取 | [详细设计](docs/tools/06-REWARDS.md) |

## 从哪里开始

- **了解全站与范围：** [START HERE](docs/00-START-HERE.md) → [产品设计](docs/01-PRODUCT-STRATEGY.md)。
- **设计与前端：** [网站信息架构](docs/02-SITE-IA-AND-UX.md) → [设计系统](docs/03-DESIGN-SYSTEM.md) → [页面规格](docs/04-SCREEN-SPECIFICATIONS.md)。
- **后端与合约：** [共享流程](docs/05-SHARED-FLOWS.md) → [系统架构](docs/architecture/01-SYSTEM.md) → [数据与 API](docs/architecture/02-DATA-AND-API.md) → [资金与合约](docs/architecture/03-CONTRACTS-AND-FUNDS.md)。
- **交给 Codex：** 先读 [AGENTS.md](AGENTS.md)，按 [开发任务与交付顺序](docs/delivery/01-CODEX-PLAN.md) 执行，用 [验收清单](docs/delivery/02-TEST-AND-ACCEPTANCE.md) 验证。
- **参赛：** [演示与提交](docs/delivery/03-DEMO-AND-SUBMISSION.md)。
- **事实与假设：** [官方资料、核验记录和待决项](docs/research/SOURCES-AND-ASSUMPTIONS.md)。

## 设计基线

完整设计覆盖六个工具。建议首个可提交版本优先完成 **交付收款 + 成团收款 + 合伙分账**，其余工具完整保留规格并逐步上线。未完成工具必须标注“规划中 / 仅演示”，不能伪装成可交易功能。

拟采用清晰、克制的浅色模块化界面，局部磨砂导航；移动端优先保证付款、退款、领取体验。部署建议为 Cloudflare Pages 静态前端 + Workers API/任务 + D1 + 私有 R2；这是本设计建议，不是已经创建的基础设施。

资金默认使用用户钱包与按工具隔离的规则合约，不进入运营方通用收款钱包。**合约托管并不等于无风险或自动免责**；主网上线前必须完成兼容性实测、权限审查、资金不变量测试、独立安全审查和适用业务规则审阅。

设计版本：**v0.1 / 2026-09-23**。网络事实以官方资料为核验依据，部署前仍需复验。当前无应用代码、生产合约、真实私钥或生产凭证。
