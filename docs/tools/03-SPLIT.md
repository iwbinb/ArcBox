# Split · 合伙分账

规格版本 v1.0。目标：两个或多个合作者对经过本协议的收入按事先确认的比例分配，自己查看并领取，不必等一个人月底补账。

## 1. 场景与范围

示例：两位讲师按70/30分配300 USDC的已结算收入，分别形成210/90 USDC可领取额。也可独立创建协议并由付款人直接入金，不要求同时使用其他工具。

只处理实际进入SplitVault的收入，不证明外部所有销售都经由ArcBox。v1不做动态股权、自动分红投资承诺、带退款负债的营业流水或跨链资产兑换。

## 2. 协议字段与同意

| 字段 | 规则 |
|---|---|
| agreementId/title | 唯一标识及业务名称 |
| members | 2–20个唯一非零钱包，每项address、可选私有label、shareBps |
| shareBps | 正整数，总和精确10000；UI百分比最多两位小数 |
| dustRecipient | 必须是成员之一；收取每笔整数舍入余数，预先公开 |
| asset | 固定Arc ERC-20 USDC |
| sources | 可选关联业务；实际来源按链上msg.sender/白名单实例核验，不信任自由文本 |
| termsHash/nonce/deadline | 全员确认的协议版本与签名重放保护 |

所有成员签署同一EIP-712配置hash，包含chainId、factory、agreementId、成员/比例、dustRecipient、nonce与期限。必须在部署激活时验证全部签名，缺一不可；成员为合约钱包时按已验证的ERC-1271流程处理。

协议生效后比例、成员和余数归属不变。更换钱包或比例创建新vault并让未来项目明确引用；老收入继续归旧协议，不能由workspace owner覆盖。

## 3. 页面与旅程

创建者填写成员→自动校验总和→邀请成员查看完整地址/比例→全员签名→部署→获得收入入口。P19显示每个成员签署状态，不显示未经链验证的“全部同意”。任何成员可拒绝，草稿无资金损失。

激活页显示协议、来源、累计分配、自己的可领取额、已到账交易。P20逐笔列出grossAmount、自己的分配、来源合约、规则版本、时间/区块证据。私人标签只在授权工作区展示。

## 4. 分账算法

每笔结算金额x以USDC最小单位整数表示：

```
q[i] = floor(x * bps[i] / 10000)
dust = x - sum(q[i])
credit[i] += q[i]
credit[dustRecipient] += dust
```

固定最多20成员，循环有界；全程uint256/bigint与checked arithmetic。总分配严格等于x。余数最多n-1个最小单位，不隐藏为平台收入。

测试向量：x=1000001（1.000001 USDC），比例3333/3333/3334，初始分配333300/333300/333400，dust=1；若第三人为dustRecipient，结果333300/333300/333401。拆成多笔入金的舍入与一笔总入金可能不同，这是公开的逐笔分配规则。

## 5. 两种入金来源

**独立入金：**payer授权并调用deposit(amount, externalReference)，合约实际transferFrom后记账；externalReference只作备注，不能被展示为真实商品销售证明。

**工具结算：**受支持源实例在可结算后调用depositSettlement(sourceId, amount)。sourceId按chainId/sourceContract/orderId或campaignId/settlementVersion生成，且按msg.sender命名空间唯一；源合约转账和目标记账必须在同一交易中成功。

任何“尚可退款”的金额不得进入。UI里称为“分配收入”而不是“暂存本金”。外部直接ERC-20/native转账不会自动当成已登记收入；单独标记surplus，不让运营方借此动用已有负债。

## 6. 状态机与领取

协议：DRAFT→AWAITING_CONSENTS→ACTIVE；旧协议可标ARCHIVED但不能删除领取权。入金：PENDING→ALLOCATED→各成员独立CLAIMABLE/WITHDRAWN。

withdraw()将调用者credit给固定本人；withdrawFor(member)允许任何人代付Gas触发，但只能发送到该member。v1不接受调用者指定to地址，不做管理员变更旧收款地址。

分配不主动循环转账到所有成员，避免一个被冻结/异常地址阻塞其他人。某成员转出失败，其credit保留；成功转出时原子减少credit并发事件。未领取不产生过期没收。

## 7. API/事件

POST /v1/split/agreements 创建草稿；POST /v1/split/agreements/:id/consents 上传成员签名；POST /v1/split/agreements/:id/publish 在全员同意后返回部署计划。GET /v1/split/agreements/:id/allocations 按授权返回明细。GET /v1/split/agreements/:id/tx-plan?action=deposit|withdraw 生成受约束调用。

事件：SplitCreated(agreementId,membersHash,dustRecipient)、RevenueAllocated(sourceId,payer,amount)、ShareCredited(sourceId,member,amount)、ShareWithdrawn(member,amount)。创建已分账记录不等于已到账，必须区分credit和withdraw。

## 8. 权限与争议边界

工作区管理员可以修改展示名称，不能更改历史比例或任意撤销他人收入。成员不同意来源商品的质量，不代表可以从vault退款；源业务应在结算前解决退款责任。

如需要售后储备，应留在对应源合约，不是把全额转入Split再期待成员交回。已经分配的收入无法由平台单方面追回。协议不保证商业伙伴没有私下收款。

## 9. 验收

| ID | 场景与结果 |
|---|---|
| SPL-01 | 比例9999/10001总和或重复地址→拒绝发布 |
| SPL-02 | 缺成员签名、过期签名、改dustRecipient→不能激活 |
| SPL-03 | 明确舍入向量精确匹配，分配之和=x |
| SPL-04 | 20成员/微额/最大许可金额模糊测试守恒 |
| SPL-05 | 同sourceId重放→拒绝第二次分配，不能重复扣款 |
| SPL-06 | 同reference来自不同msg.sender→不混同来源 |
| SPL-07 | 成员转出失败→其credit保留，其他成员可领 |
| SPL-08 | withdrawFor尝试替换接收地址→接口不存在或拒绝 |
| SPL-09 | 新比例协议建立→旧余额仍按旧规则 |
| SPL-10 | 直接捐赠/原生转账→不改变已经分配的credit |

## 10. 运营指标与上线条件

观察完成签署率、首次真实收入时间、领取失败率和重复合作项目，而不把创建空vault数量当用户价值。上线前必须测试精度、全员签名、重复来源、外部转账失败以及源合约到Split的原子结算；完整真实路径通过前禁止其他工具挂接该vault。
