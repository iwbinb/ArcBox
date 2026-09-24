# M1-C / D0 · Cloudflare 无资金预览验收

日期：2026-09-24。结论：**PASS_D0_DEMO**。只部署一份可公开访问的演示网站；这不代表钱包、订单、六工具业务、测试网环境或主网已上线。

## 部署身份与范围

| 项目 | 实际结果 |
|---|---|
| 预览网址 | [arcbox-web-demo.iwbinb.workers.dev](https://arcbox-web-demo.iwbinb.workers.dev/) |
| Worker | `arcbox-web-demo`；Workers Static Assets + 独立 Demo API |
| 已部署源码 | `dev` 提交 `69985bc92471ca57fa543626af03441f9f3b6326`；公网 `/api/health` 回读一致 |
| 最终活动版本 | `f63fc663-c746-43c9-ad6d-576b3e2ecd32`，100% 流量 |
| 最终活动部署 | `22428974-1de0-4f96-9bf5-e4589beba1af` |
| 云端绑定 | 仅 `ASSETS`、`APP_ENV=demo`、`PAYMENTS_ENABLED=false`；版本详情已回读 |
| 部署渠道 | 已登录的本机 Wrangler OAuth，手动部署固定 `dev` SHA；GitHub CI 不持有 Cloudflare 密钥，也不自动部署 |

这次没有创建 D1、R2、Queues、KV、Cron、正式域名、钱包或新套餐。已有本机 OAuth 对账号的权限不局限于此 Worker，不能将“本次只操作 Demo Worker”说成凭证本身已按单资源隔离；密钥没有进入聊天、仓库或 CI。现有 Cloudflare 套餐的实际账单未读取，少量测试请求与后续访问仍按账号当前 [Workers 计费规则](https://developers.cloudflare.com/workers/platform/pricing/)计算。

## 源码与 CI

`wrangler.demo.jsonc` 与原 M0 探针配置隔离：`workers_dev=true`、无资金变量、无数据绑定；`apps/web/public/_headers` 给公开资产加 noindex、安全响应头，并只对带哈希的 JS/CSS 使用长期浏览器缓存。Worker 健康接口回传由构建产生的源码 SHA、页面哈希、`environment=demo` 和 `paymentsEnabled=false`；未知 API 返回不缓存的 JSON 404。日志开启 1% 采样，实际 tail 观察到最终版本的 `/api/health` 请求为 200，没有把请求数据保存进此报告。

[提交 `69985bc` 的 Actions 35952150492](https://github.com/iwbinb/ArcBox/actions/runs/35952150492) 四个 job 均成功：原必需回归、Arc 只读、M1-A 原型，以及新增的 M1-C Demo Worker 构建和路由检查。新增本地 Worker/Assets 测试 **6 通过、0 失败**，覆盖健康接口、拒绝资金 API、SPA 深链接、缓存、响应头和绑定边界。实际部署前还在本机完成类型检查、正式站点构建与 Demo dry-run。

## 公网验收

- `GET /api/health` 返回 HTTP 200、JSON、`Cache-Control: no-store`，固定源码 `69985bc` 与 `paymentsEnabled=false`；`POST /api/pay` 返回 HTTP 404、`{"error":"NOT_FOUND"}`，没有付款接口。
- 直接访问 `/tools/group` 返回可加载的 SPA；未知客户端路径显示双语错误页，未知 `/api/*` 不会落入 HTML。首页、Group 详情、创建/公开操作页都显示 Demo/Preview；资金按钮在真实公网浏览器中不可用。
- 公网 HTML 返回 CSP、noindex、nosniff、禁止嵌入、无引荐信息；HTML 为 `max-age=0, must-revalidate`，实际带哈希的 JS 为 `max-age=31536000, immutable`，Cloudflare 缓存观测为 HIT。规则依据 [Cloudflare Static Assets 响应头文档](https://developers.cloudflare.com/workers/static-assets/headers/)。
- 内置浏览器在 **1440 / 768 / 375 CSS px** 检查六张工具卡片，无横向溢出；实测搜索无结果恢复、工具详情、手机菜单、英文切换、无草稿、未知路由、禁用资金按钮，控制台错误 0。公网检查发现并修复手机菜单跨路由保持展开的问题，最终版本已重新验收。

| 公网截图 | 证据 |
|---|---|
| 首页 1440 px | [查看](m1-c/live-home-1440.png) |
| 首页 375 px | [查看](m1-c/live-home-375.png) |
| Group 详情及菜单修复 375 px | [查看](m1-c/live-group-375.png) |
| Group 操作页资金按钮禁用 375 px | [查看](m1-c/live-payment-375.png) |

## 回退与恢复

首次部署的上一版 `0f2bd5e3-f9b4-4f70-9002-05b566c85eb3` 对应源码 `9b39b82`。在最终版本上线后，实际使用 Wrangler 将其回退到 100% 流量；公网健康接口随即回报 `9b39b82`。随后将版本 `f63fc663-c746-43c9-ad6d-576b3e2ecd32` 恢复到 100%；公网再次回报 `69985bc`，最终活动部署为上表 ID。这证明本次 **Worker 版本**回退与恢复成功；没有数据库或链上状态可回滚。操作机制参照 [Cloudflare Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)。

## 明确保留的边界

该网址公开可浏览，但页面内容为合成演示；没有 SIWE、真实钱包签名、真实订单、文件上传/交付、Arc 业务合约、测试网或主网资金。草稿只在访问者自己的浏览器本地。D1/R2/Queues 的真实 Cloudflare 云端行为仍归后续 D1 检查点，不能因 D0 网站能打开而标记通过。

**下一子阶段：M2-A 身份、工作区与权限。**`dev → main` PR 仍由用户审查合并；合并代码不会自动变更本次 Demo Worker。
