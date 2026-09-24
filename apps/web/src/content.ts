export type Lang = "zh" | "en";
export type Localized = Record<Lang, string>;
export const both = (zh: string, en: string): Localized => ({ zh, en });

export type Tool = {
  id: string;
  name: Localized;
  shortName: string;
  action: Localized;
  description: Localized;
  scenario: Localized;
  audience: Localized;
  steps: [Localized, Localized, Localized];
  rule: Localized;
  faq: Localized;
  keywords: Localized;
};

export const tools: Tool[] = [
  {
    id: "deliver",
    name: both("交付收款", "Deliver"),
    shortName: "Deliver",
    action: both("付款", "Payment"),
    description: both(
      "出售文件或内容，付款后按规则开放访问。",
      "Sell a file or content and grant access after payment under stated rules.",
    ),
    scenario: both(
      "卖一份设计模板，买家付款后获得文件访问。",
      "Sell a design template and grant the buyer access after payment.",
    ),
    audience: both(
      "出售数字资料的创作者和小团队。",
      "Creators and small teams selling digital materials.",
    ),
    steps: [
      both(
        "说明文件版本、内容与价格",
        "Describe the file version, contents, and price",
      ),
      both(
        "买家按订单付款，确认后提供受限访问",
        "Buyer pays an order; limited access follows confirmation",
      ),
      both(
        "按交付记录与退款窗口处理订单",
        "Use delivery evidence and the refund window to resolve the order",
      ),
    ],
    rule: both(
      "设计规则：及时记录可访问证明；付款后 24 小时内可无条件退款。无法及时交付时，买家保留退款路径。网络费用不退，文件也无法防止复制。",
      "Designed rule: record access proof promptly; buyers may refund within 24 hours of payment. Failed timely delivery preserves a refund path. Network fees are not refunded, and files cannot be made copy proof.",
    ),
    faq: both(
      "付款截图不能证明订单已完成；应以订单和合约事件为准。",
      "A payment screenshot does not prove an order completed; use the order and contract events.",
    ),
    keywords: both(
      "文件 内容 模板 出售 下载 交付 收款",
      "file content template sell download delivery payment",
    ),
  },
  {
    id: "group",
    name: both("成团收款", "Group"),
    shortName: "Group",
    action: both("报名付款", "Join and pay"),
    description: both(
      "先付款占席，截止时达标才成团，否则可退本金。",
      "Pay to reserve a seat; the group succeeds at the deadline or principal is refundable.",
    ),
    scenario: both(
      "开一场工作坊，设定付费席位门槛与截止日期。",
      "Run a workshop with a paid seat threshold and a deadline.",
    ),
    audience: both(
      "开课、团购或组织限额活动的人。",
      "People running classes, group purchases, or limited events.",
    ),
    steps: [
      both(
        "设定付费席位门槛与截止时间",
        "Set the paid seat threshold and deadline",
      ),
      both(
        "参与者付款占席，可在截止前按规则取消",
        "Participants pay for seats and may cancel under the rules",
      ),
      both(
        "截止时判定成团；失败形成退款权",
        "Decide at the deadline; failure creates refund rights",
      ),
    ],
    rule: both(
      "门槛按有效付费席位计算，只有截止时才最终判定。失败可退本金；成团不等于活动已履约，款项释放时间须单独说明。",
      "The threshold counts active paid seats and is decided only at the deadline. Failure refunds principal; a successful group does not prove fulfillment. Release timing must be stated separately.",
    ),
    faq: both(
      "即使提前达到人数，也不会提前宣布最终成团。",
      "Reaching the threshold early does not finalize the group early.",
    ),
    keywords: both(
      "开课 团购 工作坊 报名 人数 退款",
      "class group workshop register seats refund",
    ),
  },
  {
    id: "split",
    name: both("合伙分账", "Split"),
    shortName: "Split",
    action: both("领取分账", "Withdraw share"),
    description: both(
      "把已经可分配的收入按固定比例分给伙伴。",
      "Share eligible settled revenue with partners at fixed percentages.",
    ),
    scenario: both(
      "三位合作者确认固定比例，各自领取已分配收入。",
      "Three collaborators agree to fixed shares and withdraw their own allocations.",
    ),
    audience: both(
      "共同创作、运营或销售的小团队。",
      "Small teams creating, operating, or selling together.",
    ),
    steps: [
      both(
        "列出成员钱包与合计 100% 的比例",
        "List member wallets and percentages totaling 100%",
      ),
      both(
        "成员确认协议后接收可分配收入",
        "Members confirm the agreement before eligible revenue enters",
      ),
      both("每人自行领取固定份额", "Each member withdraws their fixed share"),
    ],
    rule: both(
      "只接收已解除退款责任的收入；比例和成员确认后不可追溯修改。舍入余数归属与资金来源须公开。",
      "Only revenue free of refund liabilities may enter. Confirmed members and shares cannot change retroactively. Disclose rounding remainder and revenue source.",
    ),
    faq: both(
      "仍在退款期的本金不能进入分账。",
      "Principal still subject to refund cannot enter a split.",
    ),
    keywords: both(
      "分钱 分账 合作 比例 收入 领取",
      "split partners shares revenue withdraw",
    ),
  },
  {
    id: "attend",
    name: both("报名保证金", "Attend"),
    shortName: "Attend",
    action: both("缴纳保证金", "Register with deposit"),
    description: both(
      "为活动报名设定保证金、签到与异议规则。",
      "Set attendance deposits, check in, and challenge rules for an event.",
    ),
    scenario: both(
      "社区见面会收取保证金，并事先说明缺席处理。",
      "Collect deposits for a meetup and explain absence handling in advance.",
    ),
    audience: both(
      "组织需要报名和签到的活动的人。",
      "Organizers of events that need registration and check in.",
    ),
    steps: [
      both(
        "写明时间地点、保证金与核验者",
        "State time, place, deposit, and verifier",
      ),
      both(
        "参与者报名并记录签到证据",
        "Participants register and attendance evidence is recorded",
      ),
      both(
        "有缺席提议时保留异议和超时退款路径",
        "An absence proposal retains challenge and timeout refund paths",
      ),
    ],
    rule: both(
      "未签到不自动扣款。缺席提议有 48 小时异议窗口；有争议须由指定方处理，14 天无裁决则退还本金。",
      "Missing check in does not automatically forfeit a deposit. An absence proposal has a 48 hour challenge window; a named resolver handles disputes, and unresolved cases refund after 14 days.",
    ),
    faq: both(
      "上线前必须明确签到核验者和真实可用的争议处理方。",
      "A real verifier and dispute resolver must be identified before launch.",
    ),
    keywords: both(
      "活动 报名 保证金 签到 申诉",
      "event register deposit check in challenge",
    ),
  },
  {
    id: "milestones",
    name: both("分阶段付款", "Milestones"),
    shortName: "Milestones",
    action: both("当前阶段入金", "Fund current stage"),
    description: both(
      "当前阶段单独入金，交付与验收后再处理款项。",
      "Fund the current stage only, then handle payment after delivery and review.",
    ),
    scenario: both(
      "设计项目分两阶段，先资助当前阶段再验收。",
      "Run a two stage design project, funding and reviewing one stage at a time.",
    ),
    audience: both(
      "需要分期交付与验收的合作双方。",
      "Two parties working through staged delivery and acceptance.",
    ),
    steps: [
      both(
        "约定当前阶段金额、期限与双方角色",
        "Agree on the current amount, deadlines, and roles",
      ),
      both(
        "只为当前阶段入金并提交交付证据",
        "Fund only the current stage and submit evidence",
      ),
      both(
        "验收、修订或按争议与超时规则退出",
        "Accept, revise, or exit through dispute and timeout rules",
      ),
    ],
    rule: both(
      "最多一个未终结的已入金阶段。交付、验收、争议与默认处理期限都须写清；争议超时走事先约定的有界兜底分配。",
      "At most one unresolved funded stage. State delivery, review, dispute, and default deadlines; an unresolved dispute follows a bounded, previously agreed fallback.",
    ),
    faq: both(
      "产品不会判断交付质量；争议方与兜底规则须先确定。",
      "The product cannot judge delivery quality; resolver and fallback rules must be set first.",
    ),
    keywords: both(
      "里程碑 阶段 合同 项目 付款 验收",
      "milestone stage contract project payment review",
    ),
  },
  {
    id: "rewards",
    name: both("奖励领取", "Rewards"),
    shortName: "Rewards",
    action: both("领取奖励", "Claim reward"),
    description: both(
      "固定奖励名单与额度，合资格钱包按规则领取。",
      "Fix a reward list and amounts, then let eligible wallets claim.",
    ),
    scenario: both(
      "为社区贡献者准备奖励名单，让每人自行领取。",
      "Prepare a contributor list and let each eligible wallet claim.",
    ),
    audience: both(
      "面向已确认名单发放奖励的组织者。",
      "Organizers distributing rewards to a confirmed list.",
    ),
    steps: [
      both(
        "核对钱包、金额、期限与名单公开范围",
        "Check wallets, amounts, deadline, and list visibility",
      ),
      both("固定名单并足额资助奖励", "Fix the list and fund the reward pool"),
      both(
        "合资格钱包领取，区分已分配与未分配余额",
        "Eligible wallets claim; separate allocated from unallocated funds",
      ),
    ],
    rule: both(
      "名单根激活后不可替换。已分配的领取权益不能被回收；期限后仅可处理未分配余额，领取人需支付网络费。",
      "The activated list root cannot be replaced. Allocated claim credits cannot be reclaimed; only unallocated funds may be handled after the deadline. Claimants pay network fees.",
    ),
    faq: both(
      "拥有链接不代表有资格，资格由固定名单与钱包证明决定。",
      "Having the link does not imply eligibility; the fixed list and wallet proof decide it.",
    ),
    keywords: both(
      "奖励 激励 资格 名单 领取",
      "reward incentive eligibility list claim",
    ),
  },
];

export const byId = (id: string) => tools.find((tool) => tool.id === id);
