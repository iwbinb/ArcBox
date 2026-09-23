# M1-A · 四类页面视觉基准

日期：2026-09-23。**开发交付：PASS_LOCAL_VISUAL_QA；`dev → main` 仍需 PR 审查。**用户从三张视觉方向图中选择了第 1 张“任务搜索优先”首页。此阶段交付独立的视觉与交互原型，不把它冒充已上线的网站或资金产品。

## 已固定的方向

[选中原图](../../design/m1-a/references/home-selected.png)是首页布局真值：中心任务标题、搜索与场景词、六工具 3×2 目录、细分隔线和明确的“预览”状态。实现沿用 [视觉系统](../03-DESIGN-SYSTEM.md)的浅色 canvas、蓝色主动作、实底资金规则、系统 Latin/CJK 字体和最小阴影。原图的部分工具图标色与既有 token 不同，原型依照既有 token 使用 Deliver 蓝、Group 紫、Split 青、Attend 橙、Milestones 靛、Rewards 绿。

| 基准页面 | 对应规格 | 桌面 1440 | 平板 768 | 手机 375 |
|---|---|---|---|---|
| 首页及工具选择 | P01 | [截图](../../design/m1-a/screenshots/home-1440.png) | [截图](../../design/m1-a/screenshots/home-768.png) | [截图](../../design/m1-a/screenshots/home-375.png) |
| 创建向导与规则摘要 | P09 | [截图](../../design/m1-a/screenshots/wizard-1440.png) | [截图](../../design/m1-a/screenshots/wizard-768.png) | [截图](../../design/m1-a/screenshots/wizard-375.png) |
| 公共付款与规则 | P12 | [截图](../../design/m1-a/screenshots/payment-1440.png) | [截图](../../design/m1-a/screenshots/payment-768.png) | [截图](../../design/m1-a/screenshots/payment-375.png) |
| 工作区待处理 | P07 | [截图](../../design/m1-a/screenshots/workspace-1440.png) | [截图](../../design/m1-a/screenshots/workspace-768.png) | [截图](../../design/m1-a/screenshots/workspace-375.png) |

付款后另有 P13 的[演示凭证桌面状态](../../design/m1-a/screenshots/receipt-1440.png)和[手机状态](../../design/m1-a/screenshots/receipt-375.png)。它们显示应核对的字段，但明确说明未创建订单、未连接钱包、未发送交易。

## 实际验证

- [原图与桌面渲染并排比较](../../design/m1-a/screenshots/home-comparison-1440.png)及[局部网格比较](../../design/m1-a/screenshots/home-comparison-grid.png)已完成；选中图 1487×1058 px 经等比缩放与轻微裁切归一到浏览器截图 1436×1024 px，浏览器 CSS 视口为 1440×1024、DPR 1。逐项核对文字层级、首页网格 y=424/662、主色、图标、文案与底部节奏。
- 在 Codex 内置浏览器实际打开四类页面，于 375、768、1440 CSS px 逐一截屏；每页 `scrollWidth == clientWidth`，无横向溢出。手机首页首屏可见前两个工具；公共付款页首屏可见金额；工作区侧栏改为可触达的横向菜单。
- 实际操作：首页任务搜索及无结果恢复、工具预览、工具对应的向导路由、金额最多 6 位小数校验、规则确认、演示授权与付款分步、凭证状态、手机菜单、工作区新建入口。浏览器控制台错误列表为空。
- 本地 `npm run build` 通过；独立原型的 `npm run test:sites` 为 4 通过、0 失败。CI 新增独立 `M1-A visual baseline build` job，仅冻结安装、构建和检查原型，不发布。
- `dev` 实现提交 `6165fbcf41c07dc1f8569fc7e9a9959f11de2d11` 的 [Actions 35880490542](https://github.com/iwbinb/ArcBox/actions/runs/35880490542) 三个 job 均通过：新增视觉原型 job 完成干净安装、构建与 4 项包检查；原必需检查和 Arc 只读 job 也通过。本次报告补充提交后的最终 PR 合并预检仍需对应准确 head 单独核对。
- [design-qa.md](../../design/m1-a/design-qa.md)保留原图/渲染同画面对比、修正历史与最后 `final result: passed`。对普通文字的目标是 [WCAG 2.2 AA 4.5:1](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)；本轮对关键灰色文字加深并检查主按钮 44 px 触控高度，不宣称完成独立无障碍审计。

## 边界与交接

原型路径为 [`design/m1-a`](../../design/m1-a/README.md)，与正式 `apps/web` 编译探针隔离。演示内容为合成数据；没有真实钱包、文件上传、SIWE、数据库、链上调用、Cloudflare 云部署或公网预览 URL。完整中英双语、六工具详情与生产级空态/错误态在 M1-B 网站骨架及后续阶段实现。视觉选择和原型通过 QA 不等于产品页面已经上线。

**下一子阶段：M1-B 网站骨架。**把已选视觉与四类基准迁入正式站点，补目录/工具详情、创建向导壳、双语和无资金演示；D0 可访问预览在 M1-C 单独验收。
