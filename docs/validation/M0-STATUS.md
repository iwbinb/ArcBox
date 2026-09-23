# M0 技术验证 · 当前进度

2026-09-23。**M0 IN PROGRESS，不是整体 PASS。**本状态为分阶段证据索引，历史结果不覆盖为新版本结果。

| 子阶段 | 状态 | 证据与边界 |
|---|---|---|
| M0-A：GitHub/Actions 与只读探针 | PASS_CI_READONLY | [运行35820224910](https://github.com/iwbinb/ArcBox/actions/runs/35820224910)，27项离线fixture+6项测试网只读；没有签名/转账 |
| M0-B：工具链与 CI | PASS_CI，PR #2 已合并 | [验收报告](M0-B-STATUS.md)、[复现说明](TOOLCHAIN.md)、[PR #2](https://github.com/iwbinb/ArcBox/pull/2) |
| M0-C：绑定与运行时语义 | PASS_LOCAL_CI，PR #3 已合并 | [验收报告](M0-C-STATUS.md)、[探针说明](RUNTIME-PROBES.md)、[PR #3](https://github.com/iwbinb/ArcBox/pull/3)；新增41项+回归47项通过，合并基线ca2a26f |
| M0-D：Arc 兼容性开发与实际交易 | 开发和本地CI通过；公开测试网写入待确认/NOT RUN | [状态报告](M0-D-STATUS.md)、[复现与边界](ARC-COMPATIBILITY.md)、[运行35836560258](https://github.com/iwbinb/ArcBox/actions/runs/35836560258)；128项本地+6项原只读+7项SDK只读通过；完整阶段未PASS |
| M0-E：技术验证收口 | NOT_RUN | M0-D真实测试网证据齐全后再综合审查 |

执行计划仍为 [v1.1](../delivery/01-CODEX-PLAN.md)。本轮从PR #3合并后的main `ca2a26f7f9da582a8ad9b17c7fcc0bce80952ecd` 创建 `feat/m0-d-arc-compatibility`，没有改main或开始M0-E/M1。旧PR #1已关闭且未合并，无需重开。

M0-B/M0-C报告保留当时的准确source SHA与待合并状态，后续合并事实由本索引补充。本轮实际已测试源码为 `b2c95666262ecc02e1505699203b459c9b225679`；后续文档head/PR合成版本以独立Actions为准。

此前容器DNS失败保留为历史事实，本轮实际安装和运行来自GitHub Actions，不宣称修复容器网络。GitHub Actions测试权限已获授权，不重复申请；但该权限不替代专用钱包/测试币写交易授权。

**没有Cloudflare云端资源、生产部署、主网或公开测试网写操作。**本地Arc引擎中确实执行了签名交易，不能混称为公开测试网交易。本轮只读历史回执也不是本项目发送的新交易。

下一项仍为M0-D：确认专用测试钱包、测试币和限定操作，补齐公开测试网写入验收。秘密不进入聊天或公开仓库；未完成前不进入M0-E。
