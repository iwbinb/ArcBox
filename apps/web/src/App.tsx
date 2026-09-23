import React, { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { ChartPieSliceIcon } from "@phosphor-icons/react/dist/csr/ChartPieSlice";
import { UserIcon } from "@phosphor-icons/react/dist/csr/User";
import { StackIcon } from "@phosphor-icons/react/dist/csr/Stack";
import { GiftIcon } from "@phosphor-icons/react/dist/csr/Gift";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { GlobeIcon } from "@phosphor-icons/react/dist/csr/Globe";
import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { byId, tools } from "./content";
import type { Lang, Tool } from "./content";

const icons = [
  FileTextIcon,
  UsersThreeIcon,
  ChartPieSliceIcon,
  UserIcon,
  StackIcon,
  GiftIcon,
];
const words = {
  zh: {
    tools: "工具",
    scenarios: "使用场景",
    records: "我的记录",
    wallet: "连接钱包",
    preview: "预览",
    demo: "Demo / Preview · 仅演示，不涉及真实资金",
    hero: "你今天想完成什么？",
    heroSub: "用 Arc 与 USDC，完成清楚的收款、交付与协作任务。",
    searchPlaceholder: "搜索任务或场景，例如：发文件、开课、退款、分账",
    search: "搜索",
    examples: "例如：",
    examplesList: ["发文件", "开课", "退款", "分账"],
    results: "相关方案",
    clear: "清除搜索",
    noResults: "暂时没有匹配的方案",
    noResultsSub: "试试“发文件”“开课”“分账”，或浏览全部六种工具。",
    allTools: "浏览全部工具",
    seePlan: "查看方案",
    foot: "为创作者、小团队和组织者提供实用的 Arc / USDC 工具。",
    fee: "业务使用 Arc USDC；网络费用由操作人另付。演示页没有钱包连接、订单或交易。",
    who: "适合谁",
    how: "如何运作",
    example: "使用示例",
    rule: "关键规则",
    faq: "常见问题",
    create: "预览创建流程",
    back: "返回工具",
    step1: "基础信息",
    step2: "业务规则",
    step3: "预览",
    wizardTitle: "创建演示草稿",
    wizardSub: "先写清用途，再检查关键规则。草稿仅保存在此浏览器。",
    projectName: "项目名称",
    description: "公开说明",
    amount: "示例金额",
    amountHelp: "USDC，最多 6 位小数；此处不生成付款请求。",
    ruleAck: "我已阅读上方规则，并理解这只是演示。",
    next: "下一步",
    previous: "上一步",
    save: "保存本地草稿",
    saved: "草稿已保存在此浏览器",
    storageError:
      "无法访问浏览器本地存储。当前内容不能保存，请检查浏览器设置。",
    required: "请填写项目名称和有效的正数金额（最多 6 位小数）。",
    ackError: "请先阅读并确认演示规则。",
    review: "预览公开信息",
    reviewHint: "此页面不会发布链接、创建业务记录或向链上发送交易。",
    paymentPreview: "查看公开操作页预览",
    paymentSub: "这里展示操作前应核对的信息。没有业务记录或资金操作。",
    noOrder: "未创建业务记录",
    noWallet: "未连接钱包",
    noContract: "未部署业务合约",
    noTransaction: "未发送交易",
    payDisabled: "功能尚未开放",
    amountLabel: "金额",
    network: "网络",
    recipient: "业务合约",
    account: "操作钱包",
    order: "业务记录",
    workspaceTitle: "我的记录",
    workspaceSub: "此设备保存的演示草稿。真实工作区将在后续阶段接入。",
    noDrafts: "还没有草稿",
    noDraftsSub: "选择一种工具，填写演示信息，就能在这里继续编辑。",
    newDraft: "选择工具创建草稿",
    edit: "继续编辑",
    draft: "本地草稿",
    walletTitle: "钱包连接尚未开放",
    walletSub:
      "现在可以浏览工具与保存本地演示草稿。真实登录和资金功能会在后续阶段接入。",
    errorTitle: "找不到这个页面",
    errorSub: "链接可能有误，或这个演示页面尚未提供。",
    home: "返回首页",
    notReady: "该页面仅为演示。请勿向任何展示信息转账。",
  },
  en: {
    tools: "Tools",
    scenarios: "Use cases",
    records: "My records",
    wallet: "Connect wallet",
    preview: "Preview",
    demo: "Demo / Preview · No real funds",
    hero: "What would you like to do today?",
    heroSub:
      "Clear ways to collect, deliver, and collaborate with Arc and USDC.",
    searchPlaceholder:
      "Search a task, such as files, classes, refunds, or splits",
    search: "Search",
    examples: "Try:",
    examplesList: ["files", "classes", "refunds", "splits"],
    results: "matching tools",
    clear: "Clear search",
    noResults: "No matching tool yet",
    noResultsSub: "Try files, classes, or splits, or browse all six tools.",
    allTools: "Browse all tools",
    seePlan: "Explore tool",
    foot: "Practical Arc / USDC tools for creators, small teams, and organizers.",
    fee: "Arc USDC is the planned asset. The person taking action pays network fees. This demo has no wallet, order, or transaction.",
    who: "Who it is for",
    how: "How it works",
    example: "Example",
    rule: "Key rules",
    faq: "Common question",
    create: "Preview creation flow",
    back: "Back to tools",
    step1: "Basics",
    step2: "Rules",
    step3: "Preview",
    wizardTitle: "Create a demo draft",
    wizardSub:
      "Describe the use, then review the rules. Drafts stay in this browser only.",
    projectName: "Project name",
    description: "Public description",
    amount: "Example amount",
    amountHelp:
      "USDC, up to 6 decimals. This does not create a payment request.",
    ruleAck: "I have read the rules and understand this is only a demo.",
    next: "Continue",
    previous: "Back",
    save: "Save local draft",
    saved: "Draft saved in this browser",
    storageError:
      "Browser storage is unavailable. This draft cannot be saved; check browser settings.",
    required:
      "Enter a project name and a positive amount with up to 6 decimals.",
    ackError: "Read and acknowledge the demo rules first.",
    review: "Preview public details",
    reviewHint:
      "This page cannot publish a link, create a business record, or send a transaction.",
    paymentPreview: "Preview public action page",
    paymentSub:
      "These are the details to check before taking action. There is no business record or funds action.",
    noOrder: "No business record",
    noWallet: "No wallet connected",
    noContract: "No business contract deployed",
    noTransaction: "No transaction sent",
    payDisabled: "is unavailable",
    amountLabel: "Amount",
    network: "Network",
    recipient: "Business contract",
    account: "Acting wallet",
    order: "Business record",
    workspaceTitle: "My records",
    workspaceSub:
      "Demo drafts saved on this device. Real workspaces come in a later stage.",
    noDrafts: "No drafts yet",
    noDraftsSub: "Pick a tool and add demo details to continue editing here.",
    newDraft: "Choose a tool",
    edit: "Continue editing",
    draft: "Local draft",
    walletTitle: "Wallet connection is unavailable",
    walletSub:
      "You can browse tools and save local demo drafts. Real sign in and funds features will come later.",
    errorTitle: "Page not found",
    errorSub: "The link may be wrong or this demo page is not available.",
    home: "Go home",
    notReady:
      "This page is a demo. Do not send funds to any displayed information.",
  },
} as const;

type Copy = typeof words.zh | typeof words.en;
type Draft = {
  toolId: string;
  name: string;
  description: string;
  amount: string;
};
const draftKey = (id: string) => `arcbox:m1b:draft:${id}`;
const defaultDraft = (tool: Tool, lang: Lang): Draft => ({
  toolId: tool.id,
  name: "",
  description: tool.scenario[lang],
  amount: "",
});
function getDraft(tool: Tool, lang: Lang): Draft {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(draftKey(tool.id)) ?? "null",
    );
    if (
      value &&
      typeof value === "object" &&
      "toolId" in value &&
      value.toolId === tool.id &&
      "name" in value &&
      typeof value.name === "string" &&
      "description" in value &&
      typeof value.description === "string" &&
      "amount" in value &&
      typeof value.amount === "string"
    )
      return value as Draft;
  } catch {
    /* storage may be blocked or stale */
  }
  return defaultDraft(tool, lang);
}
function savedDrafts(lang: Lang): Draft[] {
  return tools.flatMap((tool) => {
    try {
      return localStorage.getItem(draftKey(tool.id))
        ? [getDraft(tool, lang)]
        : [];
    } catch {
      return [];
    }
  });
}
function validAmount(value: string): boolean {
  if (value.length > 24 || !/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value))
    return false;
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0")) > 0n;
}

function LinkButton({
  children,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  );
}
function Notice({ copy, compact = false }: { copy: Copy; compact?: boolean }) {
  return (
    <span className={`demo-notice${compact ? " compact" : ""}`}>
      <InfoIcon size={16} aria-hidden="true" />
      {copy.demo}
    </span>
  );
}
function ToolIcon({ tool }: { tool: Tool }) {
  const index = tools.indexOf(tool);
  const Icon = icons[index] ?? FileTextIcon;
  return (
    <span className={`tool-icon ${tool.id}`}>
      <Icon size={34} aria-hidden="true" />
    </span>
  );
}

function Header({
  lang,
  setLang,
  copy,
  route,
  go,
}: {
  lang: Lang;
  setLang: (lang: Lang) => void;
  copy: Copy;
  route: string;
  go: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const nav = (path: string) => {
    go(path);
    setOpen(false);
  };
  return (
    <header className="site-header">
      <div className="header-inner">
        <LinkButton className="brand" onClick={() => nav("/")}>
          <img src="/assets/arcbox-mark.png" alt="" />
          ArcBox
        </LinkButton>
        <nav
          className={`primary-nav${open ? " is-open" : ""}`}
          aria-label={lang === "zh" ? "主导航" : "Main navigation"}
        >
          <LinkButton
            className={`nav-link${route === "/" || route.startsWith("/tools") ? " active" : ""}`}
            onClick={() => nav("/tools")}
          >
            {copy.tools}
          </LinkButton>
          <LinkButton className="nav-link" onClick={() => nav("/scenarios")}>
            {copy.scenarios}
          </LinkButton>
          <LinkButton
            className={`nav-link${route === "/app" ? " active" : ""}`}
            onClick={() => nav("/app")}
          >
            {copy.records}
          </LinkButton>
        </nav>
        <div className="header-actions">
          <label className="language-control">
            <GlobeIcon size={19} aria-hidden="true" />
            <span className="sr-only">Language</span>
            <select
              aria-label="Language"
              value={lang}
              onChange={(event) => setLang(event.target.value as Lang)}
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <LinkButton className="wallet-button" onClick={() => nav("/wallet")}>
            {copy.wallet}
          </LinkButton>
        </div>
        <button
          className="mobile-menu-button"
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <XIcon size={23} /> : <ListIcon size={23} />}
        </button>
      </div>
    </header>
  );
}

function Home({
  lang,
  copy,
  go,
}: {
  lang: Lang;
  copy: Copy;
  go: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const matches = tools.filter((tool) =>
    `${tool.name.zh} ${tool.name.en} ${tool.description[lang]} ${tool.keywords.zh} ${tool.keywords.en}`
      .toLowerCase()
      .includes(submitted.trim().toLowerCase()),
  );
  const search = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(query.trim());
    document
      .getElementById("tool-results")
      ?.scrollIntoView({ behavior: "smooth" });
  };
  return (
    <main className="home-page">
      <section className="home-hero">
        <h1>{copy.hero}</h1>
        <p>{copy.heroSub}</p>
        <form className="hero-search" role="search" onSubmit={search}>
          <MagnifyingGlassIcon size={24} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={copy.search}
            placeholder={copy.searchPlaceholder}
          />
          <button className="primary-button search-button" type="submit">
            {copy.search}
          </button>
        </form>
        <div className="search-examples">
          <span>{copy.examples}</span>
          {copy.examplesList.map((term) => (
            <LinkButton
              key={term}
              onClick={() => {
                setQuery(term);
                setSubmitted(term);
              }}
            >
              {term}
            </LinkButton>
          ))}
        </div>
      </section>
      <section
        className="tool-section"
        id="tool-results"
        aria-label={copy.tools}
      >
        {submitted && (
          <div className="result-line">
            <span>
              “{submitted}” · {matches.length} {copy.results}
            </span>
            <LinkButton
              onClick={() => {
                setSubmitted("");
                setQuery("");
              }}
            >
              {copy.clear}
            </LinkButton>
          </div>
        )}
        {matches.length ? (
          <div className="tool-grid">
            {matches.map((tool) => (
              <article className="tool-card" key={tool.id}>
                <div className="tool-heading">
                  <ToolIcon tool={tool} />
                  <div>
                    <h2>{tool.name[lang]}</h2>
                    {lang === "zh" && <span>{tool.shortName}</span>}
                  </div>
                </div>
                <p>{tool.description[lang]}</p>
                <div className="tool-actions">
                  <span className="preview-status">
                    <EyeIcon size={19} />
                    {copy.preview}
                  </span>
                  <LinkButton
                    className="primary-button small"
                    onClick={() => go(`/tools/${tool.id}`)}
                  >
                    {copy.seePlan}
                    <ArrowRightIcon size={17} />
                  </LinkButton>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <MagnifyingGlassIcon size={32} />
            <h2>{copy.noResults}</h2>
            <p>{copy.noResultsSub}</p>
            <LinkButton
              className="secondary-button"
              onClick={() => {
                setSubmitted("");
                setQuery("");
              }}
            >
              {copy.allTools}
            </LinkButton>
          </div>
        )}
      </section>
      <p className="home-footnote">{copy.fee}</p>
    </main>
  );
}

function Detail({
  tool,
  lang,
  copy,
  go,
}: {
  tool: Tool;
  lang: Lang;
  copy: Copy;
  go: (path: string) => void;
}) {
  return (
    <main className="interior-page">
      <div className="page-width">
        <div className="breadcrumbs">
          <LinkButton onClick={() => go("/tools")}>{copy.tools}</LinkButton>
          <span>/</span>
          <strong>{tool.name[lang]}</strong>
        </div>
        <div className="detail-hero">
          <div>
            <div className="detail-kicker">
              <ToolIcon tool={tool} />
              <span>
                {tool.shortName} · {copy.preview}
              </span>
            </div>
            <h1>{tool.name[lang]}</h1>
            <p>{tool.description[lang]}</p>
            <Notice copy={copy} compact />
            <div className="detail-actions">
              <LinkButton
                className="primary-button"
                onClick={() => go(`/create/${tool.id}`)}
              >
                {copy.create}
                <ArrowRightIcon size={18} />
              </LinkButton>
              <LinkButton className="text-button" onClick={() => go("/tools")}>
                <ArrowLeftIcon size={17} />
                {copy.back}
              </LinkButton>
            </div>
          </div>
          <div className="scenario-card">
            <span className="eyebrow">{copy.example}</span>
            <p>{tool.scenario[lang]}</p>
          </div>
        </div>
        <div className="detail-grid">
          <section className="info-card">
            <span className="eyebrow">01 / {copy.who}</span>
            <h2>{copy.who}</h2>
            <p>{tool.audience[lang]}</p>
          </section>
          <section className="info-card wide">
            <span className="eyebrow">02 / {copy.how}</span>
            <h2>{copy.how}</h2>
            <ol className="flow-list">
              {tool.steps.map((step, index) => (
                <li key={index}>
                  <span>{index + 1}</span>
                  <p>{step[lang]}</p>
                </li>
              ))}
            </ol>
          </section>
          <section className="info-card wide">
            <span className="eyebrow">03 / {copy.rule}</span>
            <h2>{copy.rule}</h2>
            <p>{tool.rule[lang]}</p>
          </section>
          <section className="info-card">
            <span className="eyebrow">04 / {copy.faq}</span>
            <h2>{copy.faq}</h2>
            <p>{tool.faq[lang]}</p>
          </section>
        </div>
        <div className="boundary-note">
          <WarningCircleIcon size={20} />
          <span>{copy.notReady}</span>
        </div>
      </div>
    </main>
  );
}

function Wizard({
  tool,
  lang,
  copy,
  go,
}: {
  tool: Tool;
  lang: Lang;
  copy: Copy;
  go: (path: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => getDraft(tool, lang));
  const [step, setStep] = useState(0);
  const [ack, setAck] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  useEffect(() => {
    setDraft(getDraft(tool, lang));
    setStep(0);
    setAck(false);
    setMessage("");
  }, [tool.id]);
  const save = (): boolean => {
    try {
      localStorage.setItem(draftKey(tool.id), JSON.stringify(draft));
      setMessage(copy.saved);
      setIsError(false);
      return true;
    } catch {
      setMessage(copy.storageError);
      setIsError(true);
      return false;
    }
  };
  const advance = () => {
    setMessage("");
    if (step === 0 && (!draft.name.trim() || !validAmount(draft.amount))) {
      setMessage(copy.required);
      setIsError(true);
      return;
    }
    if (step === 1 && !ack) {
      setMessage(copy.ackError);
      setIsError(true);
      return;
    }
    setIsError(false);
    if (step < 2) setStep(step + 1);
    else if (save()) go(`/p/demo?tool=${tool.id}`);
    window.scrollTo(0, 0);
  };
  const setField = (
    field: "name" | "description" | "amount",
    value: string,
  ) => {
    setDraft({ ...draft, [field]: value });
    setMessage("");
  };
  return (
    <main className="interior-page">
      <div className="page-width">
        <div className="breadcrumbs">
          <LinkButton onClick={() => go("/tools")}>{copy.tools}</LinkButton>
          <span>/</span>
          <LinkButton onClick={() => go(`/tools/${tool.id}`)}>
            {tool.name[lang]}
          </LinkButton>
          <span>/</span>
          <strong>{copy.create}</strong>
        </div>
        <div className="page-heading">
          <div>
            <span className="eyebrow">
              {tool.shortName} · {copy.preview}
            </span>
            <h1>{copy.wizardTitle}</h1>
            <p>{copy.wizardSub}</p>
          </div>
          <Notice copy={copy} compact />
        </div>
        <ol className="stepper" aria-label={copy.create}>
          {[copy.step1, copy.step2, copy.step3].map((label, index) => (
            <li
              key={label}
              className={
                index === step ? "current" : index < step ? "complete" : ""
              }
            >
              <button
                type="button"
                onClick={() => {
                  if (index <= step) {
                    setStep(index);
                    setMessage("");
                  }
                }}
                aria-current={index === step ? "step" : undefined}
              >
                <span>
                  {index < step ? (
                    <CheckCircleIcon size={19} weight="fill" />
                  ) : (
                    index + 1
                  )}
                </span>
                {label}
              </button>
            </li>
          ))}
        </ol>
        <div className="wizard-layout">
          <section className="wizard-main" aria-live="polite">
            {step === 0 ? (
              <div className="form-content">
                <h2>{copy.step1}</h2>
                <p>{tool.scenario[lang]}</p>
                <label>
                  {copy.projectName}
                  <input
                    value={draft.name}
                    onChange={(event) => setField("name", event.target.value)}
                    maxLength={80}
                    required
                  />
                </label>
                <label>
                  {copy.description}
                  <textarea
                    rows={4}
                    value={draft.description}
                    onChange={(event) =>
                      setField("description", event.target.value)
                    }
                    maxLength={500}
                  />
                </label>
                <label>
                  {copy.amount}
                  <div className="money-input">
                    <input
                      inputMode="decimal"
                      value={draft.amount}
                      onChange={(event) =>
                        setField("amount", event.target.value)
                      }
                      aria-describedby="amount-help"
                    />
                    <span>USDC</span>
                  </div>
                  <small id="amount-help">{copy.amountHelp}</small>
                </label>
              </div>
            ) : step === 1 ? (
              <div className="form-content">
                <h2>{copy.rule}</h2>
                <div className="rule-detail">
                  <WarningCircleIcon size={23} />
                  <p>{tool.rule[lang]}</p>
                </div>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(event) => setAck(event.target.checked)}
                  />
                  {copy.ruleAck}
                </label>
              </div>
            ) : (
              <div className="form-content">
                <h2>{copy.review}</h2>
                <p>{copy.reviewHint}</p>
                <dl className="review-list">
                  <div>
                    <dt>{copy.tools}</dt>
                    <dd>{tool.name[lang]}</dd>
                  </div>
                  <div>
                    <dt>{copy.projectName}</dt>
                    <dd>{draft.name}</dd>
                  </div>
                  <div>
                    <dt>{copy.description}</dt>
                    <dd>{draft.description}</dd>
                  </div>
                  <div>
                    <dt>{copy.amountLabel}</dt>
                    <dd>{draft.amount} USDC</dd>
                  </div>
                </dl>
                <div className="rule-detail">
                  <InfoIcon size={22} />
                  <p>{tool.rule[lang]}</p>
                </div>
              </div>
            )}
            {message && (
              <p
                className={
                  isError ? "form-message error" : "form-message success"
                }
                role={isError ? "alert" : "status"}
              >
                {message}
              </p>
            )}
            <div className="wizard-actions">
              <LinkButton
                className="secondary-button"
                onClick={() => {
                  save();
                }}
              >
                <FloppyDiskIcon size={18} />
                {copy.save}
              </LinkButton>
              <div>
                {step > 0 && (
                  <LinkButton
                    className="text-button"
                    onClick={() => {
                      setStep(step - 1);
                      setMessage("");
                    }}
                  >
                    {copy.previous}
                  </LinkButton>
                )}
                <LinkButton className="primary-button" onClick={advance}>
                  {step === 2 ? copy.paymentPreview : copy.next}
                  <ArrowRightIcon size={18} />
                </LinkButton>
              </div>
            </div>
          </section>
          <aside className="rule-summary">
            <span className="eyebrow">{copy.review}</span>
            <span className="preview-pill">{copy.preview}</span>
            <h3>{draft.name || tool.name[lang]}</h3>
            <dl>
              <div>
                <dt>{copy.tools}</dt>
                <dd>{tool.name[lang]}</dd>
              </div>
              <div>
                <dt>{copy.amountLabel}</dt>
                <dd>{draft.amount || "—"} USDC</dd>
              </div>
              <div>
                <dt>{copy.order}</dt>
                <dd>{copy.noOrder}</dd>
              </div>
            </dl>
            <p>{copy.reviewHint}</p>
          </aside>
        </div>
      </div>
    </main>
  );
}

function PaymentPreview({
  lang,
  copy,
  go,
}: {
  lang: Lang;
  copy: Copy;
  go: (path: string) => void;
}) {
  const id =
    new URLSearchParams(window.location.search).get("tool") ?? "deliver";
  const tool = byId(id) ?? tools[0]!;
  const draft = getDraft(tool, lang);
  return (
    <main className="interior-page">
      <div className="payment-width">
        <div className="page-heading">
          <div>
            <span className="eyebrow">
              {copy.preview} / {tool.shortName}
            </span>
            <h1>
              {tool.action[lang]} · {copy.preview}
            </h1>
            <p>{copy.paymentSub}</p>
          </div>
          <Notice copy={copy} compact />
        </div>
        <div className="payment-layout">
          <section className="payment-story">
            <h2>{draft.name || tool.name[lang]}</h2>
            <p>{draft.description || tool.scenario[lang]}</p>
            <div className="rule-detail">
              <InfoIcon size={22} />
              <p>{tool.rule[lang]}</p>
            </div>
          </section>
          <aside className="payment-panel">
            <span className="eyebrow">{copy.amountLabel}</span>
            <strong className="payment-amount">
              {draft.amount || "—"} <small>USDC</small>
            </strong>
            <dl className="review-list">
              <div>
                <dt>{copy.tools}</dt>
                <dd>{tool.name[lang]}</dd>
              </div>
              <div>
                <dt>{copy.order}</dt>
                <dd>{copy.noOrder}</dd>
              </div>
              <div>
                <dt>{copy.account}</dt>
                <dd>{copy.noWallet}</dd>
              </div>
              <div>
                <dt>{copy.network}</dt>
                <dd>Arc · {copy.preview}</dd>
              </div>
              <div>
                <dt>{copy.recipient}</dt>
                <dd>{copy.noContract}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="primary-button payment-disabled"
              disabled
            >
              {lang === "zh"
                ? `${tool.action.zh}${copy.payDisabled}`
                : `${tool.action.en} ${copy.payDisabled}`}
            </button>
            <p className="payment-disclaimer">{copy.noTransaction}</p>
          </aside>
        </div>
        <div className="boundary-note">
          <WarningCircleIcon size={20} />
          <span>{copy.notReady}</span>
        </div>
        <LinkButton
          className="text-button"
          onClick={() => go(`/create/${tool.id}`)}
        >
          <ArrowLeftIcon size={18} />
          {copy.previous}
        </LinkButton>
      </div>
    </main>
  );
}

function Workspace({
  lang,
  copy,
  go,
}: {
  lang: Lang;
  copy: Copy;
  go: (path: string) => void;
}) {
  const drafts = savedDrafts(lang);
  return (
    <main className="interior-page">
      <div className="page-width">
        <div className="page-heading">
          <div>
            <span className="eyebrow">
              {copy.preview} / {copy.records}
            </span>
            <h1>{copy.workspaceTitle}</h1>
            <p>{copy.workspaceSub}</p>
          </div>
          <Notice copy={copy} compact />
        </div>
        <section className="workspace-panel">
          <div className="workspace-head">
            <h2>{copy.draft}</h2>
            <LinkButton
              className="secondary-button"
              onClick={() => go("/tools")}
            >
              <PlusIcon size={18} />
              {copy.newDraft}
            </LinkButton>
          </div>
          {drafts.length ? (
            <div className="draft-list">
              {drafts.map((draft) => {
                const tool = byId(draft.toolId);
                if (!tool) return null;
                return (
                  <article key={draft.toolId}>
                    <ToolIcon tool={tool} />
                    <div>
                      <h3>{draft.name || tool.name[lang]}</h3>
                      <p>
                        {tool.name[lang]} · {copy.draft}
                      </p>
                    </div>
                    <LinkButton
                      className="text-button"
                      onClick={() => go(`/create/${tool.id}`)}
                    >
                      {copy.edit}
                      <ArrowRightIcon size={17} />
                    </LinkButton>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <FloppyDiskIcon size={35} />
              <h2>{copy.noDrafts}</h2>
              <p>{copy.noDraftsSub}</p>
              <LinkButton
                className="primary-button"
                onClick={() => go("/tools")}
              >
                {copy.newDraft}
                <ArrowRightIcon size={18} />
              </LinkButton>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function InfoPage({
  kind,
  lang,
  copy,
  go,
}: {
  kind: "wallet" | "error" | "scenarios";
  lang: Lang;
  copy: Copy;
  go: (path: string) => void;
}) {
  if (kind === "scenarios")
    return (
      <main className="interior-page">
        <div className="page-width">
          <div className="page-heading">
            <div>
              <span className="eyebrow">{copy.preview}</span>
              <h1>{copy.scenarios}</h1>
              <p>
                {lang === "zh"
                  ? "从一件具体的事开始，选择对应工具。"
                  : "Start with a concrete task and choose a tool."}
              </p>
            </div>
            <Notice copy={copy} compact />
          </div>
          <div className="scenario-list">
            {tools.map((tool) => (
              <article key={tool.id}>
                <ToolIcon tool={tool} />
                <div>
                  <h2>{tool.name[lang]}</h2>
                  <p>{tool.scenario[lang]}</p>
                </div>
                <LinkButton
                  className="text-button"
                  onClick={() => go(`/tools/${tool.id}`)}
                >
                  {copy.seePlan}
                  <ArrowRightIcon size={18} />
                </LinkButton>
              </article>
            ))}
          </div>
        </div>
      </main>
    );
  return (
    <main className="interior-page">
      <div className="page-width">
        <section className="info-state">
          <WarningCircleIcon size={40} />
          <h1>{kind === "wallet" ? copy.walletTitle : copy.errorTitle}</h1>
          <p>{kind === "wallet" ? copy.walletSub : copy.errorSub}</p>
          <Notice copy={copy} compact />
          <LinkButton className="primary-button" onClick={() => go("/")}>
            {copy.home}
            <ArrowRightIcon size={18} />
          </LinkButton>
        </section>
      </div>
    </main>
  );
}

export function App() {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const stored = localStorage.getItem("arcbox:language");
      if (stored === "zh" || stored === "en") return stored;
    } catch {
      /* use browser preference */
    }
    return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  });
  const [route, setRoute] = useState(window.location.pathname);
  const copy = words[lang];
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    try {
      localStorage.setItem("arcbox:language", lang);
    } catch {
      /* language works for current visit */
    }
  }, [lang]);
  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = (path: string) => {
    history.pushState({}, "", path);
    setRoute(window.location.pathname);
    window.scrollTo(0, 0);
  };
  const setLang = (value: Lang) => setLangState(value);
  const detailId = route.startsWith("/tools/")
    ? route.slice("/tools/".length)
    : "";
  const createId = route.startsWith("/create/")
    ? route.slice("/create/".length)
    : "";
  const detail = byId(detailId);
  const creating = byId(createId);
  return (
    <>
      <Header lang={lang} setLang={setLang} copy={copy} route={route} go={go} />
      {route === "/" || route === "/tools" ? (
        <Home lang={lang} copy={copy} go={go} />
      ) : detail ? (
        <Detail tool={detail} lang={lang} copy={copy} go={go} />
      ) : creating ? (
        <Wizard
          key={creating.id}
          tool={creating}
          lang={lang}
          copy={copy}
          go={go}
        />
      ) : route === "/p/demo" ? (
        <PaymentPreview lang={lang} copy={copy} go={go} />
      ) : route === "/app" ? (
        <Workspace lang={lang} copy={copy} go={go} />
      ) : route === "/wallet" ? (
        <InfoPage kind="wallet" lang={lang} copy={copy} go={go} />
      ) : route === "/scenarios" ? (
        <InfoPage kind="scenarios" lang={lang} copy={copy} go={go} />
      ) : (
        <InfoPage kind="error" lang={lang} copy={copy} go={go} />
      )}
      <footer className="site-footer">
        <div>
          <span>ArcBox — {copy.foot}</span>
          <Notice copy={copy} />
        </div>
        <nav aria-label="Footer">
          <LinkButton onClick={() => go("/tools")}>{copy.tools}</LinkButton>
          <LinkButton onClick={() => go("/scenarios")}>
            {copy.scenarios}
          </LinkButton>
          <LinkButton onClick={() => go("/app")}>{copy.records}</LinkButton>
        </nav>
      </footer>
    </>
  );
}
