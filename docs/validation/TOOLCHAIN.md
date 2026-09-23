# ArcBox 工具链与本地复现（M0-B）

本阶段仅建立编译与 CI 底座，不是产品网站。先按 `.node-version` 使用 Node 22.23.2；包管理器固定 pnpm 10.34.5。当前验证平台为 GitHub-hosted Ubuntu 24.04，不能据此宣称 macOS/Windows 已测试。

## 安装与检查

已有精确版本的 pnpm 时，在干净 checkout 中执行：

```bash
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm verify
```

没有 pnpm 时先执行 `node scripts/toolchain/setup-pnpm.mjs`。该脚本校验官方 pnpm tarball 的 SHA-512 后提取，打印临时安装目录的 `export PATH=...` 命令；在当前终端执行该命令再安装。GitHub Actions 中通过 `GITHUB_PATH` 自动提供下一步骤的 PATH。下载与安装需要网络，后续静态检查和 mock 单测不向 Arc 发请求。

| 命令 | 作用 | 输出 |
|---|---|---|
| `pnpm check` | 版本/锁文件/CI边界检查、脚本语法和三个 TypeScript 配置检查 | 非零退出表示失败 |
| `pnpm test:unit` | 原 27 项只读探针 fixture + 工具链/负向控制用例 | TAP |
| `pnpm test:runtime` | 生成最小静态资产并在 workerd 中运行一个启动探针 | Vitest JSON |
| `pnpm test` | 上述两组测试 | 不部署 |
| `pnpm build` | Vite 静态资产、Solidity 编译、Worker dry-run 构建 | `dist/` 和哈希清单 |
| `pnpm verify` | 清理旧报告，依次执行检查、单测、构建、运行时探针 | `reports/m0-b-report.json` |
| `pnpm probe:arc` | 单独运行 Arc 测试网只读查询 | 实际 RPC JSON，不属于离线单测 |

`dist/`、`reports/`、`node_modules/`、`.wrangler/`、秘密文件不入 Git。状态报告与复现文档在 `docs/validation/` 版本化保存。CI 日志同时输出结构化报告、准确 source SHA、锁文件 hash、构建产物 hash；日志会按仓库保留策略过期。本版本未配置 artifact 上传，不宣称可下载云端产物。

## 版本来源与升级

精确版本登记在 `toolchain.json`；直接依赖同时与 `package.json`、锁文件及实际安装版本核对。`pnpm-lock.yaml` 由固定 pnpm 生成，冻结安装不重新解析版本。Node 与 pnpm 大小版本漂移会失败，不自动放宽 engines。

Cloudflare 插件 1.2.1 与 Vitest 4.1.11 对齐 peer 约束；未采用不兼容的 Vitest 5。其供应商依赖中包含 `miniflare` 的 alpha 及 `unenv` 的 rc，不称为全部稳定版。本阶段只验证编译和运行时启动；完整绑定行为仍属 M0-C。Solidity 0.8.37 只编译 fixture、产出 ABI/bytecode，EVM paris/optimizer200/viaIRfalse；没有 Foundry/Anvil 执行、链部署或合约安全结论。

升级步骤：独立 PR，核对官方发布与 peer/engine；更新 `toolchain.json` 和直接依赖；用指定 pnpm 重新生成 lock；审查依赖和生命周期脚本差异；干净环境运行 `pnpm verify`；检查失败控制仍有效；更新报告。允许执行的依赖安装脚本仅 esbuild、workerd，不放开所有第三方 postinstall。

外部 Actions 锁定为已核验的完整提交 SHA，更新时同步 toolchain 登记并审查来源。不能把 `@v6` 等可移动 tag 当成最终锁定。

## CI 的边界

`required` 与 `arc-readonly` 是两个没有 `needs` 依赖的 job。只读 RPC 不可达时仍运行必需检查，但整体 run 可以显示失败，报告分别陈述两个结果。`required` 是 job 名称，不代表仓库分支保护已配置强制检查；本阶段不修改保护规则。

push 触发 main 和本阶段分支，PR 目标为 main；主网及生产环境不绑定，checkout 不保留凭证，最终工作流只有 contents:read。保留 workflow_dispatch 配置，但默认分支未合并此文件前不宣称手动入口已可用或已实测。

PR 执行检查的是 GitHub 合成 merge SHA；报告同时记录 PR head SHA。不得将 PR merge SHA 的结果误称为只运行了 head SHA。提交报告更新也会触发重新验证，不将旧测试结果不加说明套用到新代码。

## 一次性锁文件生成记录

为了从联网执行器无损保存生成的锁文件，临时工作流使用一次 `contents:write`，仅调用 Git blobs 创建接口并校验 Git SHA/内容 SHA-256；没有创建 commit、更新 ref、修改 main 或使用自定义/生产 Secrets。它已从最终分支树移除。常驻 CI 没有写权限；历史 run 的临时权限不被描述为只读。

生成记录：[run 35825468386](https://github.com/iwbinb/ArcBox/actions/runs/35825468386)。锁文件 62041 bytes，Git blob `5d3812fa9452d9be30caef1912ef624da84152cd`，SHA-256 `1f28da280847509789c0b82ab52bd87e27c62c60e20c0c2c7c67d9b2bb7b9b05`。

## 失败控制

负向测试验证：错误 TypeScript 类型返回 TS2322 和非零状态；故意失败的 Node 断言确实执行且返回非零；过期锁文件的 frozen/offline 安装拒绝；Solidity error JSON 不能当作编译成功。创建的临时错误文件放系统临时目录，完成后清理，不修改产品源文件来制造失败。

Node 子测试进程需移除继承的 `NODE_TEST_CONTEXT`：否则父 runner 的 child-v8 上下文会令递归发现跳过并返回零。测试要求实际 `tests 1 / fail 1 / skipped 0`，不是只接受任意报错；这是修正测试隔离，不是跳过断言。

## 下一阶段

M0-C 才验证 D1 batch/CAS/outbox、R2 对象及权限、Queues 重放与真实路由；M0-D 才验证签名/链交易。当前代码不创建 Cloudflare 资源、不上传网站、不使用钱包或资金。

官方参考：[Workers Vitest](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)、[pnpm install](https://pnpm.io/cli/install)、[Solidity 编译器](https://docs.soliditylang.org/en/latest/using-the-compiler.html)、[GitHub 工作流语法](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)。实际版本兼容性以本仓库固定版本 CI 结果为准。
