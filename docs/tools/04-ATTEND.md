# Attend · 报名保证金

规格版本 v1.0。目标：组织者用可退保证金管理活动报名，参会者完成核验后领回本金。不是售票市场，也不把没收保证金作为平台收入。

## 1. 场景与信任边界

示例：20席工作坊，每人10 USDC保证金；到场退款，提前取消退款；组织者提出缺席后，用户有异议窗口。组织者取消活动则全退。

链上不能自行知道一个人是否到场。签到证明由指定工作人员/证明服务签发；缺席判定有挑战与独立处理路径。相机、二维码、IP都不是不可伪造的到场证明。误判处理不是可选附加功能，而是本工具资金规则的一部分。

## 2. 角色

组织者创建/取消/提出缺席；operator扫描并记录签到，但除单独被授予的签到签名权外无资金权限；参会者报名、取消、领取、挑战；resolver在有限争议范围内裁决。resolver不得与组织者或参会者相同，必须在发布前同意职责，实际服务未确定时不开放含没收规则的主网活动。

## 3. 创建字段

| 字段 | 约束 |
|---|---|
| title/location/joinInfo | 活动说明；敏感入场链接仅向已报名用户显示 |
| depositU6/capacity | 固定保证金；人数及总本金不超过实例上限 |
| registrationDeadline | ≤eventStart；到期停止新报名 |
| cancelBefore | ≤registrationDeadline；明确用户可无条件退出的最后时刻 |
| eventStart/eventEnd | end>start；时区明确 |
| checkinOpen/checkinClose | 建议start前30分钟至end；可配置但发布后固定 |
| attendanceRecordDeadline | v1固定eventEnd+24小时，留工作人员补录缓冲 |
| noShowProposalDeadline | 同eventEnd+24小时；缺席提议只在eventEnd后提出 |
| challengeWindow | v1固定48小时，从缺席提议上链时刻起算 |
| arbitrationWindow | v1固定14天，从挑战上链时刻起算 |
| attestor/resolver | 不可变角色；工作人员撤销/轮换不能悄悄改变既有报名条款 |
| noShowRecipient | 固定组织者/指定受益地址；不默认为ArcBox |
| termsHash | 所有取消、签到、挑战、超时全退规则 |

v1一个钱包一个有效报名；不证明独立自然人。修改时间、保证金额、判定人必须新建活动并明确处理旧期退款，不能强迫原参与者接受。

## 4. 标准路径

报名付款→获得个人活动页和动态签到码→工作人员核验→签发带eventId/registrationId/participant/nonce/validBefore的签到证明→在期限内提交链上→形成参会者全额退款credit→领取。

证明提交可由参会者、组织者或受限代执行器完成，款项始终归报名钱包。主界面分别显示“工作人员已核验”“链上已确认”“退款可领取”“已到账”，不能一扫码就显示退款成功。

## 5. 退出、取消与缺席

- t<cancelBefore：报名者可退出并获得全额本金credit，释放名额；重新报名使用新nonce。
- 组织者在活动尚未终结、且相关报名尚未分配前取消：所有未分配本金归报名者；不能追回已经有效支付的款项。
- 已有有效签到记录：参会者可全额退款，无缺席没收。
- eventEnd ≤ t < noShowProposalDeadline：组织者可对未签到且未分配报名提出缺席，不能立即提款。
- 没有缺席提议且t≥proposalDeadline：参会者默认可全额退款，避免组织者不操作导致锁死。
- 有提议：参会者在t<proposalAt+48h提交链上challenge，冻结争议金额；网页提交证据不等于链上挑战已生效。
- 没有挑战且t≥challengeDeadline：任何人可finalizeNoShow，把该笔本金分配给事先明确的noShowRecipient。
- 已挑战：resolver在裁决期内只可判全退参会者或按条款归noShowRecipient；v1不做任意比例罚款。
- 裁决超时：默认全退参会者，不默认没收，不永久冻结。

若合法签到证明在attendanceRecordDeadline前补录，即使已有缺席提议/挑战也优先全额退款；已形成终局分配不能再次被改变。最早缺席终结晚于补录期限，从时间安排上避免同一笔先没收后出现合法补录。

## 6. 每个报名的状态机

REGISTERED→CHECKED_IN→REFUND_CREDITED→WITHDRAWN。
REGISTERED→CANCELLED→REFUND_CREDITED。
REGISTERED→NO_SHOW_PROPOSED→（无挑战）FORFEIT_CREDITED。
NO_SHOW_PROPOSED→CHALLENGED→RESOLVED_REFUND / RESOLVED_FORFEIT。
CHALLENGED且裁决超时→REFUND_CREDITED。

退款与没收分配互斥；每笔报名最多一个终局受益人。合约本身只执行授权的证明/判定/时间条件，不证明裁决公平。

## 7. 签到 UX 与反滥用

P22工作人员界面采用大扫码区域、活动名、钱包短地址、报名有效状态和确认按钮。码内不放姓名/邮箱/可提款私钥；短期挑战值单次使用，服务端原子消费、按活动隔离、扫码操作审计。

转发二维码仍可能被他人使用，需要工作人员核验本人/活动自定身份规则；不能以“链上签到”宣传绝无代签。离线扫码缓存仅作待补录证据，显示provisional；恢复网络后检查报名与nonce，不能覆盖已经终结的记录。

相机权限失败提供人工短码核验；人工操作同样需要operator权限及日志。导出名册遵循最小权限，公开页不展示完整参与者联系资料。

## 8. API与事件

POST /v1/attend/events、POST /v1/attend/events/:id/publish；POST /v1/attend/events/:id/registration-intents；POST /v1/attend/events/:id/checkin-challenges；POST /v1/attend/events/:id/checkins（operator，返回受限证明，不直接算已退）；POST /v1/attend/registrations/:id/evidence（当事人，私有存储）；GET对应tx-plan支持register/cancel/record-attendance/propose-no-show/challenge/resolve/refund。

事件：Registered、AttendanceRecorded、NoShowProposed、NoShowChallenged、AttendanceResolved、AttendanceRefundCredited、NoShowCreditAllocated。链上证据仅放随机ID和加盐内容hash，原文留私有R2。

## 9. 边界与失败

参会者没Gas：可由任何人代付Gas执行固定收款人的已有退款，但平台不保证免费赞助。USDC收款受限时保留credit，不转给工作人员。组织者删除活动页仍不能停止固定退款路径。无人裁决默认全退规则必须写在付款前摘要，不能隐藏。

暂停新报名不暂停挑战/退款；对于某类危险操作可停止新缺席提议，但不能因此延长挑战截止。已发生事故需要以原规则处理在途项，不能临时改合约夺取资金。

## 10. 验收

| ID | 场景与结果 |
|---|---|
| ATT-01 | 签到码重复/跨活动/过期→不产生第二次退款 |
| ATT-02 | operator无资金角色→不能提出没收或改变受益人 |
| ATT-03 | 已签到→无法没收；补录在期限内能解除未终结缺席 |
| ATT-04 | 缺席提议→48小时内不能提现缺席款 |
| ATT-05 | 挑战及时上链→停止无挑战终结路径 |
| ATT-06 | 裁决14天无人处理→参会者全退 |
| ATT-07 | 无签到也无提议→提议期限后默认可退 |
| ATT-08 | 活动取消→未分配本金全部可逐笔退，不遍历强制转账 |
| ATT-09 | 临界cancelBefore/challengeDeadline/resolutionDeadline判断一致 |
| ATT-10 | 网站离线、队列重复、链上拒绝→不显示已退款且不丢credit |

本工具比普通收款复杂，须完成真实签到演练、仲裁角色确认、争议保护和独立合约审查后再开放公众主网资金。
