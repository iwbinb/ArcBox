import { useEffect, useState } from "react";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { ChartPieSliceIcon } from "@phosphor-icons/react/dist/csr/ChartPieSlice";
import { UserIcon } from "@phosphor-icons/react/dist/csr/User";
import { StackIcon } from "@phosphor-icons/react/dist/csr/Stack";
import { GiftIcon } from "@phosphor-icons/react/dist/csr/Gift";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { GlobeIcon } from "@phosphor-icons/react/dist/csr/Globe";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { WalletIcon } from "@phosphor-icons/react/dist/csr/Wallet";
import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";

const TOOLS = [
  { id: "deliver", name: "交付收款", english: "Deliver", icon: FileTextIcon, tone: "deliver", description: "我想发送文件或内容，对方付款后自动获取。", example: "卖一份模板，付款后开放文件。", keywords: "文件 内容 模板 出售 下载 交付 收款" },
  { id: "group", name: "成团收款", english: "Group", icon: UsersThreeIcon, tone: "group", description: "我想发起一个成团活动，达到人数后再收款。", example: "开一场工作坊，人数不够就退款。", keywords: "开课 团购 工作坊 报名 人数 退款" },
  { id: "split", name: "合伙分账", english: "Split", icon: ChartPieSliceIcon, tone: "split", description: "我想与伙伴一起收款，按设定比例自动分账。", example: "三位合作者按固定比例领取收入。", keywords: "分钱 分账 合作 比例 收入 领取" },
  { id: "attend", name: "报名保证金", english: "Attend", icon: UserIcon, tone: "attend", description: "我想收取活动报名费或保证金，并按规则处理。", example: "报名工作坊，签到与退款规则写清楚。", keywords: "活动 报名 保证金 签到 申诉" },
  { id: "milestones", name: "分阶段付款", english: "Milestones", icon: StackIcon, tone: "milestones", description: "我想按阶段完成里程碑，分批收款或放款。", example: "先为当前阶段入金，再验收交付。", keywords: "里程碑 阶段 合同 项目 付款 验收" },
  { id: "rewards", name: "奖励领取", english: "Rewards", icon: GiftIcon, tone: "rewards", description: "我想发放奖励或激励，让参与者按规则领取。", example: "已有奖励名单，让合资格钱包自助领取。", keywords: "奖励 激励 资格 名单 领取" },
];

const SCREEN_PATHS = { home: "/", wizard: "/create/deliver", payment: "/p/demo", workspace: "/app" };
const WIZARD_STEPS = ["基础信息", "业务规则", "预览发布"];
const DEMO_NAMES = { deliver: "设计资源包", group: "秋季工作坊", split: "合作收入分配", attend: "社区见面会", milestones: "设计项目阶段款", rewards: "社区贡献奖励" };

function screenFromPath(pathname) {
  if (pathname.startsWith("/create")) return "wizard";
  if (pathname.startsWith("/p/")) return "payment";
  if (pathname.startsWith("/app")) return "workspace";
  return "home";
}
function toolFromPath(pathname) { return TOOLS.find(tool => pathname.startsWith(`/create/${tool.id}`)) ?? TOOLS[0]; }

function DemoNotice({ compact = false }) {
  return <span className={compact ? "demo-notice compact" : "demo-notice"}><InfoIcon size={17} weight="regular" />仅演示，不涉及真实资金</span>;
}

function Header({ screen, onNavigate, onModal }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  return <header className="site-header">
    <div className="header-inner">
      <button className="brand" type="button" onClick={() => onNavigate("home")} aria-label="ArcBox 首页">
        <img src="/assets/arcbox-mark.png" alt="" />
        <span>ArcBox</span>
      </button>
      {screen !== "payment" && <nav className={menuOpen ? "primary-nav is-open" : "primary-nav"} aria-label="主导航">
        <button type="button" className={screen === "home" ? "nav-link active" : "nav-link"} onClick={() => { onNavigate("home"); setMenuOpen(false); }}>工具</button>
        <button type="button" className="nav-link" onClick={() => { onModal({ kind: "scenario" }); setMenuOpen(false); }}>使用场景</button>
        <button type="button" className={screen === "workspace" ? "nav-link active" : "nav-link"} onClick={() => { onNavigate("workspace"); setMenuOpen(false); }}>我的记录</button>
      </nav>}
      <div className="header-actions">
        <div className="language-control">
          <button type="button" className="language-button" aria-expanded={languageOpen} onClick={() => setLanguageOpen(!languageOpen)}><GlobeIcon size={21} /> 中文 <CaretDownIcon size={14} /></button>
          {languageOpen && <div className="language-menu" role="menu"><button type="button" role="menuitem" onClick={() => setLanguageOpen(false)}>中文 · 当前</button><button type="button" role="menuitem" onClick={() => { setLanguageOpen(false); onModal({ kind: "language" }); }}>English · 视觉预览</button></div>}
        </div>
        {screen === "payment" ? <button className="payment-header-help" type="button" onClick={() => document.querySelector(".payment-rules, .receipt-rule-note")?.scrollIntoView({ behavior: "smooth" })}>查看规则</button> : <button className="wallet-button" type="button" onClick={() => onModal({ kind: "wallet" })}>连接钱包</button>}
      </div>
      {screen !== "payment" && <button className="mobile-menu-button" type="button" aria-label={menuOpen ? "关闭菜单" : "打开菜单"} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <XIcon size={23} /> : <ListIcon size={23} />}</button>}
    </div>
  </header>;
}

function ToolCard({ tool, onSelect }) {
  const Icon = tool.icon;
  return <article className="tool-card">
    <div className="tool-heading">
      <span className={`tool-icon ${tool.tone}`}><Icon size={36} weight="regular" aria-hidden="true" /></span>
      <div><h2>{tool.name}</h2><span className="tool-english">{tool.english}</span></div>
    </div>
    <p className="tool-description">{tool.description}</p>
    <div className="tool-actions">
      <span className="preview-status"><EyeIcon size={21} />预览</span>
      <button className="primary-button small" type="button" onClick={() => onSelect(tool)}>查看方案 <ArrowRightIcon size={18} /></button>
    </div>
  </article>;
}

function Home({ onSelect }) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const matches = TOOLS.filter(tool => `${tool.name} ${tool.english} ${tool.description} ${tool.keywords}`.toLowerCase().includes(submitted.trim().toLowerCase()));
  const search = (event) => { event.preventDefault(); setSubmitted(query); document.getElementById("tool-results")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  return <main className="home-page">
    <section className="home-hero" aria-labelledby="home-title">
      <h1 id="home-title">你今天想完成什么？</h1>
      <p>用 Arc 与 USDC，完成清楚的收款、交付与协作任务。</p>
      <form className="hero-search" role="search" onSubmit={search}>
        <MagnifyingGlassIcon size={25} aria-hidden="true" />
        <input value={query} onChange={event => setQuery(event.target.value)} aria-label="搜索任务或场景" placeholder="搜索任务或场景，例如：发文件、开课、退款、分账" />
        <button className="primary-button search-button" type="submit">搜索</button>
      </form>
      <div className="search-examples"><span>例如：</span>{["发文件", "开课", "退款", "分账"].map(term => <button type="button" key={term} onClick={() => { setQuery(term); setSubmitted(term); document.getElementById("tool-results")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{term}</button>)}</div>
    </section>
    <section className="tool-section" id="tool-results" aria-label="ArcBox 工具">
      {submitted && <div className="search-result-heading"><span>“{submitted}” 的相关方案 · {matches.length} 项</span><button type="button" onClick={() => { setQuery(""); setSubmitted(""); }}>清除搜索</button></div>}
      {matches.length ? <div className="tool-grid">{matches.map(tool => <ToolCard key={tool.id} tool={tool} onSelect={onSelect} />)}</div> : <div className="empty-result"><MagnifyingGlassIcon size={30} /><h2>暂时没有匹配的方案</h2><p>试试“发文件”“开课”“分账”，或浏览全部六种工具。</p><button className="secondary-button" type="button" onClick={() => { setQuery(""); setSubmitted(""); }}>浏览全部工具</button></div>}
    </section>
  </main>;
}

function Stepper({ current, onStep }) {
  return <ol className="stepper" aria-label="创建进度">{WIZARD_STEPS.map((label, index) => <li key={label} className={index === current ? "current" : index < current ? "complete" : ""}><button type="button" onClick={() => onStep(index)} aria-current={index === current ? "step" : undefined}><span>{index < current ? <CheckCircleIcon size={19} weight="fill" /> : index + 1}</span>{label}</button></li>)}</ol>;
}

function RuleSummary({ name, price, tool }) {
  return <aside className="rule-summary" aria-label="规则摘要"><div className="summary-top"><span className="eyebrow">实时规则摘要</span><span className="preview-pill">预览</span></div><h3>{name || `我的${tool.name}项目`}</h3><dl><div><dt>工具</dt><dd>{tool.name}</dd></div><div><dt>金额</dt><dd>{price || "15"} USDC</dd></div><div><dt>收款方</dt><dd>示例工作区</dd></div><div><dt>退款规则</dt><dd>按发布时的规则执行</dd></div><div><dt>网络费用</dt><dd>由操作人另付</dd></div></dl><p className="summary-foot">这里只展示视觉效果；真实发布前还需检查完整地址、版本与退款条件。</p></aside>;
}

function Wizard({ tool, onNavigate, onNotice }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(DEMO_NAMES[tool.id]);
  const [price, setPrice] = useState("15");
  const [description, setDescription] = useState(tool.example);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const validPrice = /^(0|[1-9]\d*)(\.\d{1,6})?$/.test(price) && Number(price) > 0;
  const advance = () => {
    if (step === 0 && (!name.trim() || !validPrice)) { setError("请填写项目名称，并输入最多 6 位小数的有效金额。"); return; }
    if (step === 1 && !agreed) { setError("请先确认已阅读演示规则。"); return; }
    setError("");
    if (step < 2) setStep(step + 1); else onNavigate("payment");
    window.scrollTo(0, 0);
  };
  return <main className="interior-page wizard-page"><div className="page-width">
    <div className="breadcrumbs"><button type="button" onClick={() => onNavigate("home")}>工具</button><span>/</span><span>{tool.name}</span><span>/</span><strong>创建链接</strong></div>
    <div className="page-heading"><div><span className="eyebrow">创建向导 · 视觉基准</span><h1>创建{tool.name}链接</h1><p>先把用途和规则写清楚，再看对方会看到的页面。</p></div><DemoNotice compact /></div>
    <Stepper current={step} onStep={index => { setStep(index); setError(""); }} />
    <div className="wizard-layout"><section className="wizard-main" aria-live="polite">
      {step === 0 && <div className="form-content"><h2>基础信息</h2><p className="section-intro">先让对方知道这是什么，再设置金额。</p><label>项目名称 <span className="required">*</span><input value={name} onChange={event => setName(event.target.value)} placeholder="例如：设计资源包" /></label><label>公开说明<textarea rows="4" value={description} onChange={event => setDescription(event.target.value)} /></label><label>金额 <span className="required">*</span><div className="money-input"><input inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} aria-describedby="price-help" /><span>USDC</span></div><small id="price-help">最多 6 位小数；网络费用另计。</small></label></div>}
      {step === 1 && <div className="form-content"><h2>业务规则</h2><p className="section-intro">关键条件会展示给付款人，并固定在对应规则版本中。</p><div className="rule-row"><ShieldCheckIcon size={24} /><div><strong>交付方式</strong><p>付款确认后提供受限文件访问，演示中不上传真实文件。</p></div></div><div className="rule-row"><ClockIcon size={24} /><div><strong>退款窗口</strong><p>示例：付款后 24 小时内按规则可退款；网络费用不退。</p></div></div><label className="check-row"><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} /><span>我已阅读以上演示规则与资金提示。</span></label></div>}
      {step === 2 && <div className="form-content"><h2>预览发布</h2><p className="section-intro">检查公开页会展示的信息。这里不会部署合约或创建真实付款链接。</p><div className="preview-document"><span className="preview-pill">公开页预览</span><h3>{name || "设计资源包"}</h3><p>{description || "项目公开说明"}</p><strong>{price || "15"} USDC</strong><div className="preview-document-rule">付款前可查看交付、退款及费用规则。</div></div></div>}
      {error && <div className="field-error" role="alert"><WarningCircleIcon size={18} />{error}</div>}
      <div className="wizard-actions"><button className="plain-button" type="button" onClick={() => step ? setStep(step - 1) : onNavigate("home")}><ArrowLeftIcon size={18} />上一步</button><div><button className="secondary-button" type="button" onClick={() => onNotice("演示草稿已暂存在本页；没有上传或发布。") }><FloppyDiskIcon size={17} />保存演示草稿</button><button className="primary-button" type="button" onClick={advance}>{step === 2 ? (tool.id === "deliver" ? "预览付款页" : "查看付款页示例") : "继续"}<ArrowRightIcon size={18} /></button></div></div>
    </section><RuleSummary name={name} price={price} tool={tool} /></div>
  </div></main>;
}

function Receipt({ onReset, onNavigate }) {
  return <main className="interior-page receipt-page"><div className="receipt-width">
    <button className="back-link" type="button" onClick={onReset}><ArrowLeftIcon size={17} />返回付款页</button>
    <div className="receipt-heading"><span className="eyebrow">订单凭证 · 视觉基准</span><DemoNotice compact /></div>
    <h1>演示凭证</h1><p className="receipt-lead">这里展示付款后应有的清晰记录；本次只是界面演示，没有钱包签名或链上交易。</p>
    <div className="receipt-layout"><section className="receipt-sheet"><div className="receipt-status"><InfoIcon size={23} /><div><strong>视觉演示已完成</strong><span>未发生付款，不能作为实际交易凭证。</span></div></div><div className="receipt-product"><span className="eyebrow">交付收款 · Deliver</span><h2>设计资源包</h2><strong>15 USDC</strong></div><dl><div><dt>订单</dt><dd>仅演示 · 未创建</dd></div><div><dt>付款钱包</dt><dd>未连接</dd></div><div><dt>链上交易</dt><dd>未发送</dd></div><div><dt>规则版本</dt><dd>示例，不对应真实合约</dd></div></dl><p className="receipt-rule-note">真实凭证会固定展示实际付款账户、工具、金额、规则和链上证据；仅知道链接不等于取得访问权限。</p></section><aside className="receipt-next"><span className="eyebrow">下一步</span><h2>知道钱和权益在哪里</h2><p>真实付款确认后，这里会显示交付进度、退款路径及可核验的交易记录。演示中不生成文件权益。</p><button className="secondary-button" type="button" onClick={onReset}>重新查看付款流程</button><button className="plain-button" type="button" onClick={() => onNavigate("home")}>返回工具目录 <ArrowRightIcon size={17} /></button></aside></div>
  </div></main>;
}

function Payment({ onNavigate, onNotice }) {
  const [phase, setPhase] = useState(0);
  const phaseLabels = ["待授权", "授权演示完成", "付款演示完成"];
  if (phase === 2) return <Receipt onReset={() => setPhase(0)} onNavigate={onNavigate} />;
  return <main className="interior-page payment-page"><div className="payment-width">
    <button className="back-link" type="button" onClick={() => onNavigate("home")}><ArrowLeftIcon size={17} />返回工具</button>
    <div className="payment-heading"><span className="eyebrow">交付收款 · 公开付款页视觉基准</span><DemoNotice compact /></div>
    <div className="payment-layout"><section className="payment-intro"><h1>设计资源包</h1><p className="payment-lead">付款后获得设计模板与使用说明。付款前，请先查看交付方式和退款规则。</p><div className="creator-line"><FileTextIcon size={24} /><div><strong>示例工作区</strong><span>数字内容交付 · 演示项目</span></div></div></section>
      <section className="payment-rules"><h2>购买前请确认</h2><div><strong>交付</strong><p>链上付款确认后，文件访问由工作区提供。</p></div><div><strong>退款</strong><p>示例规则：付款后 24 小时内可申请退款；网络费用不退。</p></div><div><strong>费用</strong><p>平台费 0；网络费用在实际钱包确认前展示。</p></div></section>
      <aside className="payment-panel"><div className="summary-top"><span className="eyebrow">订单摘要</span><span className="preview-pill">演示</span></div><div className="payment-amount"><span>需支付</span><strong>15 <small>USDC</small></strong></div><dl><div><dt>网络</dt><dd>Arc · 演示</dd></div><div><dt>收款对象</dt><dd>示例工作区</dd></div><div><dt>网络费用</dt><dd>实际操作时显示</dd></div></dl><ol className="payment-steps"><li className={phase >= 1 ? "done" : "active"}><span>1</span>授权 USDC</li><li className={phase >= 2 ? "done" : ""}><span>2</span>确认付款</li><li className={phase >= 2 ? "done" : ""}><span>3</span>查看凭证</li></ol><div className="payment-demo-state"><InfoIcon size={18} /><span>{phase === 0 ? "此原型不连接钱包，也不会广播交易。" : phase === 1 ? "授权仅为界面演示，尚未付款。" : "这是演示凭证，未发生链上交易。"}</span></div><button className="primary-button payment-cta" type="button" onClick={() => { if (phase < 2) setPhase(phase + 1); else { setPhase(0); onNotice("演示状态已重置，没有任何链上交易。") } }}>{phase === 0 ? "演示授权步骤" : phase === 1 ? "演示付款步骤" : "重置演示"}<ArrowRightIcon size={18} /></button><span className="payment-disclaimer">{phaseLabels[phase]} · 仅用于视觉确认</span></aside>
    </div>
  </div></main>;
}

function Workspace({ onNavigate, onNotice }) {
  return <main className="interior-page workspace-page"><div className="workspace-width"><div className="workspace-top"><div><span className="eyebrow">示例工作区 · 视觉基准</span><h1>待你处理</h1><p>先看下一步，再打开对应项目和链上证据。</p></div><DemoNotice compact /></div><div className="workspace-layout"><aside className="workspace-sidebar" aria-label="工作区导航"><strong>示例工作区</strong><button className="selected" type="button">概览</button><button type="button" onClick={() => onNotice("项目列表将在网站骨架阶段接入；这里展示工作区视觉基准。")}>项目</button><button type="button" onClick={() => onNotice("活动记录将在共享平台阶段接入。")}>活动记录</button><button type="button" onClick={() => onNotice("团队设置将在共享平台阶段接入。")}>设置与团队</button></aside><div className="workspace-main"><div className="workspace-section-heading"><div><h2>需要你处理</h2><p>演示事项 · 按下一步整理，不是资金统计</p></div><span className="preview-pill">2 项示例</span></div><div className="task-list"><div className="task-row"><span className="task-symbol deliver"><FileTextIcon size={24} /></span><div><strong>设计资源包</strong><span>交付收款 · 草稿尚未发布</span></div><button type="button" onClick={() => onNavigate("wizard")}>继续编辑 <ArrowRightIcon size={17} /></button></div><div className="task-row"><span className="task-symbol group"><UsersThreeIcon size={24} /></span><div><strong>秋季工作坊</strong><span>成团收款 · 请先确认规则</span></div><button type="button" onClick={() => onNotice("此项目是视觉演示，没有真实报名或入金。")}>查看规则 <ArrowRightIcon size={17} /></button></div></div><div className="workspace-section-heading recent-heading"><div><h2>最近项目</h2><p>状态由业务与链上证据决定；这里全部是演示数据。</p></div></div><div className="recent-list"><span>设计资源包</span><span>交付收款</span><span className="soft-status">草稿</span><button type="button" onClick={() => onNavigate("wizard")}>打开</button></div></div><aside className="workspace-next"><span className="eyebrow">下一步</span><h2>发布第一条链接</h2><p>先选用途，填写规则，再检查对方看到的页面。演示不会触发钱包或付款。</p><button className="primary-button" type="button" onClick={() => onNavigate("wizard")}>新建项目 <PlusIcon size={18} /></button></aside></div></div></main>;
}

function Footer({ onNavigate }) {
  return <footer className="site-footer"><div><span>ArcBox — 为创作者、小团队和组织者提供实用的 Arc / USDC 工具</span><DemoNotice /></div><nav aria-label="视觉基准页面"><button type="button" onClick={() => onNavigate("home")}>工具首页</button><button type="button" onClick={() => onNavigate("wizard")}>创建向导</button><button type="button" onClick={() => onNavigate("payment")}>付款页</button><button type="button" onClick={() => onNavigate("workspace")}>工作区</button></nav></footer>;
}

function Modal({ content, onClose, onNavigate }) {
  useEffect(() => { const onKey = event => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onClose]);
  if (!content) return null;
  const isTool = content.kind === "tool";
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" type="button" aria-label="关闭" onClick={onClose} autoFocus><XIcon size={20} /></button>{isTool ? <><span className="eyebrow">工具方案 · 预览</span><h2 id="modal-title">{content.tool.name}</h2><p>{content.tool.example}</p><div className="modal-rule"><ShieldCheckIcon size={22} /><span>了解成功条件、退款路径和费用后，再创建链接。</span></div><button className="primary-button" type="button" onClick={() => { onClose(); onNavigate("wizard", content.tool); }}>预览创建向导 <ArrowRightIcon size={18} /></button></> : content.kind === "wallet" ? <><span className="eyebrow">连接钱包</span><h2 id="modal-title">这里暂不连接钱包</h2><p>当前是 M1-A 视觉基准。你可以浏览全部工具、规则和演示页面；没有真实签名或付款。</p><DemoNotice /></> : content.kind === "scenario" ? <><span className="eyebrow">使用场景</span><h2 id="modal-title">从一件具体的事开始</h2><p>例如开一场工作坊：先明确成团条件，成功后交付资料，再将可结算收入按固定比例分给伙伴。</p><button className="primary-button" type="button" onClick={() => { onClose(); onNavigate("home"); }}>浏览对应工具 <ArrowRightIcon size={18} /></button></> : <><span className="eyebrow">语言</span><h2 id="modal-title">English preview</h2><p>这份 M1-A 原型先确认中文版布局；完整中英双语文案在网站骨架阶段接入。</p></>}</section></div>;
}

export function App() {
  const [screen, setScreen] = useState(() => screenFromPath(window.location.pathname));
  const [activeTool, setActiveTool] = useState(() => toolFromPath(window.location.pathname));
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState("");
  useEffect(() => { const onPop = () => { setScreen(screenFromPath(window.location.pathname)); setActiveTool(toolFromPath(window.location.pathname)); }; window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop); }, []);
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(""), 3500); return () => window.clearTimeout(id); }, [toast]);
  const navigate = (target, tool) => { const chosen = tool ?? activeTool; if (tool) setActiveTool(tool); window.history.pushState({}, "", target === "wizard" ? `/create/${chosen.id}` : SCREEN_PATHS[target]); setScreen(target); setModal(null); window.scrollTo({ top: 0, behavior: "instant" }); };
  return <><Header screen={screen} onNavigate={navigate} onModal={setModal} />{screen === "home" ? <Home onSelect={tool => setModal({ kind: "tool", tool })} /> : screen === "wizard" ? <Wizard key={activeTool.id} tool={activeTool} onNavigate={navigate} onNotice={setToast} /> : screen === "payment" ? <Payment onNavigate={navigate} onNotice={setToast} /> : <Workspace onNavigate={navigate} onNotice={setToast} />}<Footer onNavigate={navigate} />{modal && <Modal content={modal} onClose={() => setModal(null)} onNavigate={navigate} />}{toast && <div className="toast" role="status"><CheckCircleIcon size={19} />{toast}</div>}</>;
}
