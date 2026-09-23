# Architecture 04 · Cloudflare部署与发布

本文件是部署设计/操作手册，不代表资源已创建。任何付费开通、生产变更、主网部署或真实资产转账需要用户另行授权。

## 1. 推荐拓扑

**Workers + Static Assets，而不是Pages作为默认入口。**网站和API同源；异步任务放Jobs Worker。Workers的静态资产/全栈能力见 [S04](../research/SOURCES-AND-ASSUMPTIONS.md)。

| 资源 | 建议命名 | 作用 |
|---|---|---|
| Web/API Worker | arcbox-web-<env> | 网站、公开分享页、API、登录 |
| Jobs Worker | arcbox-jobs-<env> | queue消费者、scheduled补扫与提醒 |
| 受限证明服务 | arcbox-attestor-<env> | Deliver证明与限定代执行；只service binding访问 |
| D1 | arcbox-db-<env> | 工作区、订单索引、outbox、角色 |
| R2 | arcbox-private-<env> | 文件、证据、Merkle制品，不开公共桶 |
| Queue | arcbox-jobs-<env> | 可靠任务分发 |
| DLQ | arcbox-jobs-dlq-<env> | 超限失败任务、告警和人工重放 |
| 公共静态资产 | Worker Assets | 构建后的JS/CSS/公开预览，不存付费文件 |

<env>采用testnet/production；本地和demo用隔离模拟资源。域名未确定，不把arcbox.io等未验证名称当成已拥有域名。

## 2. 环境矩阵

| 环境 | 链 | 钱包/密钥 | 数据 | 能否当参赛实物 |
|---|---|---|---|---|
| local | 本地测试链或mock | 仅公开测试私钥 | 本地D1/R2模拟 | 否 |
| demo | 无资金mock | 禁止调用真实钱包交易 | 合成fixtures | 否，必须明确标识 |
| testnet | Arc 5042002 | 专用测试钱包 | 独立云资源 | 不是主网交付 |
| production | Arc 5042 | 经批准真实角色，最小Gas账户 | 独立生产资源 | 仅实际部署且可用时 |

预览部署不能读生产D1/R2或使用生产签名密钥；fork PR不发Secrets。不得用一个环境变量把同一数据库里的demo订单变成mainnet订单。

## 3. 配置设计

Web/API示意配置，实施时以M0锁定Wrangler schema验证，不直接部署占位符：

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "arcbox-web-testnet",
  "main": "workers/api/src/index.ts",
  "compatibility_date": "2026-09-23",
  "assets": {
    "directory": "./apps/web/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/p/*", "/claim/*", "/r/*", "/recovery*"]
  },
  "vars": {
    "APP_ENV": "testnet",
    "CHAIN_ID": "5042002",
    "USDC_DECIMALS": "6",
    "PAYMENTS_ENABLED": "false"
  },
  "d1_databases": [{
    "binding": "DB",
    "database_name": "arcbox-db-testnet",
    "database_id": "REPLACE_AFTER_RESOURCE_CREATION"
  }],
  "r2_buckets": [{"binding": "FILES", "bucket_name": "arcbox-private-testnet"}],
  "queues": {"producers": [{"binding": "JOBS", "queue": "arcbox-jobs-testnet"}]}
}
```

/api未匹配路由必须返回JSON404，不能被SPA fallback变成HTML200。私有文件路径不走Static Assets。/r和资格响应不缓存。

Jobs独立配置scheduled为`* * * * *`（按分钟补扫，不保证秒级执行）；consumer设置有限batch、重试和DLQ，具体字段由锁定CLI实际验证。Cron按UTC运行，不能用组织者本地时区推导链截止 [S12]。

## 4. 资源初始化顺序

以下命令是实施模板，只针对显式指定测试环境；本轮不执行：

```bash
pnpm exec wrangler d1 create arcbox-db-testnet
pnpm exec wrangler r2 bucket create arcbox-private-testnet
pnpm exec wrangler queues create arcbox-jobs-testnet
pnpm exec wrangler queues create arcbox-jobs-dlq-testnet
# 将返回的真实resource ID写入测试环境配置后，再应用已经审查的迁移。
```

顺序：验证Cloudflare账号权限→创建测试资源→填binding ID→本地迁移测试→测试D1迁移→上传合成fixture→配置测试Secrets→部署Jobs/私有证明服务→部署Web/API→健康检查→测试网小额流程→审查后独立创建生产资源。

生产不复制测试数据、钱包私钥或订单；只迁移schema及经审核公共配置。

## 5. 配置与Secrets分离

| 类型 | 字段例 | 存放与权限 |
|---|---|---|
| 公开配置 | APP_ENV、CHAIN_ID、USDC_ADDRESS、FACTORY_ADDRESS、ABI_HASH、BUILD_SHA | 版本化清单；启动时核验 |
| 服务秘密 | SESSION_SECRET、RPC_API_KEY、通知服务token、R2 S3签名凭证 | Workers Secrets，最小资源范围 |
| 受限业务签名 | QUOTE_SIGNER、DELIVERY_ATTESTOR、ATTENDANCE_ATTESTOR | 独立服务、职责/域隔离；不发前端 |
| 代执行Gas账户 | RELAYER_KEY | 可选低余额专用账户；不能与管理员/用户收款钱包相同 |
| 部署/管理密钥 | 合约发布者/多签成员 | 不进入Workers或GitHub构建；离线受控流程 |

Secrets不写入vars、README、日志或公开仓库；本地.dev.vars/.env必须忽略。Worker管理员能通过修改代码影响运行时秘密，因此Cloudflare账号权限本身在威胁模型内，Secrets不等于硬件隔离 [S15]。

## 6. 代执行限定

只允许明确白名单动作，例如为已付款Deliver记录合法文件可用证明；不提供任意to/data/value转发。value=0；chainId、合约模板和函数选择器核验；Gas价格/每日额度上限；交易模拟；独立告警。

同一个代执行账户只有一个nonce调度器。Jobs用持久化lease/CAS分配nonce，记录pending交易；替换只能对应相同业务调用，不通过换nonce重复执行。异常时停止新签名并保留用户自己提交证明/退款入口。该机制需要集成测试，不以多Worker同时getTransactionCount作为可靠方案。

## 7. GitHub持续集成与发布

接入iwbinb/ArcBox的Workers Builds可以从Git触发构建 [S11]，不是必须依赖GitHub Actions。建议：功能分支→PR检查/测试环境→合并main→构建测试通过→按环境发布。当前只有文档，接入后也不会自动生成应用。

实施时建立命令契约：`pnpm check`（类型/静态检查）、`pnpm test`、`pnpm build`、`pnpm test:e2e`、`forge test`。这些脚本当前尚未存在，必须先实现；不得在报告中写成已执行。

后端/数据库/合约分开发布。数据库先兼容性扩展，再新Worker；合约独立审查、明确部署授权、验证源码/权限、再更新环境manifest。合并网站PR不自动部署新的资金合约。

## 8. 安全与交付验证

HTTPS、严格安全headers、CSP与钱包必要域名白名单、无inline任意脚本、HSTS按正式域名策略配置、no-store私有响应。访问控制与CORS分开；/ops同时使用Cloudflare Access和应用角色，不能仅隐藏URL。

上传不穿过内存缓冲大文件；R2预签名GET/PUT的接口限制和bearer属性按 [S06] 实测。文件安全处理未配置时禁用公开任意上传。不要宣称R2自动替你扫描恶意文件。

性能验收：375px付款路径、静态资源缓存命中、错误API404、D1有索引、无大范围同步计算、Worker CPU/内存/队列限制以内 [S16]。测试的是实际生成物，不只lint配置。

## 9. 成本模型与限制

成本=Workers请求/CPU与套餐+D1读写/存储+R2容量/操作+Queues消息+构建+RPC/邮件/扫描+链上Gas。实际价格和额度部署时查看当期官方账单，不写成固定全站5美元。

建议配额：每工作区文件量/单文件大小、每活动钱包数、每日签名与任务数、最大扫描跨度；usage报警达到预算50/80/100%时逐级处理。降低缓存失误、重复全表扫、无界上传和任务死循环，比一开始自建VPS更直接。

## 10. 回滚与灾难恢复

Web/Worker回退上一个已验证版本；schema采用expand/contract，回退Worker不能要求删除新字段。D1使用可用Time Travel/导出备份能力并实际演练 [S17]。R2对象版本用不可变key加独立备份manifest，不把D1备份当文件备份。

恢复流程：停新业务→恢复D1→保留/恢复R2版本→从备份游标重放链事件→去重outbox→复核链上credits和总负债→少量只读/测试订单→重新开放。绝不通过回滚数据库“撤销”链上付款。

服务全停时公开恢复说明应可离线保存；链上权益可操作性和文件/proof的链下可用性限制分别披露。
