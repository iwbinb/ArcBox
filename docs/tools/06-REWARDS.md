# Rewards · 奖励领取

规格版本 v1.0。目标：运营方已有资格名单与金额，预先存入足额USDC，让合资格地址自助查询和领取。它不负责生产资格、不做任务撮合，也不把领奖人数量当产品付费需求。

## 1. 场景与边界

示例：活动奖励80个钱包，每人10 USDC；运营方上传名单、确认合计800、设置领取时限并足额入金。参与者连接自己的钱包，查询资格并领取。数据均为示例。

v1只支持Arc USDC和明确EVM地址。不通过社交账号自动推导收款地址，不支持NFT奖励、抽签随机性、KYC承诺或跨链地址转换。另一条链上的地址是否由同一人控制不能靠字符串相同证明。

## 2. 创建字段

| 字段 | 校验 |
|---|---|
| campaignId/title/description | 唯一ID、活动与资格来源说明 |
| CSV | address、amount必需；label可选且私有 |
| claimStart/claimDeadline | start<deadline，明确UTC时刻 |
| fundingTotalU6 | 等于校验后名单金额总和，不用页面浮点合计 |
| root/manifestHash | deterministic构建、双人复核后冻结 |
| sponsor/refundDestination | 默认同出资人；不同地址需要显式同意 |
| allowClaimFor | 可代付Gas，但奖励始终给叶子中的recipient |
| termsHash | 名单规则、截止、未领金额归属、链上公开性、Gas责任 |

CSV最多10000条为建议首版业务上限；在Workers资源测试后可下调。错误行不能静默跳过：重复地址、零地址、格式错误、<=0金额、超6位小数、总额超限均返回逐行报告。地址标准化后查重；重复项必须由组织者明确合并或修正，不能自动决定。

## 3. 不可变名单与Merkle规则

标准叶数据：chainId、factoryAddress、campaignId、index、recipient、amountU6。每个campaignId在factory唯一，避免跨链/跨期重放；不把尚未计算出来的CREATE2实例地址加入会造成循环依赖的初始化根计算。

使用已审查的标准Merkle实现及固定测试向量；叶子双hash/节点排序必须与Solidity验证一致，不能前端自行拼接字符串后keccak。依据 [S09](../research/SOURCES-AND-ASSUMPTIONS.md)。文档/代码中锁定同一编码schemaVersion。

root与manifestHash在激活后不可修改。错名单在未开始且尚无分配时可以取消并退回出资，再开新期；活动开始后不能替换root夺取已公布的权利。名单文件私有；公开root不是名单加密保证。

## 4. 发布与领取流程

上传→逐行错误校验→显示总钱包数/总金额/随机抽样→导出复核清单→计算root→创建并足额入金→链上确认→开放领取页。未足额入金不显示“奖励已准备好”。

参与者无登录可阅读规则；钱包签名后查询自己的资格与proof。不能通过传任意address参数枚举整个私人名单。查到资格后可保存个人恢复proof；不想领取可以离开，不要求留邮箱。

默认动作claimAndWithdraw：链上验证proof、窗口和未使用index，形成固定recipient credit并立即尝试领取；转账失败整体回滚。另提供claimCredit，用于先在截止前固定权益，再按条件withdraw；UI明确这不等于已经到账。

claimFor允许任何人提交有效proof，资金固定给recipient；不会因为被别人先提交而被偷走。没有Gas可由组织者自愿代执行，不宣传人人免费。

## 5. 截止与余额回收

claim窗口为claimStart≤t<claimDeadline。精确deadline时停止新增权益分配；已经在截止前分配的credit继续属于recipient，可在截止后领取。

出资人到期可回收的是**尚未分配给任何领取者的奖励余额**，不包括已分配但未成功转出的credits。计算：可回收=已入金-累计已分配奖励-之前已回收金额；不能直接把合约balance全部取走。

这是赠与奖励期限，不可照搬到Group/Deliver等买家已支付本金的退款权。名单误填或用户迟领的个案可以另开补发活动，不能后台篡改已用bitmap。

## 6. 状态

活动：DRAFT→VALIDATING→READY_TO_FUND→FUNDED→ACTIVE→EXPIRED；未开始且无分配时可CANCELLED。名单冻结后修正必须新期。

地址：INELIGIBLE / ELIGIBLE / CREDITED / WITHDRAWN；窗口已过但CREDITED不回退成没资格。展示累计已到账与已分配分开；运营方看80人中63人已到账时，不把仅有63次查询算63次领取。

## 7. 隐私与可用性

原CSV、私有label、完整树制品存在私有R2，仅owner可导出。每个用户只取得自己的proof；区块交易会暴露领取地址和金额，不承诺匿名。

根在链上不等于proof会永远可得。个人查询后提供“保存领取凭证”，包含network、campaign、index、recipient、amount、proof、schemaVersion；用户可离线保存并自行广播。尚未保存proof的用户仍依赖证明分发服务；需备份树制品、校验hash、可重建索引，并公开该依赖。

恶意CSV公式（=,+,-,@前缀）、压缩炸弹、超大行、重复BOM需要防护；导出供表格软件打开时进行公式注入转义，不改变底层实际钱包/金额值。

## 8. API与事件

POST /v1/rewards/campaigns；POST /v1/rewards/campaigns/:id/uploads；GET .../validation；POST .../freeze；POST .../publish；GET /v1/rewards/campaigns/:id/eligibility（从认证钱包取recipient）；GET .../proof；GET .../tx-plan?action=fund|claim|claim-credit|withdraw|reclaim。

数据表记录merkle_index、recipient、amount_u6、leaf_hash与证明对象版本；(campaign,index)与(campaign,recipient)唯一。链上bitmap防止重复；后端status只是投影。

事件：RewardsFunded、RewardCreditAllocated(index,recipient,amount)、RewardWithdrawn、UnallocatedRewardsReclaimed。投影按事件更新，不相信用户点过按钮。

## 9. 异常

错误钱包→解释当前连接地址，无须显示他人金额。proof不匹配→不发送无效交易，提示root/schema不一致。链上已领但数据库落后→查询bitmap及credit，不要求再次领取。收款被USDC规则阻止→保留已分配credit，不能自动换成运营钱包。

到期时在mempool的claim不保证成功，按实际入块时间判断；页面在临近截止时提醒用户预留时间。赞助代执行器停机不应移除用户自己签名的领取入口。

## 10. 验收

| ID | 场景与结果 |
|---|---|
| REW-01 | CSV错误/重复标准化地址/精度错误→完整逐行报告，不静默丢行 |
| REW-02 | 前端、Worker与Solidity的同一Merkle向量一致 |
| REW-03 | 换chainId/campaignId/recipient/amount/index→proof失败 |
| REW-04 | 正确proof第一次分配成功，第二次拒绝 |
| REW-05 | claimFor由第三方调用→仍只归固定recipient |
| REW-06 | 截止前credit成功但未转出→到期reclaim不得侵占 |
| REW-07 | claimDeadline精确时刻不新增分配，旧credit仍可领 |
| REW-08 | root冻结后编辑名单→拒绝并要求新活动 |
| REW-09 | 主站失效但用户已保存proof→可经公开合约完成操作 |
| REW-10 | 转账失败/冻结地址→bitmap与credits按方法原子语义保持正确 |

上线前必须有名单复核、完整树备份、未分配/未到账分离报表和真实小额领取演练。不能以上传成功替代资金到位。
