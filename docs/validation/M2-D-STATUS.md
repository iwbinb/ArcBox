# M2-D · 云端联调与安全回归状态

日期：2026-09-26。**状态：IN_PROGRESS / BLOCKED_CLOUDFLARE_ACCESS。M2-D 未完成，不是测试后台已部署。**

## 已完成的准备

基于已合并 PR #15 的 `main` 提交 `7d9417a55aac4fb239e8f89a984cc89c8a727f59` 开始，直接在 dev 提交预检，没有新建分支、强推或修改 main。首个准备提交为 `6f2f93dbeedd3c1f47d52d1893968ed6f9f8ea1e`。

已实现固定 Cloudflare GET 预检、凭证/响应脱敏、运输失败与权限拒绝分类、有限第一页资源名清单和纯离线单测。只收集受限元数据，不读取用户文件或数据库内容、不输出 Token 或 Account ID。

## 真实云端预检：阻塞

[预检运行 36230748291](https://github.com/iwbinb/ArcBox/actions/runs/36230748291)，job `108373320643`，源码 `6f2f93dbeedd3c1f47d52d1893968ed6f9f8ea1e`。测试与完整执行日志已读取。

| Cloudflare GET | 实际结果 | 能得出的结论 |
|---|---|---|
| Workers scripts | HTTP 200 | 读取成功；当前页包含 `arcbox-web-demo` |
| Workers subdomain | HTTP 403 / 10000 | 该读取被拒绝 |
| D1 database list | HTTP 401 / 10000 | 该读取被拒绝 |
| R2 bucket list | HTTP 403 / 10000 | 该读取被拒绝 |
| Queue list | HTTP 403 / 10000 | 该读取被拒绝 |

凭证已注入（`credentialsPresent=true`），不是“根本没有配置 Token”。同一凭证能读取 Workers，但不能读取其他所需接口；不能由此推断账号未开 R2、资源不存在或钱包配置错误，也未声称已经查看到该 Token 的完整策略。

该作业非零退出，标记 **BLOCKED**，没有吞掉失败。只读成功也不证明写权限、预算获批或云端联调通过。

脱敏原始报告：[JSON](evidence/m2-d-preflight-6f2f93d.json)。原始 ZIP artifact `10902503140`，SHA-256 `b30374c0ea83915132e1a1fab88971b405760dac188e79c839f9915124eee430`。已下载核对，失败历史保留。一次性的 tracked-source archive 仅用于离线代码检查，未含 .git 或运行时配置；其临时导出步骤已从后续工作流移除。

## 代码检查与工作流边界

首次预检的 7 个离线单测通过；随后新增“缺失/无效 Workers subdomain 不能误判为 ready”第 8 个用例。最新提交将 8 项单测纳入原必需 CI，继续跑既有回归。最终 dev/PR SHA、执行结果以本阶段草稿 PR 的验收评论为准；不得用首次运行替代后续版本。

首次 [普通 CI 36230748222](https://github.com/iwbinb/ArcBox/actions/runs/36230748222) 的四项检查和已有 Demo 作业均成功。它不包含 D1/R2/Queue 云端验收，不能抵消独立预检的 401/403。

后续 `.github/workflows/m2-d-preflight.yml`：

- 离线 checks 不读 Secrets；inspect 只在 `iwbinb/ArcBox` 的当前 dev 和仓库开关 `ARCBOX_M2D_PREFLIGHT_ENABLED=true` 时进入固定环境 `arcbox_testnet`。
- 用户必须先创建保护环境、审批者和 dev 分支规则，再启用仓库开关。未启用时云端作业 **SKIPPED / NOT RUN**，不能写成云端通过。
- 新预检不再读取 `arcbox_demo` Secrets；旧 Demo 自动发布工作流保持独立。没有自动资源创建、部署、远端迁移或区块链写入口。
- metadata GET 只发到固定 Cloudflare API，拒绝重定向，不接收任意 URL/HTTP 方法；错误不输出响应正文或秘密。第一页清单仅为初步观察，不作为“所有资源不存在”的证据。
- 进入 inspect 后还检查源码仍为 dev 当前提交。环境审批配置本身需要用户完成，写上 environment 名称并不自动构成保护。

## 尚未执行，不能标为完成

| M2-D 验收项 | 状态 |
|---|---|
| 新独立云环境账号权限/资源范围和预算核准 | BLOCKED / 待用户配置确认 |
| 托管测试 Web/API、Jobs、D1、私有 R2、Queue/DLQ 创建/绑定 | NOT RUN |
| testnet 专用运行配置、云端迁移和部署入口 | NOT IMPLEMENTED |
| 托管 Queue/Cron/RPC/最小测试合约索引闭环 | NOT RUN |
| 实际钱包扩展、拒签/切链/刷新、云端登录 | NOT RUN |
| 云端文件权限、下载、死信和恢复测试 | NOT RUN |
| 数据库/对象恢复、容量和成本告警验证 | NOT RUN |
| M2-D 完整交付及进入 M3 | NOT READY |

现有 M2-C 业务代码及 local-only guards 保持不变，未部署本地零 ID 配置，未操作用户钱包。已有无资金 Demo 随 dev 正常 CI 更新，不能将其记为新后台部署。没有新 Cloudflare 资源、远端迁移、付费开通或公开链写入。

## 下一步

用户按 [独立环境配置](M2-D-CLOUD-SETUP.md) 完成 `arcbox_testnet` 和仓库只读开关，并明确测试资源/费用范围。随后继续同一个 dev 和阶段 PR，先复验权限再逐项实现云端配置与验收。不要为解锁这个只读预检再建钱包、充值或发送秘密。

当前 PR 应保持草稿。可以审阅准备代码，但不能把它的合并当 M2-D 完成，也不默认建议合并后跳到 M3。
