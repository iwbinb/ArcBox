# M1-A design QA

**Source visual truth:** [selected homepage](references/home-selected.png), generated image 1487 × 1058 px. The first displayed direction was selected by the user. Written constraints: [visual system](../../docs/03-DESIGN-SYSTEM.md) and [screen specifications](../../docs/04-SCREEN-SPECIFICATIONS.md).

**Rendered implementation:** local M1-A prototype. [Homepage 1440](screenshots/home-1440.png), [creation wizard 1440](screenshots/wizard-1440.png), [public payment 1440](screenshots/payment-1440.png), [receipt state 1440](screenshots/receipt-1440.png), and [workspace 1440](screenshots/workspace-1440.png). Matching 768 and 375 screenshots for the four baseline pages, plus the 375 receipt state, are in `screenshots/`.

**Viewport and normalization:** browser CSS viewports 1440 × 1024, 768 × 1024, and 375 × 844 at devicePixelRatio 1. The in-app browser's desktop PNG content capture is 1436 × 1024 px while `window.innerWidth` and `documentElement.clientWidth` both report 1440 CSS px. For visual comparison only, the 1487 × 1058 source was scaled to 1440 × 1024 and cropped 2 px on each side to match the 1436 × 1024 captured content. No comparison was made against browser chrome or a device frame.

**Same-input comparison evidence:** [full homepage pair](screenshots/home-comparison-1440.png) places normalized reference left and rendered home right; [hero pair](screenshots/home-comparison-hero.png) and [six-tool grid pair](screenshots/home-comparison-grid.png) make text, spacing, icon, and card treatment readable at native resolution. The other three screen classes have written specifications but no prior image source, so they were checked against the selected direction and those specifications rather than claimed as pixel matches.

## Findings

No actionable P0, P1, or P2 differences remain for the M1-A visual-baseline scope.

- **Typography and content:** system Latin/CJK sans, large task-led heading, 16 px body baseline and readable Chinese tool sentences match the selected hierarchy. The prototype omits unsupported live claims and labels every money-related sample as a demo.
- **Spacing and layout:** final desktop grid starts at y=424, with row heights 238/277 px and footer start y=940; these align to the normalized source. Search, chips, tool rows and button placement retain the source's open, divider-led structure rather than adding nested cards.
- **Color and imagery:** canvas/surface/text/accent use the repository tokens. The generated standalone ArcBox mark is used as a PNG asset; standard UI symbols use one Phosphor icon family. Tool icon colors intentionally follow `docs/03-DESIGN-SYSTEM.md` where the generated mock assigned different colors. No illustration, fake chart, client logo, CSS art, or screenshot-as-page is used.
- **Contrast and touch:** normal-text foregrounds on white were darkened to at least 4.5:1; key small-text color `#617286` is about 4.9:1 on white. Decorative tool-icon colors remain above 3:1. Main mobile actions and the wallet button have at least 44 px height; focus outlines are visible. The [W3C WCAG 2.2 contrast criterion](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) is used as the target, not claimed as a full accessibility audit.
- **Responsive:** at 375, 768 and 1440 CSS px the homepage, wizard, payment and workspace had `scrollWidth == clientWidth`. Mobile home shows the first two tools in the first viewport; the payment screen shows the product and amount before the detailed rules; workspace navigation becomes a horizontal menu. No clipped controls were seen in the final captures.
- **Interactions:** browser-tested task search, empty result reset, tool detail modal, matching tool wizard route, decimal amount validation, rule confirmation, demo-only authorization/payment steps, separate receipt state, mobile menu and workspace navigation. All checked console-error lists were empty. The prototype makes no wallet/RPC calls.

## Comparison history

1. **P2 — homepage density drift:** the first render's tool rows were too tall and placed the footer too low. Measured card heights and spacing were adjusted; the final [full comparison](screenshots/home-comparison-1440.png) and [grid comparison](screenshots/home-comparison-grid.png) show the corrected rhythm.
2. **P2 — mobile payment hierarchy:** the first 375 px capture placed the amount panel below the detailed rules, so the first viewport did not show the amount. The public payment header was simplified and the amount panel moved between the product introduction and detailed rules at narrow widths. The final [mobile payment capture](screenshots/payment-375.png) shows the amount in the first viewport.
3. **P2 — small-text contrast and tap targets:** initial gray helper text measured below the ordinary-text contrast target and some mobile main buttons were under 44 px. The final palette and control sizes were corrected; the final desktop and mobile captures show the darker secondary copy and usable buttons.
4. **P1 — missing receipt layout:** the first payment interaction ended in a small status message. It now opens a full [receipt visual state](screenshots/receipt-1440.png) with amount, payer/transaction fields, rule version and next action, all explicitly marked as not a real payment. [Mobile receipt](screenshots/receipt-375.png) was also checked.

## Open questions and scope

The English selector displays a design note rather than a full translation; complete bilingual copy belongs to M1-B. The wizard's non-Deliver tools can illustrate the shared creation shell, while the payment and receipt visual sample is explicitly Deliver. Authentication, backend persistence, wallet signing, real files, contract calls, production errors and deployment are outside M1-A. No product-page usability study or independent accessibility audit was run.

**Implementation checklist:** preserve the task-led homepage, tool-purpose copy, preview status, opaque money-rule surfaces, separate authorization/payment states, explicit receipt evidence fields, responsive 375/768/1440 layouts, and demo boundary when building M1-B.

final result: passed
