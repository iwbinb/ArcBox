# 官方资料、核验记录与假设

核验日期：2026-09-23。以下是本轮实际读取的官方文档；引用表示特定技术依据，不表示官方认可ArcBox。所有产品数值、页面、策略和流程除另有说明均为本包设计，不是外部事实。

## 1. 来源登记

| ID | 官方资料 | 用于本设计的要点 |
|---|---|---|
| S01 | [Arc — Connect to Arc](https://docs.arc.io/arc/references/connect-to-arc) | 连接页列主网5042与测试网5042002；钱包、RPC、网络身份需实测 |
| S02 | [Arc — Stablecoin native model](https://docs.arc.io/arc/concepts/stablecoin-native-model) | 原生18位/ERC-20 6位共享USDC余额、业务接口地址、索引精度边界 |
| S03 | [Arc — Index events](https://docs.arc.io/integrate/infrastructure/indexing-events) | 当前正文区分系统事件与ERC-20事件，按区块/日志顺序处理；确定性终局设计 |
| S04 | [Cloudflare — Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) | 静态资产和Worker应用入口的部署基础 |
| S05 | [Cloudflare — Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/) | 至少一次投递，需消费者幂等 |
| S06 | [Cloudflare — R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) | 对象临时授权；不是天然单次下载或防转发 |
| S07 | [ERC-4361 — Sign-In with Ethereum](https://eips.ethereum.org/EIPS/eip-4361) | 钱包登录消息与校验上下文 |
| S08 | [EIP-712 — Typed structured data](https://eips.ethereum.org/EIPS/eip-712) | 结构化签名域；应用仍需nonce/过期/重放保护 |
| S09 | [OpenZeppelin — Cryptography](https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography) | 签名/合约钱包验证、Merkle验证实现参考；部署前锁定与测试版本 |
| S10 | [Cloudflare — D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/) | prepare、batch事务、Sessions；不是任意传统数据库事务API |
| S11 | [Cloudflare — Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) | Git集成构建发布；不要求仅通过GitHub Actions |
| S12 | [Cloudflare — Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) | scheduled任务配置，UTC调度；不能替代链上时间权利 |
| S13 | [Arc Microgrants](https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq) | 需已运行主网项目、公开仓库与简介；截止2026-10-14 23:59 ET |
| S14 | [W3C — WCAG 2.2](https://www.w3.org/TR/WCAG22/) | 本产品选择AA作为无障碍验收目标，不声称已符合 |
| S15 | [Cloudflare — Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) | 秘密与公开vars分开；本地秘密不入Git |
| S16 | [Cloudflare — Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | CPU/内存/请求等有界限制，M0必须按实际方案测量 |
| S17 | [Cloudflare — D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) | 数据库恢复/备份能力，需演练且不覆盖R2/链状态 |
| S18 | [Arc — EVM differences](https://docs.arc.io/arc/references/evm-differences) | EVM移植与USDC原生资产行为差异，不能直接照搬以太坊假设 |

## 2. 已核验与尚未实测的区别

已核验的是文档页面内容及本轮仓库现状。**本轮未向Arc RPC进行真实钱包交易、未部署合约、未创建Cloudflare资源，也未证明任何第三方SDK版本组合已经通过兼容性测试。**

网络参考值：主网RPC为https://rpc.mainnet.arc.io，测试网为https://rpc.testnet.arc.io；主网浏览器https://explorer.arc.io，测试网https://explorer.testnet.arc.io。来自S01，实际部署必须再次核验返回的chainId及可用性。所有ArcBox合约地址仍未生成。

不要根据web搜索摘要或旧llms.txt推定当前技术状态。本轮观察到索引教程的旧搜索摘要与打开后的最新正文措辞不同；因此只以当前正文和后续真实receipt样例实现精度/事件处理。订单本身仍以ArcBox业务事件为准，减少与底层Transfer形态耦合。

## 3. 产品假设，不是证据

目标用户愿意用Arc USDC、工具组合节省人工、存在订阅付费空间、30分钟交付/24小时退款合理、成团释放规则可接受、仲裁方愿意提供服务、试运行100/1000 USDC限额合适、Cloudflare成本可控——均须访谈、业务审阅或压测确认。

无当期完整参赛名单/评分权重数据，因此不提供获奖概率。没有真实用户试用、营收、审计、合作伙伴或域名商标核验结果，不能把示例包装成这些证据。

## 4. 日期纠正与使用

本包从2026-09-23当前状态规划，不沿用此前对话中9月17日起的已过时排期。S13给出提交截止2026-10-14 23:59美国东部时间，对应北京时间2026-10-15 11:59；主办方保留调整安排的可能，提交前重读官方页面。

开发采用可验收里程碑，不承诺在某个日期自动完成。设计文档/截图/测试网演示不等于满足主网提交门槛。

## 5. 实测记录模板

每次核验记录：日期UTC、来源/版本、网络、命令或测试名、预期、实际结果、区块/交易hash（适用）、截图/日志位置、失败原因、责任人。当前没有这些交易证据时状态只能写NOT RUN，不能用官方文档链接代替实际测试。
