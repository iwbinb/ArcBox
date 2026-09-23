# M0-C · Workers / D1 / R2 / Queues 验收

日期：2026-09-23。状态：**PASS_LOCAL_CI，开发交付待 PR 审查合并**。本轮只完成 M0-C，不代表完整 M0 或生产环境通过；没有创建 Cloudflare 云资源、部署网站/合约或发送链上交易。

## 1. 版本与证据

PR #2 已合并；本轮从 main `55bf663b6704e9af1e457cbc1166d8175bc07ff4` 创建 `feat/m0-c-runtime`。

- 已验证代码：`11cd2a4901eb6520ac839ab6d373b8bd68782e89`。
- [Actions 35832021323](https://github.com/iwbinb/ArcBox/actions/runs/35832021323)，push 触发，2026-09-23 07:30 UTC，两个 job 均 completed/success。
- [必需检查 107086611692](https://github.com/iwbinb/ArcBox/actions/runs/35832021323/job/107086611692)：完整日志已读取，运行报告时间为 07:30:09.243–07:30:25.895 UTC。
- [独立只读 RPC 107086611462](https://github.com/iwbinb/ArcBox/actions/runs/35832021323/job/107086611462)：完整日志已读取，6 项只读检查通过；固定区块 63556242，无签名/转账。
- [日志提取的完整结构化报告](m0-c/ci-report.json) 保留原 source SHA、时间和测试名称；不是本地另外执行的结果。
- 文档提交后的 head 与 PR 合成合并版本会重新运行；最终复验记录在 PR。不得用本报告代替不同代码版本的测试。

## 2. 实际通过结果

| 分组 | 用例 | 结果与范围 |
|---|---:|---|
| D1 | 11 | batch 回滚、事件/金额/outbox 原子写入、并发去重、CAS 与后续写入保护 |
| R2 | 9 | 实际本地对象读写/hash，合成授权、隔离/撤销、缺失和篡改拒绝 |
| Queues / outbox | 10 | ack/retry、真实本地绑定发送消费、重复投递、故障恢复、重试耗尽后进入死信消费者 |
| Scheduled | 3 | 精确到期、重复/延迟触发、发送失败后恢复 |
| 构建产物 / Assets | 8 | 实际 Worker JS 与 Assets 路由；API JSON404 不被 SPA HTML200 吞掉 |
| M0-B Node 回归 | 46 | 固定版本、金额/只读探针、错误退出与权限/锁文件负向检查 |
| M0-B workerd 启动 | 1 | 原最小 Worker 启动探针保持通过 |
| **本地测试合计** | **88** | **0 失败、0 跳过/待执行用例**；其中 M0-C 新增 41 项 |

冻结安装、静态检查、三份 TypeScript 配置、Vite 构建、Worker dry-run、Solidity 编译以及运行后源码/锁文件无变化检查均通过。这些编译检查不额外计入 88 个测试用例。

另有 6 项真实 Arc 测试网只读检查，独立于本地必需 job；它们不是资金合约或钱包交易测试。

## 3. 已验证的关键结论

D1 的 SQL 错误会使该 batch 回滚，但 **UPDATE 影响 0 行不等于 SQL 错误**。本轮既验证不安全写法的反例，也验证内部操作 token 保护的后续写入和并发版本竞争。

队列不是仅用 JavaScript mock：部分用例通过实际 `env.JOBS.send`、Miniflare 消息调度、消费者和本地 D1 完成。一次故障第二次投递成功；持续故障在首次加两次重试后由 broker 进入死信消费者。故意产生的死信 warning 是用例预期，不是未解决的失败。发送后未记录 sent 的恢复允许重发，但只形成一份持久副作用。

私有文件测试验证当前合成会话/授权记录，不能因此宣称生产 SIWE、RBAC、S3 签名链接、病毒扫描或大文件流式访问已经实现。整个文件内容缓冲仅适用于本探针的小型 fixture。

## 4. 隔离与未改变的内容

运行环境为 GitHub Actions 执行器上的 workerd/Miniflare，**不是用户 Cloudflare 账号中的 D1/R2/Queues**。探针有独立入口和 `probe_*` 表，绑定与启用 flag 仅从测试配置注入；根网站 Worker 不包含这些探针。

根 Wrangler 配置仅补全 `/api` 与 `/api/*` 的 Worker 优先匹配。未修改正式业务设计、应用 Worker 源码或合约逻辑；产品页面仍未实现。

Node、pnpm、全部依赖及 lock 保持 M0-B 版本。锁文件 SHA-256：`1f28da280847509789c0b82ab52bd87e27c62c60e20c0c2c7c67d9b2bb7b9b05`。常驻 CI 仍 contents:read，外部 Actions 固定完整 SHA，无生产 Secrets、仓库写权限或部署环境。

## 5. 失败与修正记录

| 运行 | 实际失败 | 修复方式 |
|---|---|---|
| [35831447932](https://github.com/iwbinb/ArcBox/actions/runs/35831447932) / c78bd77 | 类型检查未通过；新绑定测试未执行 | 按已锁定 workers-types 扩展 Cloudflare.Env/GlobalProps；MessageBatch fixture 补 attempts=1，无 any/跳过类型检查 |
| [35831755430](https://github.com/iwbinb/ArcBox/actions/runs/35831755430) / 711661b | 33 项绑定中 32 通过，QUE-02 错误预期助手返回 delaySeconds；Assets 未执行 | 按实际助手的 `{msgId}` 返回值断言，保留独立的真实 broker 重试/死信用例；二进制响应按 arrayBuffer 读取 |
| [35832021323](https://github.com/iwbinb/ArcBox/actions/runs/35832021323) / 11cd2a4 | 无失败 | 从干净执行器完整复验，88 项通过，无用例跳过 |

没有删除失败用例、忽略退出码或改为 continue-on-error。上述修正属于测试框架集成，不包装成已发现并修复生产资金漏洞。

## 6. 明确未执行

Cloudflare 真实账号资源创建、云端权限/配额/故障恢复、R2 S3 预签名与公网访问、生产钱包登录/文件安全、实际链事件验证、Arc 签名/授权/转账/合约执行、六工具实现、审计与主网资金均未执行。有关云端集成留在 D1 部署检查点，钱包与链实际交易留在 M0-D。

## 7. 复现与下一步

见 [探针说明与完整用例矩阵](RUNTIME-PROBES.md)。使用已锁定 Node/pnpm 后：

```bash
pnpm install --frozen-lockfile
pnpm verify
```

本轮提交 PR 后停止，不自动合并。下一项是 **M0-D：Arc 最小真实兼容验证**；开始链上写测试前，须确认专用测试钱包、测试币和允许的操作范围。不需要用户主钱包私钥，也不在聊天或公开仓库存放密钥。
