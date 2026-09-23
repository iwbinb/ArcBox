# Milestones · 分阶段付款

规格版本 v1.0。目标：已经建立合作关系的客户与自由职业者，先为当前阶段锁定款项，再提交、验收、放款。不是工作撮合平台，也不保证作品质量。

## 1. 场景

示例：网站设计分草图、视觉稿、交付三个阶段。前一个阶段终结后才给下一阶段入金；不要求把整个项目金额一次性交给平台。示例总价600 USDC，但真实试运行须遵守单阶段/实例上限，不直接使用超限演示金额进行主网付款。

最重要的信息不是聊天界面，而是：“当前阶段多少钱、钱是否到位、谁下一步操作、哪天超时、争议时钱怎么退出”。

## 2. 合同字段

| 字段 | 约束 |
|---|---|
| client/contractor | 唯一非零地址、双方不同；真实名称可选且私有 |
| stages | 1–20阶段；序号、标题、明确交付标准、amountU6、dueAt |
| reviewSeconds | v1默认7天；付款前双方明确接受无争议超时放款规则 |
| revisionLimit | v1最多2次；每次延长48小时，必须在最终longstop内 |
| longstopAt | 当前阶段的最晚交付边界；不能靠反复修改无限延期 |
| resolver | 双方共同指定并已确认可用的第三方，不由AI自动替代 |
| arbitrationSeconds | v1固定14天，从disputeAt起算 |
| fallbackRefundBps | resolver超时后退给客户的预设比例0–10000；**必须双方主动确认，无隐藏默认值** |
| contractorDestination | 固定承包方钱包；后续可接已批准Split |
| termsHash/nonce | 阶段、期限、受益人、争议及fallback的完整签名快照 |

fallback比例不代表平台认为公平，只是双方在签约前约定的确定性退出方式。页面必须用金额例子展示：比如本阶段100 USDC、fallbackRefundBps=4000，则超时退客户40、承包方60。没有明确确认此项就不能激活。

## 3. 签约与入金

草稿可由任一方发起；另一方查看全部阶段和条款后签同一EIP-712配置。修改任何金额、交付标准hash、期限、resolver、fallback都使旧签名失效。部署时校验双方有效同意。

只允许一个当前阶段持有未终结本金。客户fundCurrentStage精确支付；状态转FUNDED后承包方开始工作。未入金阶段不能提交“已担保”的作品或自动索取后续资金。下一阶段不是自动扣款，必须客户再次签名付款。

## 4. 提交、修改与验收

承包方在dueAt前上传私有文件/证据并签署提交hash，调用submit；数据存储与内容可读性必须先确认，链上只保存hash与时间。客户收到提醒，reviewDeadline=submittedAt+reviewSeconds。

客户可在reviewDeadline之前accept或提出dispute；也可在revisionLimit内requestRevision，必须说明与交付标准相关的修改要求hash。请求修改结束当前review计时，进入REVISION_REQUIRED，下一次提交截止=min(now+48h,longstopAt)。承包方可提交修订或在截止前提出争议，不无限延长。

提交后客户不响应：到达reviewDeadline，任何人可releaseAfterReview，按事先明确接受的条款放款。此规则是商业约定而不是自动判断作品优秀；付款前和审核页持续醒目提示。

## 5. 逾期与取消

当前已入金但未按期提交/修订且未进入有效争议：到期后客户可timeoutRefund全额本金。未入金的未来阶段可以取消，不影响已释放的过去阶段。

双方随时可以签署mutualSettlement，指定本阶段退客户的整数金额与承包方金额，和必须等于锁定本金；含当前状态版本、nonce和expiry。签名重放或状态变化后复用必须拒绝。单方“删除项目”不能取消另一方资金权益。

## 6. 争议与有界退出

任一方在允许阶段调用openDispute，锁定当前未分配本金；其他阶段不能突然被自动入金。证据留私有R2，双方和resolver可访问，运营支持无默认全文权限。

resolver在disputeAt+14天前resolve(refundU6,releaseU6,evidenceHash)，仅能在本阶段本金内分配，收款人固定为客户/承包方，不能转给resolver或管理员。金额相加严格等于本金，结果形成credits。

到达resolutionDeadline仍未裁决：任何人可finalizeFallback，refund=floor(principal*fallbackRefundBps/10000)，剩余给承包方。精确deadline时resolver不再可裁决，fallback可执行，避免双通道竞争。

这是有界资金退出，不保证事实判断正确；仲裁服务、收费与实际可用性是主网开放前必须落实的事项。本版平台不收争议费；后续引入费用必须新版本，不从旧本金临时扣除。

## 7. 状态表

| 当前 | 条件/动作 | 后继 |
|---|---|---|
| UNFUNDED | 客户精确入金 | FUNDED |
| FUNDED | 截止前承包方submit | SUBMITTED |
| SUBMITTED | 客户accept | RELEASE_CREDITED |
| SUBMITTED | 合法requestRevision | REVISION_REQUIRED |
| SUBMITTED | t≥reviewDeadline且无争议 | RELEASE_CREDITED |
| FUNDED/REVISION_REQUIRED | 超过交付截止且未提交/争议 | REFUND_CREDITED |
| 活动中的当前阶段 | 合法openDispute | DISPUTED |
| DISPUTED | resolver在截止前分配 | RESOLVED |
| DISPUTED | t≥resolutionDeadline | FALLBACK_RESOLVED |
| 未终结阶段 | 双方有效和解 | MUTUALLY_SETTLED |

终态再领取以credits为准；部分裁决形成双方credits，不能把已领取一方的部分再发给另一方。资金状态与文件交付状态分开。

## 8. 页面细节

P24上方显示双方、合同版本、当前阶段和谁该操作；下方阶段列表与不可变条款。未双签前不能出现“资金已保障”。P25显示交付版本、下载、验收倒计时、修改次数及争议入口；“提出争议”与“验收放款”不能藏在相同下拉菜单。

放款确认明确显示金额、接收人、后续不可由平台撤回；超时验收提醒至少在24小时和1小时两个节点计划发送，但通知故障不改变合同时间。双方签约时必须承认不能依赖通知才获得时间信息。

## 9. API与事件

POST /v1/milestones/contracts；POST /v1/milestones/contracts/:id/consents；POST /v1/milestones/contracts/:id/publish；POST /v1/milestones/contracts/:id/stages/:index/submissions（只创建私有证据和tx-plan，不伪造上链）；POST /v1/milestones/contracts/:id/disputes/:id/evidence；GET .../tx-plan?action=fund|submit|accept|revise|dispute|resolve|fallback|refund。

事件：ContractActivated、StageFunded、StageSubmitted、RevisionRequested、DisputeOpened、StageResolved、StageCreditAllocated、StageWithdrawn。业务ID与stageIndex必须贯穿UI、API、事件和数据库唯一约束。

## 10. 验收

| ID | 场景与结果 |
|---|---|
| MIL-01 | 修改任一条款后使用旧双方签名→不能激活 |
| MIL-02 | 同时为两个阶段入金或预先自动扣款→拒绝 |
| MIL-03 | 交付截止前提交成功；超时未提交→客户可退 |
| MIL-04 | 提交后7天无争议→可按规则放款，不靠Cron |
| MIL-05 | 第3次修改请求或超过longstop→拒绝无限延期 |
| MIL-06 | 争议已上链→自动放款和超时退款旧路径全部停止 |
| MIL-07 | resolver超过本金或换第三方地址→拒绝 |
| MIL-08 | 精确resolutionDeadline触发fallback，比例/余数守恒 |
| MIL-09 | 重放双方和解签名、阶段状态已变→拒绝 |
| MIL-10 | 已放款阶段不能被取消未来阶段动作追回 |

高风险工具：真实仲裁安排、证据留存、安全审查和小额演练缺一不可。设计完成不等于允许直接接收真实大额订单。
