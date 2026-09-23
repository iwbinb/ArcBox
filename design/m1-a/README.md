# ArcBox M1-A 视觉基准原型

2026-09-23：用户从三张方向图中选择了第一张“任务搜索优先”首页。原图保存在 [references/home-selected.png](references/home-selected.png)；本目录是独立的、只使用合成内容的响应式原型，**不连接钱包、不发送交易、不部署 Cloudflare**。正式网站代码仍在 M1-B 实现。

## 四类页面

| 基准 | 原型路径 | 1440 | 768 | 375 |
|---|---|---|---|---|
| 工具首页 | `/` | [桌面](screenshots/home-1440.png) | [平板](screenshots/home-768.png) | [手机](screenshots/home-375.png) |
| 创建向导 | `/create/deliver` | [桌面](screenshots/wizard-1440.png) | [平板](screenshots/wizard-768.png) | [手机](screenshots/wizard-375.png) |
| 公共付款 | `/p/demo` | [桌面](screenshots/payment-1440.png) | [平板](screenshots/payment-768.png) | [手机](screenshots/payment-375.png) |
| 工作区 | `/app` | [桌面](screenshots/workspace-1440.png) | [平板](screenshots/workspace-768.png) | [手机](screenshots/workspace-375.png) |

付款页还有单独的[演示凭证状态](screenshots/receipt-1440.png)及[手机状态](screenshots/receipt-375.png)。原型导航与四页链接可直接切换；首页搜索、工具预览、向导校验/步骤、演示授权/付款及凭证返回都可操作。所有付款相关动作只改变本地页面状态，界面持续标明未发生真实交易。

## 视觉决定

- 沿用 `docs/03-DESIGN-SYSTEM.md`：浅色 canvas `#F7F8FA`、白色实底、正文 `#17212B`、主动作蓝 `#2557D6`、24/32 px 主间距；只在导航使用轻微磨砂。资金规则与付款摘要是非透明实底。
- 首页保持选中图的中心标题、任务搜索、3×2 六工具目录和细分隔线。工具名称前置中文用途，英文短名在次级位置；未上线状态统一标“预览”，主要动作“查看方案”。
- 选中图中的个别工具图标色与仓库规范不同；实现以已记录的工具识别色为准：Deliver 蓝、Group 紫、Split 青、Attend 橙、Milestones 靛、Rewards 绿。
- 向导采用 640–720 px 表单主区与约 320 px 规则摘要；付款页去掉工作区导航，金额与演示动作在手机首屏靠前；工作区先展示“待你处理”，不虚构平台收入。
- 付款、授权、凭证三种含义分开。演示凭证不展示虚构交易哈希、已付款权益或真实收款地址。
- 生成图中“达到人数后再收款”等资金句子不作为业务规则；按工具规格将成团改为先付款占席、截止时判定，不成团可退本金，并把分账描述为只分可分配收入。付款摘要预留工具、订单、付款钱包、网络、收款合约、收款方和费用字段。

## 验证与交接

[设计 QA](design-qa.md)保存了选中图和实际渲染的同画面对比、修正记录、浏览器交互与控制台检查。四页在 375、768、1440 CSS px 的 `scrollWidth` 均等于 `clientWidth`；桌面、平板、手机截图保存在 `screenshots/`。本地 `npm run build` 已通过，尚未发布预览网站。

在本目录运行 `npm ci`、`npm run dev` 可查看独立原型；`npm run build` 只构建原型。M1-B 应把确认的视觉系统迁入正式 `apps/web`，补齐双语、工具详情、状态和无资金预览流程，而不是把本原型当成已上线产品。
