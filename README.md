# ArcBox

**你的链上实用工具箱 · Practical USDC tools, in one place.**

ArcBox 是面向创作者、小团队、活动组织者的 **Arc / USDC 工具集合站**。六个工具能独立使用，也能通过订单、交付权限和已结算收入组合使用。它不是单一支付产品，也不是跳转到第三方的工具导航站；品牌不绑定 NodeStake。

> **文档基线：产品设计规格 v1.0；全阶段开发与部署总计划 v1.1。M0-A 至 M0-E 按限定技术探针范围完成；M1-A/B/C 与 D0 无资金网站预览已验收；M2-A 身份、工作区与权限和 M2-B 共享订单/同步管线已有本地验收证据。[查看 Demo 预览](https://arcbox-web-demo.iwbinb.workers.dev/)。身份/订单后台的 Cloudflare 云端部署、真实浏览器扩展订单流程、六工具业务及主网仍未验收。**
> 文档包含产品、页面、交互、六工具业务规则、合约边界、数据/API、Cloudflare 部署、安全、测试和分阶段开发计划。示例均为模拟数据；不代表真实用户、交易、安全审计或获奖承诺。

Demo 预览已接入 `dev` 的 [GitHub 自动部署](docs/validation/DEMO-AUTO-DEPLOY.md)：四项检查全部通过后更新 Cloudflare；PR 和 `main` 不触发发布。**M2-A 身份 Worker 和 M2-B 订单服务不属于 Demo 部署。**

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
9. [M0-C 验收报告](docs/validation/M0-C-STATUS.md) · [运行时探针与用例矩阵](docs/validation/RUNTIME-PROBES.md)
10. **[M0-E 技术验证收口](docs/validation/M0-E-CLOSURE.md)** · [M0-D 公开测试网验收](docs/validation/M0-D-PUBLIC-TESTNET.md) · [历史开发报告](docs/validation/M0-D-STATUS.md) · [Arc 探针复现及边界](docs/validation/ARC-COMPATIBILITY.md) · [M0 进度](docs/validation/M0-STATUS.md)
11. **[M1-A 四类视觉基准](docs/validation/M1-A-STATUS.md)** · [独立交互原型](design/m1-a/README.md) · [视觉 QA](design/m1-a/design-qa.md)
12. **[M1-B 正式网站骨架](docs/validation/M1-B-STATUS.md)** · [无资金演示入口](apps/web/index.html)
13. **[M1-C / D0 Cloudflare 无资金预览验收](docs/validation/M1-C-D0.md)** · [实际预览网站](https://arcbox-web-demo.iwbinb.workers.dev/)
14. [Demo 自动部署接入与激活状态](docs/validation/DEMO-AUTO-DEPLOY.md)
15. **[M2-A 身份、工作区、草稿与权限验收](docs/validation/M2-A-STATUS.md)**
16. **[M2-B 订单、回执、账本与链上同步验收](docs/validation/M2-B-STATUS.md)**

开发者先读 [AGENTS.md](AGENTS.md) 和总计划 v1.1。执行拆分为 **M0—M10 共 11 个开发阶段 + D0—D3 共 4 个部署检查点**，每轮只完成一个明确子阶段，测试、提交、汇报后停止。M0 最小技术验证与 M1-C/D0 无资金预览已有对应验收证据；M2-A/B 的本地实现不等于云端后台已开通。**本阶段 PR 审查后，下一子阶段是 M2-C 文件、任务与后台。**

## 工具链、运行时、身份与订单测试

使用 `.node-version` 的 Node 22.23.2 和 `packageManager` 指定的 pnpm 10.34.5。在已验证的 Linux x64 环境中运行：

```bash
pnpm install --frozen-lockfile
pnpm setup:arc
pnpm verify
```

没有 pnpm 时参照 [工具链说明](docs/validation/TOOLCHAIN.md)。`setup:arc` 校验并安装固定 Arc 本地执行器；`verify` 执行静态/类型检查、Node/Workers/Assets 回归、Arc 探针、真实本地订单回执捕获与 Worker/D1 回放、本地身份 API 和 Chrome 交互测试。不会创建 Cloudflare 资源或广播公开链交易。浏览器测试需 Chrome 和中文字体，具体范围见 M2-A 报告。

`pnpm test:bindings`、`pnpm test:assets`、`pnpm test:arc`、`pnpm test:identity`、`pnpm test:orders` 可分别运行。`pnpm verify:orders` 另外核对本轮源码和回执捕获证据。公开测试网只读命令为 `pnpm probe:arc` 和 `pnpm probe:arc:sdk`，后者检查有界历史回执，不发送新交易。公开写入口不接入常驻 CI；已验收的专用钱包不可重复执行探针。

`apps/web` 已包含 M1 网站骨架，不再只是编译探针。普通构建/公开 Demo 仍无资金能力；`pnpm build:identity` 的隔离构建在 `/app` 提供 M2-A 工作区，并连接本地 `workers/identity`，操作说明见 [M2-A](docs/validation/M2-A-STATUS.md)。M2-B 只有显式启用的本地订单适配器、API 和同步管线，尚无正式工具合约、签名报价或公开订单付款页面。不能直接将本地全零数据库 ID 或订单探针配置用于云部署。

## 架构基线

**Cloudflare Workers + Static Assets** 承载网站和 API；D1 保存业务配置及链上状态索引，私有 R2 保存交付文件，Queues/Cron 处理异步任务。资金规则部署到 Arc 的独立合约实例。**首版不需要 VPS；Pages 不是本版默认部署路径。**

应用金额只用 ERC-20 USDC 的 6 位精度，Gas 单独读取原生 18 位精度。网络、合约地址和运行行为必须按官方资料与真实 RPC 验证，不能把旧教程、演示配置或对话中的例子直接当成部署结果。

## 交付与上线分开

完整设计覆盖全部六工具。建议按 **共享基础 → Split → Deliver → Group → Rewards → Attend → Milestones** 开发。参赛最小可用主线是 Deliver + Group + Split；这不删减其余工具规格。未上线工具标注“规划中 / Preview”，不允许真实入金。

资金不得进入运营方通用钱包；可退款本金不得进入分账。暂停新业务不能剥夺已经获得的退款/领取权。合约托管、代码公开、主网运行均不等于无风险。正式收款前必须完成兼容性实测、资金不变量与权限测试、独立安全审查，以及适用业务规则/合规审阅。
