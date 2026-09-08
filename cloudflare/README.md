# Creative Workshop Cloudflare Worker

这是「命定创意工坊」的 Cloudflare Worker / Web 后端工程，不是 chanfana 示例项目。

它负责：

- Workshop Web 页面；
- Discord OAuth / JWT 身份；
- 项目创建、编辑、审核与发布；
- D1 项目数据；
- R2 世界书、正则与封面文件；
- 创作者 taxonomy / 内容规则；
- 管理员审核、日志与内容 Diff；
- 对 Tavern Client 提供项目与安装所需接口。

仓库级 Git / staging / production 规则以根目录 `AGENTS.md` 与 `docs/GIT-WORKFLOW.md` 为准。

## 目录

```text
cloudflare/
├─ src/
│  ├─ config/       可变产品规则 / taxonomy
│  ├─ endpoints/    API endpoints
│  ├─ pages/home/   Workshop Web UI
│  ├─ utils/        D1 / R2 / 内容识别 / diff / inspection
│  ├─ index.ts      Worker router
│  └─ types.ts
├─ migrations/      D1 migrations
├─ tests/           smoke / contract tests
├─ scripts/         本地检查与辅助脚本
├─ schema.sql       新数据库的当前 schema
└─ wrangler*.jsonc  各环境 Wrangler 配置
```

## 当前核心规则

### 项目内容规则

Source of Truth：

```text
src/config/project-content-policy.ts
```

当前策略：

```text
系统核心 / 角色 / 事件 => 有效世界书必填
扩展                 => 有效世界书 OR 有效正则，至少一个
```

文件是否真的是支持的 SillyTavern 世界书 / 正则，不属于玩法 config；格式识别在：

```text
src/utils/project-content.ts
```

上传 endpoint 会读取实际内容并验证，管理员批准时还会再次验证待审核 payload。

### 项目分类 / 标签

Source of Truth：

```text
src/config/project-taxonomy.ts
```

Canonical fields：

```text
projectType   = 事件 | 系统核心 | 角色 | 扩展
extensionType = 规则 | 内容          # 仅扩展
facets         = 角色官方结构化标签
customTags     = 自定义标签，最多 20
displayTags    = 首页展示标签，最多 5
```

`displayTags` 必须来自当前项目已选 `facets + customTags`。官方 facets 与同名 custom tag 重复时保留官方值。

旧 `tags` 字段仍作为旧客户端兼容镜像；`系统核心` 会映射为 legacy `系统`。不要把 legacy mirror 当作新的 canonical taxonomy。

相关 migration：

```text
0008_project_taxonomy.sql
0009_project_display_tags.sql
```

`0009` 的 `display_tags` 允许 `NULL`，表示 legacy / 尚未配置，读取层可回退旧自定义标签。

### 系统检测信号

`EJS` 与「有角色立绘」来自服务端内容 inspection，不是创作者自由标签。

当前显示策略：

```text
EJS            首页卡片隐藏，详情显示
有角色立绘      首页封面 badge + 详情显示，不占 displayTags
```

## 审核流程

主要代码：

```text
src/endpoints/admin.ts
src/pages/home/modals.ts
src/pages/home/render/review-diff.ts
src/utils/project-review-diff.ts
```

当前 staging 基线支持：

- pending queue 默认最旧优先，可切最新优先；
- 按 `projectType` 服务端筛选；
- queue 不为每张卡预先读取 R2 diff；
- approve / reject 使用 `expectedRevision` 防止审核期间草稿被改；
- approve 前重新验证世界书 / 正则与项目内容 policy；
- update draft 批准后才复制内容到 published project；
- 管理员操作写入 audit log。

当前本地分支 `feature/admin-review-continuous-flow` 还有未进入 staging 的审核 UX follow-up：隐藏普通审核页面里的内部 trace metadata、增加上一个/下一个、approve/reject 后自动进入下一项，并把版本/revision/timestamp 等信息保留到管理员日志的追踪区。

最新执行状态见：

```text
docs/plans/workshop-p2.md
.ai-bridge/current-plan.md
```

## 常用开发命令

在 `cloudflare/` 下：

```text
npm install
npm run dev
npm run check:types
npm run check:home-js-smoke
npm run check:review-diff
npm run check:taxonomy-migration
```

其他脚本以 `package.json` 为准。需要本地 API server 的测试不会自行保证对应端口已启动；例如内容审批工作流测试若依赖本地服务，应先启动配套 test API。

### 当前审核 flow smoke

2026-09-08 的 `feature/admin-review-continuous-flow` 已同步更新 `check:home-js-smoke`：测试现在覆盖上一项/下一项、auto-next、管理员日志追踪区，并确认旧 version/timestamp 审核前台 helper 不再出现。当前该 smoke 已通过。

## D1

`schema.sql` 是新数据库当前结构；已存在环境通过 `migrations/` 演进。

近期关键 migration：

```text
0007_project_inspection_summary.sql
0008_project_taxonomy.sql
0009_project_display_tags.sql
```

不要为了修改一条产品规则手工直接改线上 D1。需要 schema 变化时新增 migration，并按仓库部署 SOP 让 staging 先验证。

## Staging / Production 安全边界

Git 与 Cloudflare runtime 是两套状态。

正常链路：

```text
task branch
→ tests/review
→ origin/staging
→ staging Worker exact SHA
→ Master acceptance
→ owner main
→ production Worker exact owner-main SHA
```

不要把 task branch 直接部署到正常 staging Worker，也不要把“push 到 staging branch”和“部署 staging Worker”说成同一件事。

具体 SOP：

```text
../AGENTS.md
../docs/GIT-WORKFLOW.md
```

## 进一步资料

```text
../docs/plans/workshop-p2.md
../docs/plans/workshop-persistent-session.md
../docs/audits/workshop-policy-architecture-reference-20260908.md
../docs/audits/creator-capability-audit-20260905.md
./doc/cover-image-delivery-plan.md
```
