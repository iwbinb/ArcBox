# 05 · 六工具共享流程

## 1. 身份与权限

浏览无需登录；保存工作区或读取个人订单使用钱包签名登录。采用 SIWE，服务端生成一次性 nonce，校验 domain、URI、chainId、issuedAt、expiration、签名及 nonce 未消费；Cookie 为 HttpOnly/Secure/SameSite，敏感写接口加 Origin/CSRF 检查。EOA 与 ERC-1271 钱包支持情况在 M0 实测；不支持的类型明确拒绝，不能用前端钱包地址当认证。

会话认证不授权资金操作。角色变化、受益人、合约条款、仲裁分配仍需对应钱包签名或链上调用。签名标准依据见 [来源 S07/S08/S09](research/SOURCES-AND-ASSUMPTIONS.md)。

## 2. 项目与规则版本

通用对象 ToolInstance：id、toolType、workspaceId、slug、displayMetadata、version、rulesHash、chainId、contractAddress、deploymentBlock、availability、createdAt。

生命周期：DRAFT → VALIDATED → PUBLISHING → LIVE → ARCHIVED；失败部署回到可重试状态，但不重用已广播的部署标识。PAUSED 是新增业务开关，不改变资金结算状态。

规则快照用固定 schemaVersion 的规范序列化生成 hash；链上金额/期限/受益人本身须有可验证字段，不能只存一个任意字符串 hash。规范化测试向量需要固定字段顺序、整数表示和空值；hash 不等于加密。文案、文件清单与链上规则必须能对照。

## 3. 支付 Intent

每次付款先创建订单/intent：唯一orderId、toolInstance、version、payer、amountU6、termsHash、deadline、nonce、chainId、contractAddress。服务端可签署受限的短期 intent，但金额与受益人由不可变合约配置约束，签名不能凭空改变条款。

API Idempotency-Key 相同且请求相同返回原订单；同键不同内容返回409。链上 independently 拒绝已消费 orderId/nonce。报价过期不表示已经确认的付款失效。重发相同交易、重新打开网页、切换 RPC 不创建第二笔订单。

## 4. 支付路径

1. 读取已发布版本和网络配置，模拟合约调用。
2. 检查统一 USDC 余额与预估费用余量；ERC-20授权默认精确金额。
3. 付款人钱包调用实例合约，业务入金使用 ERC-20 transferFrom，msg.value=0。
4. 后端验证 receipt 成功、chainId、白名单实例、业务事件中的 orderId/payer/amount/version；不是仅验证 Transfer。
5. 原始事件、业务投影更新和 outbox 在同一 D1 batch 中提交。
6. 异步派生交付权限、提醒、报表；通过幂等键消除重复副作用。

付款与Gas来自同一基础资产但采用不同精度；不得将余额相加。具体网络事实见 [S01/S02/S03](research/SOURCES-AND-ASSUMPTIONS.md)。

## 5. 不用一个 status 表示所有事

| 维度 | 示例状态 |
|---|---|
| 支付交易 | CREATED、AUTHORIZING、SUBMITTED、CONFIRMED、REVERTED、UNKNOWN |
| 业务订单 | ACTIVE、CANCELLED、EXPIRED、COMPLETED |
| 资金归属 | REFUNDABLE、LOCKED、SETTLEABLE、CREDITED、WITHDRAWN |
| 文件权益 | PENDING、AVAILABLE、REVOKED、UNAVAILABLE |
| 通知 | PENDING、SENT、RETRYING、DEAD_LETTER |

链上已付款 + 通知失败，不得显示支付失败；文件已准备 + 退款成功，应撤销后续下载权限。不同维度在UI中分别呈现。

## 6. 退款与领取

退款/分账先形成合约固定受益人的 credit，再由其领取，或者任何人调用 withdrawFor 并将款项发往固定受益人。交易模拟失败或USDC地址冻结时保留权益，不改成已领。

付款本金的合法退款权不能因为用户长期没点击而被运营者收走。Rewards 是例外：它有发布前明确的领取期限，未领取奖励到期回到出资人；不能把此规则复用到用户支付的本金。

手续费设计：试运行平台费0，不从退款本金扣平台费；Gas由实际交易调用者承担且不退。UI可写“本金可退”，不得写“所有费用全退”。

## 7. 组合白名单

| 来源 | 触发 | 目标 | 禁止的捷径 |
|---|---|---|---|
| Deliver | 交付已确认且退款窗口结束 | Split 的结算入金 | 一付款就把可退本金分走 |
| Group | 截止判定成功 | 文件访问权限 | 将资料开放当成课程已经履约 |
| Group | 固定释放时点到达且未取消 | Split 的结算入金 | 未成团或可退款资金进入Split |
| Milestones | 某阶段验收/裁决已放款 | Split（后续） | 所有未完成阶段提前分账 |

组合边在发布前预览，目标合约地址、版本、比例不可变。调用原子性失败则原交易回滚，不出现源合约已扣款而目标没有记账。无可用Split时直接形成固定卖家credit，不临时换运营钱包。

## 8. 异步可靠性

Queues 采用至少一次语义，不能依赖唯一送达 [S05](research/SOURCES-AND-ASSUMPTIONS.md)。outbox与D1业务更新同批次；消费者用 inbox/dedup_key + 版本条件实现幂等。远端邮件/下载不能与数据库组成跨系统原子事务，需持久化尝试状态并重试；重复提醒可以容忍，重复资金结算不能容忍。

Cron只扫描到期项和补扫游标；合约条件仍由用户或许可的调用者触发。不要在Worker无限循环订阅整条链。关键顺序使用 blockNumber/transactionIndex/logIndex，不能只按区块时间。

## 9. 文件、隐私与恢复

文件在私有R2，认证后检查订单权益再创建短时下载授权；下载链接是临时bearer，不代表不可分享。退款撤销后不再签发新链接，已下载内容不能回收；短链剩余有效期是已知暴露窗口 [S06](research/SOURCES-AND-ASSUMPTIONS.md)。

用户可保存恢复包：网络、实例地址、ABI版本、orderId、规则快照、公开交易、自己的Merkle proof（如适用）。私有证据不进公开链、不进普通日志。D1恢复可以重建资金投影，但不能凭区块重建丢失文件或未保存的完整奖励proof。
