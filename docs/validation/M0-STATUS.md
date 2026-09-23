# M0 技术验证 · 当前进度

2026-09-23。**M0 IN PROGRESS，不是整体 PASS。**本状态为分阶段证据索引，历史结果不覆盖为新版本结果。

| 子阶段 | 状态 | 证据与边界 |
|---|---|---|
| M0-A：GitHub/Actions 与只读探针 | PASS_CI_READONLY | [运行35820224910](https://github.com/iwbinb/ArcBox/actions/runs/35820224910)，27项离线fixture+6项测试网只读；没有签名/转账 |
| M0-B：工具链与 CI | PASS_CI，PR #2 已合并 | [验收报告](M0-B-STATUS.md)、[复现说明](TOOLCHAIN.md)、[PR #2](https://github.com/iwbinb/ArcBox/pull/2)；合并基线55bf663 |
| M0-C：绑定与运行时语义 | PASS_LOCAL_CI，待本轮 PR 审查合并 | [验收报告](M0-C-STATUS.md)、[探针说明](RUNTIME-PROBES.md)、[运行35832021323](https://github.com/iwbinb/ArcBox/actions/runs/35832021323)；新增41项+回归47项，全部通过 |
| M0-D：钱包与 Arc 实际交易 | NOT_RUN | 专用测试钱包、签名、approve/transfer、合约执行、真实receipt；开始前确认操作范围 |
| M0-E：技术验证收口 | NOT_RUN | 完成剩余项后综合审查，不因前三项通过就自动标完成 |

执行计划仍为 [v1.1](../delivery/01-CODEX-PLAN.md)。本轮从PR #2合并后的main `55bf663b6704e9af1e457cbc1166d8175bc07ff4` 创建独立分支，只实施M0-C；没有合并本轮PR或启动M1。旧PR #1已关闭且未合并，无需重开。

M0-B验收报告记录的是当时状态，PR #2后来合并的事实由本索引补充，不篡改历史测试记录。M0-C也按准确source SHA保存证据，后续文档head/PR合成版本以其独立Actions为准。

代码容器与GitHub托管执行器是不同通道。此前容器DNS失败保留为历史事实，本轮在Actions安装并运行，不宣称修复容器网络。GitHub Actions测试权限已获授权，不重复申请。

**没有Cloudflare云端资源/生产部署/链上资金操作。**本地绑定测试不等于真实Cloudflare账号验证；云端资源与S3签名留在后续部署检查点。下一项仅M0-D，链上写测试前确认专用测试钱包和测试币范围；秘密不进入聊天或仓库。
