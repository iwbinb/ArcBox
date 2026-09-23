# Deliver · 交付收款

规格版本 v1.0。目标：创作者分享一个链接出售数字文件，买家付款后获得访问权限；不给用户制造“截图付款后再等人工回复”的流程。该工具独立可用，Split 是可选的结算去向。

## 1. 具体场景与边界

示例：创作者出售 15 USDC 的设计模板包，上传一个ZIP和PDF说明。买家查看预览、确认退款规则、付款，然后进入文件页。示例不是已上线商品。

v1 支持可下载文件，不支持流媒体、外部授权码库存、会员订阅、实物物流、自动税票。内容版权、质量和已经下载后的复制无法由链上付款证明；平台必须说明文件访问与“满意交付”不同。

## 2. 角色与页面

卖家创建商品和版本；买家付款、下载、在窗口内退款；交付证明服务只确认指定文件版本可提供访问；它不是任意资金管理员。

创建页面 P09/P10 → 商品公开页 P15 → 付款 P12 → 个人凭证 P13 → 文件页 P16；后台显示商品、订单、交付异常、退款与待结算。

## 3. 创建字段

| 字段 | 规则 |
|---|---|
| title/description | 80/2000字符内；禁止脚本HTML；支持安全Markdown |
| previewImage/previewText | 公开素材与付费文件分开；不可自动泄露全文件 |
| priceU6 | >0，最多6位小数，受试运行单笔上限约束 |
| bundleId/bundleVersion/hash | 必须已上传、校验、通过文件安全检查；发布时冻结 |
| deliveryDeadlineSeconds | v1固定1800秒，从链上付款时刻计算 |
| refundWindowSeconds | v1固定86400秒，从付款时刻计算；卖家不能临时缩短 |
| accessRetention | v1承诺的服务访问期建议30天；过期行为与售后必须公开，不宣称永久存储 |
| payoutDestination | 卖家固定地址或已同意的SplitVault；发布后不可改旧订单 |
| attestor | 交付证明签名地址，绑定商品版本；界面解释平台可用性依赖 |
| termsHash/version | 完整规则与内容版本快照 |

下架只停止新订单；不能删除已有买家的有效文件版本。涨价生成新商品版本，未付款旧报价按自己的短期有效期处理，已付款订单不变。

## 4. 标准流程

1. 买家看文件格式/大小/版本、价格、30分钟交付超时、24小时无条件退款窗口、访问保留期。
2. SIWE绑定买家钱包，获取10分钟有效的订单intent；合约绑定payer、productVersion、amount、orderId。
3. 买家精确授权并调用pay，金额进入该商品版本的交付结算合约。
4. 后端核验业务事件，创建私有访问权益；证明服务实际HEAD/校验文件后签发可访问证明。
5. 受限代执行器或买家/卖家把证明提交到链上 markAvailable；必须在 paidAt+1800 之前成功记账，晚到不接受。
6. 买家使用短期下载链接。退款窗口内任何时候可申请全额本金退款，不需要卖家同意，即使曾经下载；这是v1主动接受的防纠纷/卖家滥用风险折中。
7. paidAt+86400后，且已及时记录可访问证明、没有退款，任何人可触发settle，资金成为固定卖家或Split的可领取收入。

交付证明服务可能谎报或失效，这是明确的信任边界；它不能修改收款方或缩短退款时间。服务停止且未在30分钟内记录可访问证明时，买家可退款且卖家不能结算。

## 5. 状态机与截止边界

| 当前 | 动作/条件 | 下一状态/资金结果 |
|---|---|---|
| QUOTED | 有效intent + 精确入金 | FUNDED，本金锁定 |
| FUNDED | t < deliveryDeadline，合法证明 | AVAILABLE，仍可全额退款 |
| FUNDED/AVAILABLE | t < refundUntil | REFUNDED，买家固定credit |
| FUNDED且未及时证明 | t >= deliveryDeadline | DELIVERY_TIMEOUT，可退款；不得晚补证明后夺走退款权 |
| DELIVERY_TIMEOUT | 任意后续时间refund | REFUNDED |
| AVAILABLE | t >= refundUntil 且未退款 | SETTLED，卖家credit或Split入金 |
| REFUNDED/SETTLED | 再次退款/结算 | 拒绝，终态不变 |

在精确refundUntil时刻退款窗口关闭、结算条件开放，二者不能同时成功。窗口内退款先于证明时，后续证明不得重新激活订单。退款和结算同区块按链上交易顺序执行。

## 6. 文件与下载安全

私有R2只保存不可变版本；上传先进入quarantine，检查扩展名/MIME/大小/hash，不能只信客户端Content-Type。v1不执行上传的代码；文件扫描服务未配置时，只允许经过人工批准的受控演示文件，不开放任意用户上传。

每次下载先验证当前钱包会话与entitlement未撤销，签发建议60秒的GET授权。授权URL过期前可能重复使用/转发；要真正单次访问需Worker凭证消费并流式读取，不把普通presigned URL宣传成一次性保护。依据 [S06](../research/SOURCES-AND-ASSUMPTIONS.md)。

退款立即撤销后续授权；已签发短链到期前和已下载内容不能收回。文件删除必须检查仍有效订单引用和保留期，不能删除正在交付的版本。R2短暂不可用时显示重试及明确退款入口。

## 7. 后端/API与事件

- POST /v1/deliver/products：草稿、文件版本、价格和条款；workspace editor可编辑。
- POST /v1/deliver/products/:id/publish：owner权限，生成不可变版本与发布交易计划。
- POST /v1/deliver/products/:id/orders：payer、version、idempotencyKey；返回orderId/intent/签名与截止。
- POST /v1/orders/:id/transactions：提交txHash仅作为核验提示，不直接修改paid。
- POST /v1/orders/:id/downloads：验证买家和权限，返回短期访问或处理中原因。
- GET /v1/orders/:id/tx-plan?action=refund|settle|mark-available：返回可验证交易计划，用户签名执行。

事件：DeliveryPaid(orderId,payer,amount,versionHash,paidAt)、DeliveryAvailable(orderId,bundleHash)、DeliveryRefundCredited(orderId,payer,amount)、DeliverySettled(orderId,destination,amount)。Transfer只作对账，不触发商品权益。

## 8. 关键异常

批准成功但pay失败：未购买，允许重新模拟pay，不重复授权。文件准备任务重复：同orderId+bundleVersion只生成一条有效权益。链已付款但D1故障：补扫后恢复；买家不再付款。证明任务停止：30分钟后退款路径仍在链上。买家换钱包：不转移旧订单权益。卖家被封禁：停止新订单/新文件传播，但不得没收用户退款或已形成资金权益。

退款后卖家要求恢复下载：作为新订单或明确赠送权限，不能改变旧订单财务结果。24小时后内容问题走售后与自愿补偿，不能宣称合约能够逆转已经分配的收入；适用法律义务仍需审阅。

## 9. 验收测试

| ID | Given / When / Then |
|---|---|
| DEL-01 | 正确付款确认→文件准备→能访问冻结版本；金额/订单与链一致 |
| DEL-02 | 只有approve或给任意钱包转同额USDC→不得解锁 |
| DEL-03 | 重复receipt/消息/下载请求→不重复收费或创建收入 |
| DEL-04 | paidAt+1799记录证明成功；+1800不再接受迟到证明 |
| DEL-05 | paidAt+86399可退款；+86400已AVAILABLE才可结算 |
| DEL-06 | 未证明超过24小时→仍可退款、永远不能按AVAILABLE结算 |
| DEL-07 | 退款后新下载请求失败，旧短链的残留有效期有明确测试 |
| DEL-08 | 修改商品价格/文件→旧买家仍绑定旧版本 |
| DEL-09 | 退款与settle竞争→总付出不超过入金，只有一个终态 |
| DEL-10 | Split目标调用失败→settle整体回滚，无资金丢账 |

## 10. 发布门禁

真实文件保留策略、受限证明密钥/代执行预算、版权与举报流程、退款政策必须配置。无证明执行器预算或文件无法访问时拒绝新订单，不继续收款后期待人工补救。建议先仅允许受邀卖家、单笔不超过100 USDC的试运行上限；这是设计上限不是安全保证。
