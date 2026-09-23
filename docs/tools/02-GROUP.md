# Group · 成团收款

规格版本 v1.0。目标：有最低付费席位要求的课程、工作坊或服务预售，在固定截止时刻决定是否成立。不能用“报名意向”冒充已付费席位，也不能把达到门槛说成已经履约。

## 1. 场景与角色

示例：线上工作坊每席30 USDC，至少10席、最多20席；报名截止后达标开班，未达标可取回本金。两位讲师可在结算时按70/30分账。数字均为示例。

组织者发布/取消；报名钱包付费/在截止前退出；任何人可以按确定规则finalize；资料服务开放权限；受益人或Split接收结算收入。没有付费买家必须加入的复杂团队系统。

v1每钱包每期最多一个有效席位；不能证明不同钱包是不同自然人。首版不支持优惠券、分期报名、名额转售、多人团购、多币种或超募后改门槛。

## 2. 创建字段

| 字段 | 约束 |
|---|---|
| title/description | 课程/活动内容、交付范围、组织者资料和真实联系入口 |
| seatPriceU6 | 固定价格>0，满足单笔上限 |
| minSeats/maxSeats | 2≤min≤max≤500；max×price不超过实例资金上限 |
| fundingDeadline | 最终成团判定时刻；未来UTC时间 |
| serviceStart/serviceEnd | fundingDeadline < start ≤ end |
| releaseAt | > serviceEnd；建议end+48小时，发布前显式确认 |
| payoutDestination | 固定组织者钱包或同意的SplitVault |
| bundleVersion | 可选预上传资料；成功后开放，不能替代课程本身 |
| termsHash | 截止前取消、成功后退出限制、组织者取消、释放时间的快照 |

不允许通过下调minSeats或延期fundingDeadline让原本失败的活动“变成功”。更改条款必须新建一期，用户原本金可按原规则退出。

## 3. 付款前规则卡

显示“已付费席位7/最低10/上限20”；不标成已验证人数。显示绝对截止时刻和用户本地时区。重点提示：报名截止前可退；截止后成功成团，v1不提供买家任意退出；组织者可在releaseAt之前取消整期并退本金；releaseAt后可结算。质量/未履约争议不由人数合约自动解决，正式商用前必须审阅业务退款义务。

## 4. 标准流程

草稿→冻结条款→部署实例→发布报名链接。join调用精确收取一席金额并锁定；合约在同一调用中核验仍在报名期、容量未满、钱包无有效席位。D1“预留名额”只能改善UX，不是最终名额承诺。

截止前cancelRegistration退回本金形成buyer credit，activeSeats和activePrincipal同步扣减；允许重新报名，但新registrationNonce必须不同，旧退款不能重放。

截止时或之后，任何人可finalize。activeSeats≥min则SUCCESS，否则FAILED；不允许在截止前因为一度达到门槛就提前成功。退款、查询后的行动入口可以内联执行finalize，不依赖后台按时运行。

成功可开放资料访问。releaseAt之前组织者可cancelCampaign：活动变CANCELLED，全部未结算有效报名可逐个取回本金，资料权益撤销。到达releaseAt且未取消，任何人可settle：一次性把activePrincipal送到固定收款方/分账，禁止遍历全部报名者转账。

## 5. 状态与资金

| 状态 | 可做 | 不能做 |
|---|---|---|
| FUNDING, t<deadline | join、买家退出、组织者取消 | finalize成功、分账 |
| FUNDING, t≥deadline | finalize或在后续方法中内联判定 | 再报名、截止后主动退出 |
| FAILED | 每个有效报名钱包永久保有本金退款权 | 组织者提款、再次激活 |
| SUCCESS, t<releaseAt | 展示已成团、开放资料、组织者整期取消 | Split入金、买家无条件退出（v1） |
| CANCELLED | 原付款人退款 | 结算给组织者 |
| SUCCESS, t≥releaseAt | settle到固定目的地 | 组织者再取消 |
| SETTLED | 查看记录、受益人领取 | 原本金再次退款或结算 |

精确deadline：join/cancelRegistration不再允许，finalize允许。精确releaseAt：组织者cancel不再允许，settle允许。所有边界由block.timestamp判断。

未领取的失败/取消本金不得到期归组织者。直接转入合约而未调用join的资产不计入席位，也不能被用来伪造成团。

## 6. 资金不变量

报名期：activePrincipal=有效未退出席位数×seatPrice；实际余额覆盖activePrincipal+已形成未领取退款credit。退出时不能既保留席位又拿回本金。

失败/取消期：每个registration只允许分配一次退款。成功结算：settlementAmount=仍有效的activePrincipal，之前取消形成的refundCredits不包含在内；settle不能把这些退款负债送给Split。

退/结算操作均先更新状态再外部调用，重入/代币转账失败时回滚，不吞掉权益。合约不计入网络费或直接捐赠作为营业额。

## 7. 页面与通知

P17公开页：标题、价格、席位进度、时间轴、规则、组织者、主CTA。已报名者看到自己的席位与“退出并取回本金/等待结果/可退款/查看资料”。P18后台：报名名单脱敏、截止结果、取消动作、结算倒计时、异常。

通知：首次报名、临近截止、成团/失败、组织者取消、可退款、可结算。通知只是提醒，不能作为最终判定。用户通过合约可以查看并执行权益，即使未收到邮件。

## 8. API与事件

- POST /v1/group/campaigns：创建草稿；PATCH草稿需If-Match。
- POST /v1/group/campaigns/:id/publish：生成部署计划与不可变条款。
- GET /v1/group/campaigns/:id：返回席位及链上asOf，不用过期D1缓存承诺最后名额。
- POST /v1/group/campaigns/:id/join-intents：绑定payer与报价，仍由合约最终检查容量。
- GET /v1/group/campaigns/:id/tx-plan?action=finalize|cancel|settle|refund：按actor权限生成调用计划。

事件：SeatFunded(registrationId,payer,amount)、SeatCancelled、GroupFinalized(success,activeSeats,activePrincipal)、GroupCancelled、GroupRefundCredited、GroupSettled。

## 9. 异常/滥用

两人争最后一席，合约只接受一笔；失败者可能消耗Gas但不能扣留本金。RPC延迟导致公开页仍显示空位，UI必须以模拟/链上结果纠正。组织者删除网页不改变资金合约。讲师没有履约不是数据库管理员直接“退款全部”的理由；已有资金释放后无法单方面追回，不能隐瞒此限制。

恶意组织者多个钱包自购可达到门槛：这是资金门槛而不是独立人数保证，必须标明。虚假标题/版权/违法活动通过举报和停止新增展示处理，但不能随意划走用户资金。

## 10. 验收

| ID | 场景与结果 |
|---|---|
| GRP-01 | 截止前暂时达标→仍未最终成团，退出后数量正确 |
| GRP-02 | 截止后9/10席→失败，每人可退，组织者不能领 |
| GRP-03 | 截止后10/10席→成功，资料开放但金额未提前分账 |
| GRP-04 | 最后一席并发→仅一笔成功，人数不超max |
| GRP-05 | 退出后重新报名→旧退款不能再次领取或抵消新席位 |
| GRP-06 | deadline-1、deadline、releaseAt-1、releaseAt边界正确 |
| GRP-07 | 成功后取消→所有有效报名可退款、Split无入金 |
| GRP-08 | 已退出钱包有待领取退款→settle不动该负债 |
| GRP-09 | Cron停止→参与者仍能finalize和退款 |
| GRP-10 | 重复settle/退款→余额和各项负债守恒 |
