# Creative Workshop P2 — 创作者功能与内容分类

Status: **active / staging line implemented, current review UX follow-up still local WIP**  
Updated: **2026-09-08**

GitHub milestone: `Workshop P2 — 创作者功能与内容分类`

P0 / P1 已完成并归档。本文件只记录 P2 当前真实状态、已确定规则与接下来要做的事。

## 1. 当前基线

本次文档同步时，本地 `staging` 与当前任务分支的干净基线均为：

```text
8a196e393b135b5589d21bc2f61363ceee9768ec
```

上一份 Cotel checkpoint 已确认：

```text
origin/staging = 8a196e393b135b5589d21bc2f61363ceee9768ec
staging Worker deployed Git SHA = 8a196e393b135b5589d21bc2f61363ceee9768ec
Worker Version = f6ec182c-6dfd-4363-ac4c-b603b8742e4c
production = current P2 changes not promoted in that checkpoint
```

以上是**当前本地 WIP 开始前的最后已验证 staging 状态**。本文件更新期间没有重新 push、deploy 或验证 production。

## 2. #22 纯正则项目创建 — 已进入当前 staging 代码线

当前实现不再假设所有项目都必须有世界书。

内容规则由：

```text
cloudflare/src/config/project-content-policy.ts
```

统一定义：

```text
系统核心 / 角色 / 事件 => 有效世界书必填
扩展                 => 有效世界书 OR 有效正则，至少一个
```

Worker 对世界书与正则均使用实际 JSON 内容识别，而不是只依赖文件名/MIME。审核批准前还会再次读取提交内容并执行同一内容规则。

前端创建/编辑流程已经根据项目类型调整必填提示；扩展项目允许世界书与正则二选一，纯正则项目可继续进入预览、审核与安装流程。

仍应在后续 staging 回归中覆盖完整生命周期：

- 创建；
- 编辑 / 更新；
- 上传预览；
- 审核；
- 安装；
- 删除 / 撤回；
- 纯正则项目与世界书项目的回归。

## 3. #21 分类 / 标签体系 — 已进入当前 staging 代码线

### 项目分类

Canonical project type：

```text
事件
系统核心
角色
扩展
```

旧客户端兼容层仍会把 `系统核心` 镜像为 legacy `系统` tag；不要为了显示名称迁移旧客户端协议。

### 扩展子类型

扩展项目必须选择：

```text
规则
内容
```

这用于内容分类，不替代实际内容能力判断。安装端应尽量依据项目真实拥有的世界书/正则内容工作，而不是要求旧客户端理解所有新 taxonomy。

### 角色官方标签

只有 `角色` 项目可以使用结构化官方 facets。当前分组由：

```text
cloudflare/src/config/project-taxonomy.ts
```

维护，包括：

```text
种族 / 身份 / 个性 / 外貌特征 / 组织 / 势力
```

未知官方标签由服务端拒绝，避免前端与数据库产生漂移。

### 自定义标签与首页展示标签

```text
customTags  最多 20 个
facets      结构化官方标签

displayTags
- 最多 5 个
- 只能从已选官方标签 + 自定义标签中选择
- 官方标签与同名自定义标签重复时保留官方标签
- 旧项目 display_tags = NULL 时，读取层继续回退旧自定义标签
```

Migration：

```text
0008_project_taxonomy.sql
0009_project_display_tags.sql
```

上一份 staging checkpoint 记录：0009 已应用，448 个 legacy rows 保持 `display_tags = NULL`，由读取层兼容回退，不做强行猜测迁移。

### 系统检测标签

系统检测结果不放进 creator-controlled tags：

```text
EJS            => 首页卡片隐藏，详情显示
有角色立绘      => 封面 badge + 详情显示，不占 displayTags 名额
```

## 4. 审核队列基线

当前 staging 基线已经包含：

- 默认最旧优先 FIFO，可切最新优先；
- 按项目类型进行**服务端**筛选；
- 队列小封面、类型、作者；
- `查看详情` 与队列级 `跳过`；
- 整张卡片可进入详情；
- approve / reject 只在审核详情执行；
- 不做 batch approve / reject；
- 队列不预先读取每个项目的 R2 diff，避免为了列表显示增加内容读取。

## 5. CURRENT LOCAL WIP — 连续审核 flow

当前分支：

```text
feature/admin-review-continuous-flow
```

当前代码修改尚未 commit / integrate / push / deploy：

```text
cloudflare/src/endpoints/admin.ts
cloudflare/src/pages/home/modals.ts
```

目标是让审核员连续处理队列，而不是每次 approve / reject 后被踢回首页或重新打开审核中心。

### 已写入本地代码

审核队列/详情改为**只显示审核当前需要的信息**：

- 队列移除 version / revision / timestamp 等追踪数据；
- 详情头部也移除 version / 创建时间 / 更新时间；
- 这些数据不删除，转入管理员操作日志的「追踪信息」折叠区；
- 管理员日志把 raw JSON 改为人类可读记录，并保留 target ID、draft revision、review target、published project ID、版本变化与项目时间等 trace data。

详情底部导航：

```text
← 返回队列    ← 上一个    下一个 →    [拒绝] [批准]
```

语义：

- `上一个 / 下一个` 只在当前排序 + 当前筛选后的队列中浏览；
- 它们本身不修改审核状态，等价于“先不处理这一项”；
- approve / reject 成功后，从当前队列移除该项目并自动打开下一项；
- 只有当前队列没有剩余项目时才回到审核队列；
- 不新增 batch action。

### 当前验证结果

2026-09-08 本次接手后重新执行：

```text
npm run check:types           PASS
npm run check:review-diff     PASS
npm run check:taxonomy-migration PASS
npm run check:home-js-smoke   PASS
```

`check:home-js-smoke` 已更新为新的连续审核 contract：验证上一个/下一个、auto-next、管理员日志追踪区，并确认旧 version/timestamp 审核前台 helper 不再出现。

`check:content-validation` 本次未形成有效回归结果：测试需要本地 API `127.0.0.1:8791`，当前没有启动对应服务，因 `ECONNREFUSED` 退出。

### 进入 origin/staging 前剩余工作

1. review 当前 diff，重点检查 approve / reject 后 auto-next 与 filtered queue 的索引行为；
2. 重跑必要 smoke / TypeScript / root build；
3. commit 当前审核 UX；
4. integrate into `origin/staging` → push staging；
5. deploy **exact origin/staging SHA** 到 staging Worker；
6. Master 在 staging site 实际连续审核几项后再决定是否进入 owner PR。

已完成：旧 smoke 断言已更新；管理员日志已有专用 CSS；移动端底部操作区把「返回队列」独占一行，上一项/下一项与拒绝/批准各成一行；上一项/下一项到队列边界时禁用，不循环绕回。

## 6. 与当前审核 UX 分开的工作

Master 后续提出的角色标签/标签内容继续优化，**不要混进 `admin-review-continuous-flow` 这一个审核 UX commit**。

原因不是功能不能共存，而是两者验收面不同：

```text
审核 flow => reviewer UX / audit log / navigation
标签调整  => creator taxonomy / frontend selection / display behavior
```

保持独立 commit 可以让 staging 回归、撤回和 PR review 更清楚。

## 7. Deferred / 后续 backlog

### #20 作者估算长度 / EJS 实测指标

继续延期到后续 milestone，并与 EJS 实测脚本一起设计。不要先单独增加 `authorEstimatedLength` 或预埋未来统计字段。

未来统一设计时再区分：

- 作者自行提供的估算；
- 脚本采样得到的实际 token / 渲染长度；
- 项目级汇总与条目级测量；
- 测量对应版本、采样方法、样本数与统计口径。

### 其他 backlog

- no-op edit guard；
- partial-upload cleanup / rollback；
- author/admin 私有测试读取不应增加 public download counter；
- metadata validation parity；
- explicit remove-cover；
- 明确「隐藏」是 unlisted 还是真正 private；
- persistent Workshop session：`docs/plans/workshop-persistent-session.md`；
- public search / sort / date filter 扩展；
- 真正的 pre-submit draft state。

## 8. 当前原则

P2 不需要 repo-wide reconstruction。

当前优先级是：

```text
先把正在改的审核 flow 做完整
→ 测试与 staging 验收
→ 再进入下一项独立功能
```

不要因为 taxonomy / lifecycle 已经变复杂，就顺手把整个 endpoint、DB 或 frontend 重构一遍。
