# M0-C · Workers 本地运行时探针与复现

2026-09-23。本文说明测试实现与边界；执行结果、准确源码和日志见 [M0-C-STATUS.md](M0-C-STATUS.md)。这是最小技术验证，不是六工具后台、生产鉴权或生产数据库迁移。

## 1. 三层检查

| 层 | 入口 | 实际执行什么 |
|---|---|---|
| 既有 M0-B 回归 | `pnpm check` / `pnpm test:unit` / `pnpm build` / `pnpm test:runtime` | 固定依赖、类型、46项Node用例、编译和1项workerd启动测试 |
| 绑定语义 | `pnpm test:bindings` | 33项测试在workerd中调用Miniflare本地D1、R2、Queues绑定 |
| 构建产物与Assets | `pnpm test:assets` | 构建后通过Wrangler test harness运行真正的Worker JS和静态目录，8项HTTP测试 |

这些本地资源运行在GitHub Actions托管执行器上，不运行在用户Cloudflare账号。没有远程资源ID、Cloudflare Token、用户钱包私钥或链上写调用。测试里的“real producer/broker”指真实调用本地绑定及其消息调度，不是Cloudflare生产队列。

## 2. 文件与隔离

- `probes/runtime/schema.ts`：`probe_*`合成表，只用于本地验证；不进入`migrations/`。
- `probes/runtime/store.ts`：D1事务门闩、受版本保护的更新、outbox/inbox、有限批次分发与到期扫描。
- `probes/runtime/worker.ts`：测试文件读取、队列和定时处理器；没有公共写入/改金额接口。
- `probes/runtime/wrangler.jsonc`：独立Worker入口，不含资源绑定、云账号、路由、定时配置或启用flag。
- `vitest.bindings.config.ts`：仅测试宿主注入DB/FILES/JOBS、两个本地队列以及`PROBE_MODE=local-test`。
- `tests/runtime/bindings.test.ts`：所有存储/队列测试；每个用例采用随机唯一ID，等待在途工作。
- `tests/assets.integration.test.mjs`：独立测试根应用构建产物，确认未捆入探针。

根网站Worker不导入`probes/`；构建仍只生成M0-B编译探针，不伪装正式UI。测试探针无启用flag时返回503。根`wrangler.jsonc`只补全`/api`与`/api/*`的Worker优先路由，避免裸API前缀被SPA回退吞掉。

测试数据在每个测试文件内共享，因此不能假设每个`test()`都会清库。所有夹具采用UUID，异步消息用有限轮询等到效果/投递记录写入；没有`test.concurrent`。这验证并发请求行为，但不等于跨地域生产并发验证。

## 3. D1：11项

| ID | 验证内容 |
|---|---|
| D1-01 | 重复初始化schema安全 |
| D1-02 | 事件、精确TEXT金额、outbox同批提交；大于JS安全整数的金额不丢精度 |
| D1-03 | 最后outbox语句冲突导致前面事件/记录全部回滚，排除故障后可重试 |
| D1-04 | 同事件重放不重复写入 |
| D1-05 | 8个并发重复事件只有一次提交 |
| D1-06 | 同key不同金额/范围拒绝，而非当作重复成功 |
| D1-07 | 负向对照：UPDATE影响0行不是SQL失败，后续无条件INSERT仍会提交 |
| D1-08 | 用内部唯一操作token保护的CAS未命中，不写入后续审计；旧版本重放拒绝 |
| D1-09 | 4个并发相同版本更新只有一个胜出 |
| D1-10 | 后续审计写入被SQL trigger中断时，前面的CAS也回滚 |
| D1-11 | 非法金额在持久化前拒绝 |

重要结论：`batch()`原子性不代表所有业务前提自动成立。事件去重以唯一INSERT作为事务门闩；CAS后续语句必须关联同次操作token，不能无条件继续写。这里的事件是合成数据，真实receipt/合约白名单校验仍属于后续开发。

## 4. R2：9项

实际`put/get/head/delete`和WebCrypto哈希验证；另用最小合成session/grant表验证文件读取边界：有效授权成功，无令牌、伪造令牌、精确过期时刻拒绝，跨tenant伪造header/query拒绝，已撤销权益、隔离文件和未知文件不可访问，缺失/被改动对象明确报错。

文件key来自服务端授权记录，不能由请求直接指定；响应`no-store`，不把私有文件送入共享缓存。探针文件很小，采用完整缓冲区哈希；**没有实现生产大文件流式校验、SIWE、正式RBAC、病毒扫描、R2 S3签名链接或访问性能测试**。已有下载不可回收，验证撤销只约束后续请求。

## 5. Queues/outbox：10项

| ID | 验证层次与内容 |
|---|---|
| QUE-01 | 官方MessageBatch助手：持久化成功才ack，重复投递不重复effect |
| QUE-02 | 官方助手：依赖尚未写入时retry且不ack |
| QUE-03 | 无效schema落拒绝记录后ack，不使用消息自带金额 |
| QUE-04 | effect写入失败时inbox也回滚，重试能恢复 |
| QUE-05 | 真正`env.JOBS.send`两次→本地broker→消费者，只产生一份effect |
| QUE-06 | 首次注入存储故障，本地broker第二次投递成功 |
| QUE-07 | 持续故障达到3次尝试（首次+2次重试），由本地broker送到死信消费者 |
| QUE-08 | 注入send异常，outbox仍pending；切回实际绑定后可恢复 |
| QUE-09 | 模拟send成功后未记录sent，恢复时再次发送，最终仍只有一份effect |
| QUE-10 | 到期判断、单批最多20项、有限发送和非法limit拒绝 |

前三项用官方事件助手检查处理器决策；QUE-05/06/07/09等另外经过实际本地消息调度。两个故障测试替换了`send`以注入异常，恢复路径切回实际绑定，不将这类注入当作真实Cloudflare网络中断。

当前固定版本的`getQueueResult()`只报告单条重试消息ID，没有保留`delaySeconds`字段。不要在断言里伪造这个字段，也不要据此宣称精确的生产重试时延；真正的重投递次数与死信路径另有独立用例。

`outbox sent=1`只表示已经交给队列，不表示消费者已完成。发送和标记之间允许重复；inbox/effect同批提交避免重复副作用。此探针证明有限用例下的幂等设计，不是“网络保证只投递一次”。

## 6. 定时事件：3项

用官方`createScheduledController`和`waitOnExecutionContext`触发真实处理函数，验证到期前不派发、精确到期可派发、重复/延迟事件不产生第二个效果、发送异常后可重试。任务数有限，当前设计每次最多20项。

这不是等待Cloudflare线上Cron自动触发，也不决定任何业务合约的资金时限。没有创建GitHub定时工作流或线上定时资源。

## 7. HTTP/Assets：8项

测试对象是`dist/worker/index.js`与`dist/web`，不是手写Fetch mock。覆盖：首页HTML、非API客户端路由SPA回退、未知API、模拟浏览器导航到API、裸`/api`、POST健康接口、原健康结果/探针隔离、JS静态资产内容哈希。

`exports.default.fetch()`只适合默认Worker处理器测试，不包含完整Assets路由；因此这8项使用独立的Wrangler `createTestHarness()`。不能用一个返回200的JS mock证明Cloudflare路由正确。

## 8. 运行与结果

```bash
# Node与pnpm版本见toolchain.json，不改变已有锁文件
pnpm install --frozen-lockfile
pnpm verify          # M0-B回归 + 全部M0-C检查；遇失败后续步骤标NOT_RUN
pnpm test:bindings   # 单独调试D1/R2/队列/定时语义
pnpm test:assets     # 先构建，再测试真实Assets/Worker路由
```

`pnpm verify`清理旧report，生成`reports/m0-c-report.json`、Vitest JSON和各步日志，并将`M0_C_REPORT`打印到CI日志。报告保存真实source SHA、PR head、触发SHA、时间、lock hash与测试分组；不把旧源码运行替换成文档提交后的SHA。编译探针manifest的M0-B标识保持历史范围，不等于M0-C只测了一项启动。

常驻CI仍`contents:read`、外部Actions全SHA固定、无生产Secrets、无部署环境，实际Arc只读查询保持独立job。失败不能通过`continue-on-error`隐藏；主网/真实Cloudflare账号验证仍NOT_RUN。

## 9. 官方依据与版本差异

核对日期2026-09-23。实现以锁定包的实际类型和执行结果为准，不把网站示例当作已运行证据。

- [Vitest集成与测试API](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)：真实运行时绑定、事件助手及Assets测试边界。页面的ProvidedEnv示例与当前workers-types合并点不同，本仓库用实际需要的`Cloudflare.Env/GlobalProps`。
- [workerd官方类型定义](https://github.com/cloudflare/workerd/blob/main/types/defines/rpc.d.ts)：环境与主模块导出的类型扩展位置。
- [隔离与并发](https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/)：按文件隔离的存储语义。
- [Miniflare Queues](https://developers.cloudflare.com/workers/testing/miniflare/core/queues/)：本地生产者、消费者、重试及死信配置。
- [D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)：实际batch与prepare接口。
- [Wrangler程序接口](https://developers.cloudflare.com/workers/wrangler/api/)：构建产物test harness。

## 10. 后续边界

M0-D需要单独确认专用测试钱包、测试币和允许的链上动作。M2再实现正式业务数据库、权限、文件与队列平台；D1部署检查点再验证真实Cloudflare资源、S3签名、限额与云端恢复。本轮不创建这些资源，不合并PR，不进入下一阶段。
