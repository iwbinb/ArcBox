# M0 技术验证 · 当前进度

2026-09-23。**M0 IN PROGRESS，不是整体PASS。**本状态是分阶段证据索引，历史结果不覆盖为新版本结果。

| 子阶段 | 状态 | 证据与边界 |
|---|---|---|
| M0-A：GitHub/Actions与只读探针 | PASS_CI_READONLY | [运行35820224910](https://github.com/iwbinb/ArcBox/actions/runs/35820224910)，27项离线fixture+6项实际测试网只读检查；没有签名/转账 |
| M0-B：工具链与CI | PASS_CI，待PR审查合并 | [验收报告](M0-B-STATUS.md)、[复现说明](TOOLCHAIN.md)、[运行35825856375](https://github.com/iwbinb/ArcBox/actions/runs/35825856375)；精确代码版本见报告 |
| M0-C：绑定与运行时语义 | NOT_RUN | D1 batch/CAS/outbox、R2与Queues；1项workerd启动测试不替代此阶段 |
| M0-D：钱包与Arc实际交易 | NOT_RUN | 专用测试钱包、签名、approve/transfer、合约执行、真实receipt |
| M0-E：技术验证收口 | NOT_RUN | 必须完成剩余项后综合审查 |

主分支的当前执行计划仍是 [v1.1](../delivery/01-CODEX-PLAN.md)。M0-B采用独立feature PR；没有改动main或启动M1。旧PR #1已关闭且未合并；本分支复用原探针而不重新打开该PR。

当前代码容器与GitHub托管执行器是不同通道。此前容器DNS失败保留为历史事实，本轮是在Actions真实安装/运行，不宣称修复了容器网络。GitHub Actions权限已获用户授权，不再重复申请相同权限。

没有Cloudflare云端资源/生产授权/主网资金动作。进入相应阶段再确认账号、资源预算、域名及钱包操作范围；秘密不进入聊天或仓库。下一项仅M0-C。
