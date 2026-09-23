# Architecture 03 · 合约、资金与不变量

**这是安全导向的行为规格，不是审计或形式化证明。**实施者必须编写并执行合约测试、模糊测试、不变量测试与独立审查，不能凭本文件直接接收大额资金。

## 1. 网络与资产

2026-09-23官方连接页列Arc主网chainId=5042、测试网5042002。USDC应用接口地址为0x3600000000000000000000000000000000000000，ERC-20精度6，原生精度18且共享余额 [S01/S02]。部署前仍须核对eth_chainId、decimals/balanceOf/allowance行为、实际转账事件与阻止转账条件。

v1合约业务金额只接受ERC-20最小单位，msg.value必须0；不混合原生付款。代币不自由传参替换，allowlist按环境固定。不能照搬WETH包装、把0xEeee哨兵映射为代币地址，或把两套余额相加。

SafeERC20/签名库与Arc系统合约的兼容性须实测：成功/失败返回、余额精度截断、冻结地址、原生意外转入、estimateGas。官方EVM差异见 [S18](../research/SOURCES-AND-ASSUMPTIONS.md)。

## 2. 合约模块

| 模块 | 责任 | 不拥有的权限 |
|---|---|---|
| ArcBoxFactory | 以版本化模板创建实例、记录合法地址、限制新实例 | 改旧实例受益人、挪用旧本金 |
| DeliveryEscrow | 按商品版本接收订单、记录交付证明、退款、结算 | 判断内容满意度、永久保管文件 |
| GroupEscrow | 席位计数、截止判定、取消、退款、释放 | 判断课程已实际完成 |
| SplitVault | 固定成员比例、逐笔分配、个人领取 | 吞入源退款责任、追溯改比例 |
| AttendanceEscrow | 登记、证明、缺席提议、挑战、退款/没收credits | 自动证明到场事实 |
| MilestoneEscrow | 当前阶段入金、交付/验收时限、争议与fallback | 保证作品质量、无期限任意冻结 |
| RewardsDistributor | 固定root、足额资助、领取credit、防重复、到期回收未分配额 | 替换已激活名单、扫走已分配credits |

实现建议每商品版本/活动/协议使用独立不可升级实例或固定implementation的不可变clone。模板升级只影响新实例，不在旧实例背后切换逻辑。通用库可复用金额、credit和签名校验，但资金账本按实例隔离。

## 3. 统一资金分类

每实例追踪：lockedPrincipal（条件未定的本金）、refundCredits、beneficiaryCredits、unallocatedRewards（适用）、totalWithdrawn、recognizedInflows。到账总量不等于可花收入。

核心不变量：

```
tokenBalance >= lockedPrincipal
             + outstandingRefundCredits
             + outstandingBeneficiaryCredits
             + unallocatedRewards
recognizedInflows = outstandingRecognizedLiabilities
                  + recognizedWithdrawals
                  + recognizedExternalSettlements
```

实际余额大于已识别负债的surplus可能来自直接转账，不能拿来给未知订单记账。每种实现只启用适用分类，不能重复把同一金额计入locked与credit。转账失败回滚状态；任何角色都不能凭D1编辑创造/删除credit。

发布前验证所有分支守恒，金额包括裁决分配和舍入余数。平台费v1为0；后续收费新版本明示，不能追溯扣旧本金。

## 4. 通用权限与资金出口

只有部署/发布时固定的角色能提出业务判断；第三方可调用基于确定时间/已有证明的finalize、refundFor、withdrawFor，但to永远是固定受益人。接收地址变更不作为v1功能；EOA丢失/USDC冻结不意味着平台有权改给另一个人。

pull payment避免批量循环外部转账。使用checks-effects-interactions、重入保护、严格输入边界；调用Split失败时源结算整体回滚。管理员只能停新创建/新入金，不能通过pause没收或到期吞掉既有负债。任何引入可暂停退出的设计都必须另行审查，不能悄悄加入。

不提供可扫走USDC本金的通用rescueToken。误转其他资产的恢复也必须证明不影响负债并独立审查；v1可不提供该功能，公开说明错误直接转账不构成业务付款。

## 5. 合约方法的语义接口

以下为方法清单，不是可编译ABI；实现需生成具体struct与ABI测试，并保持语义不变。

| 合约 | 状态改变方法 |
|---|---|
| Factory | createDelivery(config,consent)、createGroup(config,consent)、createSplit(config,memberConsents)、createAttend(config,consent)、createMilestones(config,partyConsents)、createRewards(config,consent) |
| Delivery | pay(intent,signature)、markAvailable(orderId,proof)、refund(orderId)、settle(orderId)、withdrawFor(beneficiary) |
| Group | join(intent,signature)、cancelRegistration(registrationId)、finalize()、cancelCampaign()、refund(registrationId)、settle()、withdrawFor(beneficiary) |
| Split | deposit(amount,reference)、depositSettlement(sourceId,amount)、withdrawFor(member) |
| Attend | register(intent,signature)、cancelRegistration(id)、recordAttendance(proof)、proposeNoShow(id)、challenge(id,evidenceHash)、resolve(id,outcome)、finalizeNoShow(id)、refund(id)、cancelEvent()、withdrawFor(beneficiary) |
| Milestones | fundCurrentStage()、submit(index,evidenceHash)、accept(index)、requestRevision(index,reasonHash)、openDispute(index,evidenceHash)、timeoutRefund(index)、releaseAfterReview(index)、resolve(index,refund,release)、finalizeFallback(index)、mutualSettlement(signedTerms)、withdrawFor(beneficiary) |
| Rewards | fund(amount)、cancelBeforeStart()、claimCredit(index,recipient,amount,proof)、claimAndWithdraw(...)、withdrawFor(recipient)、reclaimUnallocated() |

通用只读：version、rulesHash、asset、roles、state、claimableOf(address)、accountingSummary、order/registration/stage状态。链事件必须包含业务ID、主体、金额/版本，用于无歧义重建。

## 6. 签名设计

所有业务签名使用EIP-712域，区分name/version/chainId/verifyingContract（factory创建意图则用factory域）。数据含实体ID、完整配置hash或动作、nonce、expiry、固定收款主体和所需金额。EIP-712本身不提供防重放，合约必须消费nonce/检查状态版本 [S08]。

订单quote signer只签固定版本价格的付款意图，不能修改受益人。Delivery attestor只签真实订单的bundleHash可用证明，不能任意提款。Attendance attestor只影响指定报名签到。resolver只能分配指定争议本金且必须在时限内。部署/治理密钥离线或受控多签，不进入公开API。

创建阶段跨实例防重放使用factory+uniqueId+nonce；不要让包含构造参数root的CREATE2地址反过来成为root计算必需项。所有标准编码用跨语言测试向量验证。

## 7. 时间边界统一

| 条件 | 严格规则 |
|---|---|
| quote有效 | now < expiresAt；成功付款不因随后到期失效 |
| Deliver及时证明 | now < paidAt+1800 |
| Deliver窗口内退款 | now < paidAt+86400；未及时证明者超时退款不限此窗口 |
| Deliver结算 | availableRecorded && now >= paidAt+86400 && 未退款 |
| Group报名/主动取消 | now < fundingDeadline |
| Group最终判定 | now >= fundingDeadline |
| Group组织者取消/释放 | cancel < releaseAt；settle >= releaseAt |
| Attend缺席挑战 | now < proposalAt+48h；无挑战终结 >= 该时刻 |
| Attend争议裁决 | now < challengedAt+14d；超时退款 >= 该时刻 |
| Milestone提交/修改提交 | now < currentDueAt；逾期退款 >= currentDueAt |
| Milestone验收/争议 | SUBMITTED状态下 now < reviewDeadline；无争议放款 >= reviewDeadline |
| Milestone其他争议 | FUNDED/REVISION_REQUIRED且now < currentDueAt；不得在已到期退出后用争议堵住退款 |
| Milestone裁决/fallback | resolve < resolutionDeadline；fallback >= resolutionDeadline |
| Rewards新增分配 | claimStart <= now < claimDeadline；回收未分配 >= claimDeadline |

block.timestamp不是自然人所在地时间。UI本地时间只作显示；Cron晚运行不延长合同。临界t-1/t/t+1必须逐一测试。

## 8. 各工具额外不变量

Deliver：每orderId最多一次入金和一次终局退款/结算；无及时证明永久不得结算。Group：activeSeats与有效未取消注册一致，退出形成的refundCredit不能被最后settle带走。Split：每笔sum(credits)=deposit，收款成员不变。Attend：每registration在退款/没收之间只能分配一次；无裁决超时全退。Milestones：最多一个未终结已入金阶段；refund+release=当前本金。Rewards：root不可改；claimed index唯一；reclaim不包括已分配但未withdraw的credits。

## 9. 组合安全

源实例只有在退款义务消失时才能转给Split。目标必须来自固定版本factory白名单并且asset一致。sourceId按sourceContract命名空间唯一，重复调用拒绝。原子转账前后的源/目标余额及账本用集成不变量测试。

Group开放资料是链下权益操作，不改变资金分类。Milestones的部分裁决，只将承包方最终获得的部分送到固定目的地；客户refundCredit独立保留。Attend保证金与Rewards未分配额禁止组合分账。

## 10. 试运行风控建议

设计默认：单次普通付款/阶段≤100 USDC；单实例未结负债≤1000 USDC；Split成员≤20；Milestone阶段≤20；Rewards名单≤10000并受金额上限；Group maxSeats×price≤实例上限。Rewards的组织者批量资助可高于单人100，但总额仍≤1000；领取每人≤100。

这些需要在合约而不仅UI中执行。全站总风险5000 USDC可作为运营告警/新实例准入建议，**没有跨实例链上协调器时不是合约硬上限**。上线前负责人明确最终数值，不能把小额度当成安全审计替代品。

## 11. 发布验证记录

部署清单至少包含chainId、token/decimals、factory/instances、templateVersion、源码commit、编译器与optimizer、ABI hash、部署交易/区块、验证链接、角色地址、caps、审查报告版本。不得把placeholder当真实地址。

M0测试环境通过后才进入独立审查和主网小额验证；合约与网站分开发布。旧实例不可升级，因此发现问题时停新业务、公开风险、保留已定义退出；不能承诺通过发布新前端修复链上漏洞。
