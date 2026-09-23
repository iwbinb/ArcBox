# Architecture 02 · 数据字典与API契约

本文件是逻辑规格，实施时生成迁移、schema与OpenAPI并测试；不是可直接导入的生产SQL。API统一前缀/api/v1，工具文档中的/v1表示同一资源去掉部署前缀。

## 1. 通用类型

- 所有业务ID用不含PII的随机UUID/ULID；链上ID为固定bytes32映射，映射不可变。
- 地址按小写存储、校验格式后按checksum展示；(chain_id,address)确定链上身份。
- amount_u6等金额在JSON及D1使用十进制TEXT；业务运算使用bigint。不得用Number累计或按字符串字典序排序金额。
- bps、版本、序号为有界整数；合约时间为Unix秒，API同时提供ISO8601 UTC。应用created_at/updated_at明确用Unix毫秒，不能混用。
- 每个工作区资源都有workspace_id、created_by、created_at、version；公开slug不替代权限。
- JSON schema设置additionalProperties=false；规范化金额禁止科学计数法、多余前导零、正负号/空白等歧义。

## 2. 核心实体

| 表 | 核心字段 | 约束/索引 |
|---|---|---|
| users | id, primary_wallet_id, locale | 不要求邮箱 |
| wallets | id, user_id, chain_id, address, verified_at | UNIQUE(chain_id,address) |
| auth_nonces | nonce_hash, domain, chain_id, expires_at, consumed_at | 一次性原子消费 |
| sessions | token_hash, user_id, wallet_id, expires_at, revoked_at | 只存令牌hash |
| workspaces | id, owner_user_id, name, status | owner变更需要审计 |
| memberships | workspace_id, user_id, role, status | UNIQUE(workspace_id,user_id) |
| invitations | token_hash, workspace_id, role, expires_at, accepted_by | 一次性、不能自提权 |
| tool_instances | id, workspace_id, tool_type, slug, version, availability | UNIQUE(slug)、INDEX(workspace_id,tool_type,status) |
| rule_versions | id, instance_id, version, canonical_json, rules_hash, owner_signature | UNIQUE(instance_id,version)，发布后只读 |
| deployments | id, instance_id, chain_id, contract_address, factory, deploy_block, abi_hash, tx_hash | UNIQUE(chain_id,contract_address) |
| consents | entity_id, config_hash, signer_wallet, signature, nonce, expires_at, verified_at | 不复用旧config签名 |
| orders | id, chain_order_id, instance_id, rule_version_id, payer, amount_u6, payment_state, business_state | UNIQUE(chain_id,contract,chain_order_id) |
| payment_intents | id, order_id, nonce, request_hash, expires_at, signature, consumed_tx | UNIQUE(instance_id,nonce) |
| transaction_attempts | id, order_id, chain_id, tx_hash, purpose, status, replacement_of | UNIQUE(chain_id,tx_hash)，approve与pay分开 |
| raw_chain_events | chain_id, tx_hash, log_index, block_hash, block_number, tx_index, address, event_name, payload | PRIMARY KEY(chain_id,tx_hash,log_index) |
| index_cursors | chain_id, source_group, from_block, last_complete_block, last_hash, lease_version | 乐观并发推进 |
| ledger_entries | id, event_key, entity_id, account_kind, beneficiary, amount_u6, direction | UNIQUE(event_key,entry_index)；追加不改历史 |
| credits | chain_id, contract, beneficiary, amount_u6, as_of_block | 投影；不能被API直接增减 |
| idempotency_keys | scope, actor, key, request_hash, response_ref, expires_at | UNIQUE(scope,actor,key) |
| outbox | id, effect_key, type, payload_ref, status, attempts, next_attempt_at | UNIQUE(effect_key)、INDEX(status,next_attempt_at) |
| inbox | consumer, effect_key, processed_at, result_ref | UNIQUE(consumer,effect_key) |
| audit_logs | actor, action, entity, before_hash, after_hash, request_id, created_at | 追加、脱敏、受限导出 |

D1 ledger只是链上会计投影，不是另一个能够创造余额的钱包。所有金额变更必须追溯到唯一链事件；草稿预计收入存独立字段，不混入ledger。

## 3. 工具专用表

| 工具 | 表与字段 |
|---|---|
| Deliver | products(instance_id,title,price_u6,bundle_version_id)；delivery_orders(order_id,paid_at,delivery_deadline,refund_until,availability_tx,settlement_tx)；entitlements(order_id,wallet,bundle_version_id,state,retention_until)；download_grants(id,entitlement_id,token_hash,expires_at,consumed_at) |
| Group | group_campaigns(instance_id,price_u6,min_seats,max_seats,funding_deadline,start_at,end_at,release_at,destination)；registrations(id,campaign_id,wallet,nonce,amount_u6,state)；UNIQUE(campaign_id,wallet,nonce)，有效席位另受链约束 |
| Split | split_agreements(instance_id,members_hash,dust_recipient)；split_members(agreement_id,wallet,bps)；allocations(agreement_id,source_contract,source_id,recipient,amount_u6,event_key)；UNIQUE(agreement_id,source_contract,source_id,recipient) |
| Attend | attend_events(instance_id,registration_deadline,cancel_before,start_at,end_at,proposal_deadline,attestor,resolver)；attendance_registrations(id,event_id,wallet,nonce,state)；checkin_challenges(token_hash,registration_id,expires_at,used_at)；attendance_proofs(registration_id,proof_hash,signer,valid_before,tx_hash)；no_show_cases(registration_id,proposed_at,challenge_deadline,challenged_at,resolution_deadline,state) |
| Milestones | milestone_contracts(instance_id,client,contractor,resolver,fallback_refund_bps,terms_hash)；stages(contract_id,stage_index,amount_u6,due_at,longstop_at,state,review_deadline,revision_count)；submissions(stage_id,revision,evidence_object_id,hash,submitted_at,tx_hash)；disputes(id,stage_id,opened_at,deadline,refund_u6,release_u6,resolution_tx) |
| Rewards | reward_campaigns(instance_id,root,manifest_hash,total_u6,claim_start,claim_deadline,sponsor)；reward_allocations(campaign_id,index,recipient,amount_u6,leaf_hash,proof_object_version)；reward_claims(campaign_id,index,credit_tx,withdraw_tx,state)；UNIQUE(campaign_id,index)、UNIQUE(campaign_id,recipient) |
| Shared files | file_objects(id,workspace_id,r2_key,version,sha256,bytes,mime,scan_state,retention_until)；file_bundles(id,version,manifest_hash)；bundle_items(bundle_id,file_id)；evidence_links(entity_id,file_id,access_policy) |
| Notifications | notifications(id,user_id,entity_id,type,status,read_at)；notification_attempts(notification_id,provider,attempt,dedupe_key,result) |

私有证据、名单与文件不做公开join。所有对象归属workspace核验后才能读关联子表；知道stage_id或file_id不构成授权。

## 4. 数据一致性约束

相同付款intent只能关联同一订单；业务事件数量与金额不能被重复投影。D1 batch里以processed/raw event唯一插入作为门闩，失败回滚整个投影/outbox，重复消息返回已有结果。

对于版本CAS更新，UPDATE affected_rows=0不会自动抛错；需要全批语句条件一致或显式约束门闩。禁止“先查版本→异步调用→无条件写”造成并发覆盖。测试须模拟两个worker同时保存/发布/消费签到码。

金额列作为TEXT不能直接SUM生成财务结果；使用共享bigint投影器，必要时持久化带as_of_block的汇总字符串。删除项目仅归档，不级联删ledger、签名或尚有权益的文件。

## 5. 通用API清单

| 方法/资源 | 权限 | 行为 |
|---|---|---|
| GET /public/tools | 无 | 工具介绍及真实环境可用性 |
| GET /public/pages/:slug | 无 | 脱敏规则、状态、asOf |
| POST /auth/nonce | 限流 | 生成绑定domain/chain的短期nonce |
| POST /auth/verify | 有效签名 | 原子消费nonce并创建session |
| POST /auth/logout | 本人 | 吊销session |
| GET/POST /workspaces | 登录 | 列出/创建工作区 |
| GET/POST /workspaces/:id/members | owner | 角色管理，不改变链上权益 |
| GET /me/records | 登录钱包 | 只取自己的资金/权益记录 |
| POST /instances | editor+ | 建草稿，toolType枚举六项 |
| PATCH /instances/:id | editor+If-Match | 仅改草稿/允许的展示元数据 |
| POST /instances/:id/validate | editor+ | 返回字段/规则问题和规范hash |
| POST /instances/:id/publish | owner | 创建部署intent/tx-plan，不直接假定已部署 |
| GET /orders/:id | 当事人/有权成员 | 订单分维度状态、完整规则、证据 |
| POST /orders/:id/transactions | 当事人 | 提交hash并排队验证，202不代表付款成功 |
| GET /orders/:id/tx-plan | 有权actor | 合约只读校验+simulate，返回固定目的调用 |
| POST /files/upload-sessions | editor+ | 创建限大小/类型/目标key的上传权限 |
| POST /files/:id/complete | owner/editor | 服务端校验后入扫描，不能由前端直接标safe |
| GET /recovery/:entityId | 当事人 | 个人恢复制品；不包含其他人资料 |
| GET /status | 无 | 服务健康摘要，无秘密或完整内部拓扑 |

六工具专用资源和动作见各工具规格，不复制为另一套命名。HTTP只返回交易计划/证据，用户资金动作必须有对应钱包授权或公开固定收款人方法。

## 6. 请求与响应约定

创建订单示例（示例ID不是实际部署）：

```json
{
  "instanceId": "example-product",
  "ruleVersion": 1,
  "payer": "<verified-wallet>",
  "amountU6": "15000000"
}
```

服务端以session钱包为payer，客户端字段不一致返回403；价格与链上版本对照，不信客户端自报。Idempotency-Key置请求头。

交易计划返回字段：requestId、chainId、to、data、value（业务调用固定字符串0）、methodName、argsPreview、rulesHash、expiresAt、simulationBlock、estimatedGasFeeU18、approval（需要时给token/spender/精确amountU6）。客户端再次校验chainId/to/方法白名单，不盲签任意后端calldata。

标准响应：data、requestId、asOf（blockNumber/blockHash/indexedAt，适用时）。标准错误：error.code、messageKey、retryable、fieldErrors、requestId。不得把后端栈或RPC商业密钥返回给用户。

## 7. 错误语义

| code / HTTP | 意义与恢复 |
|---|---|
| AUTH_REQUIRED 401 | 重新登录，不删除草稿 |
| FORBIDDEN 403 | 当前角色/钱包不符 |
| NOT_FOUND 404 | 不泄露私有资源是否存在 |
| VERSION_CONFLICT 409 | 刷新差异，不覆盖新版 |
| IDEMPOTENCY_CONFLICT 409 | 同键不同内容，创建新意图前提示 |
| INVALID_RULES 422 | 逐字段说明 |
| WRONG_CHAIN / TOKEN_MISMATCH 422 | 不发送交易 |
| INSUFFICIENT_GAS / INSUFFICIENT_FUNDS 422 | 区分本金和网络余量 |
| STATE_CHANGED 409 | 重新读合约，可能已退款/满员/领取 |
| RPC_UNAVAILABLE 503 | 未确认不算失败重付 |
| INDEXER_LAGGING 503或数据警告 | 展示链上交易和索引滞后，不篡改余额 |
| FILE_UNAVAILABLE 503 | 重试与退款路径 |
| RATE_LIMITED 429 | Retry-After，无无限自动重试 |

## 8. 安全与限流

所有写接口Content-Type/schema/body size限制；SQL全部参数绑定。认证、资格查询、文件授权、创建签名按IP+钱包+工作区组合限流，具体阈值M0压测后锁定。CSRF/Origin验证独立于CORS；不把CORS当权限控制。

私有响应no-store；共享缓存键不可遗漏环境和语言。上传下载对象key由服务端构造，不能任意路径遍历。第三方Webhook v1不开放；后续需防SSRF、私网地址/DNS rebinding、重定向和签名重放。

## 9. 迁移/保留

采用expand→兼容读写→backfill→切换→另版删除旧字段。链上字段或hash编码变更生成新schemaVersion，不能用迁移“修正”旧合同条款。保留策略由实际政策确定；设计建议会话短期、应用日志30天、争议资料至少覆盖争议期及审阅的保留期限，删除前验证未结权益。

备份D1只能恢复链下数据；重放事件补齐备份后的链状态。PII删除请求与不可变公开链记录分开说明，不承诺从链上删除交易。
