# Creative Workshop — Policy / Architecture Reference

Status: **reference / audit**  
Updated: **2026-09-08**

> 用途：给未来维护者 / AI session 快速判断「规则在哪里、哪些值得集中、哪些不要动」，减少每次重新全仓扫描。
>
> 本文件不是重构计划，也不代表下面所有技术债都应该立即处理。

---

## 1. 先读结论

Creative Workshop 目前不需要 repo-wide reconstruction。

维护原则：

1. **稳定格式 / 协议规则写进实现代码**，不要为了“可配置”而配置化。
2. **会因为玩法、内容设计或运营决定而变化的产品规则**，才集中到 policy / config。
3. **服务器是产品规则的 Source of Truth**；Tavern 客户端尽量消费项目实际能力，而不是复制服务器的玩法规则。
4. 发现重复常量 ≠ 立即抽象。只有在它正在造成 bug、近期确定会改、或当前功能直接依赖时才重构。
5. 每次评估先区分：**可行 / 值得做 / 现在值得做**。

当前最重要的边界：

```text
稳定格式规则
└─ cloudflare/src/utils/project-content.ts
   ├─ 什么是 SillyTavern 世界书
   └─ 什么是 SillyTavern 正则

可变内容 / 玩法规则
└─ cloudflare/src/config/project-content-policy.ts
   ├─ 系统 / 角色 / 事件 => 世界书必填
   └─ 扩展 => 世界书 OR 正则至少一个
```

`project-content-policy.ts` 在本次扫描时属于 #22 本地 WIP；在进入 `origin/staging` / staging Worker 前，不要把它当成已发布行为。

---

## 2. Repo 的两个主要运行域

### A. Cloudflare / Workshop Web

```text
cloudflare/
├─ src/endpoints/     API / 审核 / 上传
├─ src/pages/home/    Workshop 网页
├─ src/utils/         DB、R2、格式识别、diff、inspection 等
├─ src/config/        可变产品规则（保持小而明确）
├─ migrations/
└─ tests/
```

负责：

- D1 / R2
- 项目创建、编辑、审核
- 世界书 / 正则上传验证
- Workshop 网页
- 产品规则最终强制执行

### B. Tavern Client

```text
src/CreativeWorkshop/
├─ bridge/
├─ services/
│  ├─ worldbook.ts
│  ├─ regex.ts
│  ├─ install-registry.ts
│  ├─ install-state.ts
│  ├─ project-fetch.ts
│  └─ diff.ts
└─ version.ts
```

负责：

- 安装 / 更新 / 卸载
- SillyTavern 世界书 / 正则操作
- 本地安装状态
- Bridge
- 客户端缓存

**不要为了共享一个 config 而强行跨 build target import。**

跨运行域的契约优先使用：

- API response
- protocol field
- contract / smoke test

而不是复制同一份玩法判断。

---

## 3. 已扫描规则：处理优先级

| 领域 | 当前状态 | 判断 | 处理时机 |
|---|---|---|---|
| 项目分类 + 内容要求 | 分类知识分布在 Worker、Web、Tavern；#22 已开始建立 policy | **值得集中** | **现在 / #21 前** |
| 世界书 / 正则文件格式 | `project-content.ts` | **保持硬编码** | 只有 ST 格式变化时 |
| 上传 / 字段 limits | 10MB、名称 100、版本名称 80、tag 数等有重复 | **可集中，但非当前优先** | 真正改限制或出现 drift 时 |
| 权限判断 | `author OR admin` 在多个 endpoint 重复 | **值得提取为权限函数** | 做 admin / creator permission 功能时 |
| 项目 lifecycle | pending / approved / rejected / draft / published 判断较分散 | **值得逐步提取** | 修改审核 / draft 流程时，不做一次性大拆 |
| 排序 | types / endpoint / DB / UI 各自维护 | **有旧债** | 做搜索 / 排序 milestone 时 |
| OAuth TTL | Worker / Web / Tavern 均为约 5 分钟 | **保持各自常量 + contract test 更合适** | 改 OAuth 时 |
| 客户端缓存 TTL | detail / worldbook source / diff 有不同 TTL | **保持各模块本地** | 性能 / stale bug 时 |
| Release 版本 | Tavern version + Web advertised version；已有 smoke test | **当前方法可接受** | release tooling 再成熟时自动生成 |
| URL / CSP / 协议安全 | inspection / CSP 中 | **不要变成玩法 config** | 安全需求变化时 |
| R2 key / D1 schema / storage key | 各模块内部 | **不要集中到“万能 config”** | 对应存储迁移时 |
| CSS / UI magic number | UI 层 | **P2 不碰** | 对应 UI 工作时 |

---

## 4. 分类 / Taxonomy：当前最需要记住的地方

当前数据库基础标签仍是：

```text
系统
扩展
角色
事件
```

其中当前产品语义里的“系统核心”仍存为 `系统`，不要仅为了改显示名称做数据库迁移。

### 当前涉及位置

#### Server policy

```text
cloudflare/src/config/project-content-policy.ts
```

这是**玩法 / 内容要求**的 Source of Truth。

#### Web 分类 metadata

```text
cloudflare/src/pages/home/utils.ts
BASE_TAG_META
BASE_TAGS
```

目前仍知道分类列表、显示名称、UI class。

#### Tavern worldbook 行为

```text
src/CreativeWorkshop/services/worldbook.ts
```

目前仍有：

```text
tags.includes('系统')
tags.includes('角色')
tags.includes('事件')
```

这意味着 #21 真正拆分类前，需要再次检查这里。

### 未来目标

Server 决定：

- 哪个分类允许什么内容
- 哪个分类能否纯正则
- 哪个分类必须有世界书

Tavern Client 尽量只关心：

- 项目现在有没有世界书
- 项目现在有没有正则
- 世界书安装目标是什么

**不要让旧客户端必须知道最新 taxonomy 才能正确安装。**

---

## 5. Stable rules：不要为了“方便”配置化

这些属于程序 / 外部格式契约，不属于 Master 的玩法旋钮。

### SillyTavern 世界书格式

位置：

```text
cloudflare/src/utils/project-content.ts
```

原则：对齐 SillyTavern 自己的导入结构。

### SillyTavern 正则格式

位置同上。

原则：对齐 SillyTavern 正则导入要求，不自创“评分器”。

### JSON 解析

Worker 使用 `JSON.parse()` 是正常且安全的数据解析；不要执行上传内容。

### URL / CSP / scheme 安全

位置主要包括：

```text
cloudflare/src/utils/project-inspection.ts
cloudflare/src/index.ts
cloudflare/src/endpoints/auth.ts
```

安全规则不要因为运营方便做成普通 editable config。

---

## 6. Limits：已发现，但现在不重构

当前值得未来检查的数字：

- 上传文件：`10MB`
- 项目名称：`100`
- 版本名称：`80`
- 创建时 tags：最多 `4`
- 项目列表默认 page size：`20`
- 项目列表最大 page size：`50`
- rejected login reminder 查询：`50`

主要位置：

```text
cloudflare/src/endpoints/projects.ts
cloudflare/src/pages/home/api.ts
cloudflare/src/pages/home/modals.ts
cloudflare/src/types.ts
cloudflare/src/endpoints/admin.ts
cloudflare/src/utils/db.ts
```

### 什么时候才值得抽 `project-limits.ts`

符合至少一项再做：

- Master 真的要改这些限制；
- 前后端数值已经 drift；
- 因重复限制造成真实 bug；
- 新功能需要新增多组共享 limits。

仅仅因为“现在重复了”不构成 #22 期间重构理由。

---

## 7. 权限：未来不要做成 boolean config

当前大量 endpoint 使用类似：

```text
project.authorId === payload.userId || payload.isAdmin
```

主要在：

```text
cloudflare/src/endpoints/projects.ts
cloudflare/src/endpoints/admin.ts
```

未来做 admin / creator permission / audit 功能时，优先形成 capability helper，例如概念：

```text
canEditProject(actor, project)
canDeleteProject(actor, project)
canModifyProjectContent(actor, project, permissionContext)
canChangeVisibility(actor, project)
canManageAdmins(actor)
```

不要做：

```text
ADMIN_CAN_EDIT=true
```

因为真实规则会涉及：

- 作者本人
- admin
- super admin
- creator 是否授权
- 修改 / 删除 / 隐藏是否属于不同权限
- 是否需要 audit log

这属于**权限模型**，不是简单 config。

---

## 8. Project lifecycle：有技术债，但不要一次性拆

大文件：

```text
cloudflare/src/endpoints/projects.ts
cloudflare/src/utils/db.ts
```

多处涉及：

```text
pending
approved
rejected
reviewTarget
draft
published
publishedProjectId
```

未来修改审核 / draft 行为时，可以逐步抽出：

```text
project-lifecycle.ts
```

但不要为了整理目录，一次把整个 endpoint / DB 拆成十几个文件。

推荐规则：

> 哪个 lifecycle 分支正在被功能修改，就只抽那个分支需要的 helper。

---

## 9. Sorting：等搜索 / 排序 milestone 再处理

当前 sort 知识分布在：

```text
cloudflare/src/types.ts
cloudflare/src/endpoints/projects.ts
cloudflare/src/utils/db.ts
cloudflare/src/pages/home/render/layout.ts
```

已知 legacy 行为：

```text
subscribes sort
```

目前 DB 已把它 fallback 到 downloads，而不是独立 public popularity metric。

所以未来重做搜索 / 排序时，应一次检查：

```text
API key
UI label
DB ORDER BY
legacy compatibility
```

不要在 #22 顺手清理。

---

## 10. OAuth / Cache / Release contract

### OAuth

当前约 5 分钟契约分布：

```text
cloudflare/src/endpoints/auth.ts
cloudflare/src/pages/home/app.ts
src/CreativeWorkshop/bridge/host.ts
```

当前一致，没有已知 bug。

未来若调整，优先加 contract test 防 drift，而不是强行跨 build target import 同一常量。

### Tavern cache

```text
src/CreativeWorkshop/services/project-fetch.ts
- project detail: 5 min
- worldbook source: 30 min

src/CreativeWorkshop/services/diff.ts
- diff: 5 min
```

Web 还有自己的较短 detail cache。

它们用途不同，不要为了“统一”强行改成同一个 TTL。

### Release version

主要位置：

```text
src/CreativeWorkshop/version.ts
cloudflare/src/pages/home/render/layout.ts
```

已有：

```text
cloudflare/tests/home-js-smoke.mjs
```

检查 advertised version 与 client version 一致。

这已经比重复字符串但无检查好很多；当前不需要重构 release system。

---

## 11. 以后遇到“要不要集中管理”时的判断门

依次问：

### Q1 — 这是外部 / 稳定契约，还是产品玩法规则？

```text
ST JSON 格式
HTTP / JWT / CSP 安全规则
DB / R2 存储结构
```

=> 通常写实现，不做可调 policy。

```text
哪些分类允许纯正则
项目内容要求
运营限制
```

=> 可以考虑 policy / config。

### Q2 — Master 近期真的会改吗？

已经排进 milestone / 当前功能马上依赖：

=> 现在整理可能值得。

只是“未来有一天可能改”：

=> 记录即可，不重构。

### Q3 — 重复是否已经造成 drift / bug？

有：

=> 收口。

没有：

=> 先评估改动面积。

### Q4 — 抽象会不会跨运行域？

如果 Cloudflare 与 Tavern 为了共享一个常量要互相依赖：

=> 优先使用 API contract / test，而不是强行共用文件。

### Q5 — 这次功能是否直接需要它？

不需要：

=> 默认延期。

---

## 12. 快速扫描索引

未来 session 不需要先全仓 grep；根据问题从这里开始：

| 问题 | 首先看 |
|---|---|
| 分类 / 纯正则规则 | `cloudflare/src/config/project-content-policy.ts` |
| 世界书 / 正则格式是否合法 | `cloudflare/src/utils/project-content.ts` |
| 创建 / 上传 / 编辑 | `cloudflare/src/endpoints/projects.ts` |
| 审核规则 | `cloudflare/src/endpoints/admin.ts` |
| D1 查询 / 生命周期持久化 | `cloudflare/src/utils/db.ts` |
| R2 文件 | `cloudflare/src/utils/r2.ts` |
| Web 创建 / 编辑 UI | `cloudflare/src/pages/home/modals.ts` |
| Web 分类 metadata | `cloudflare/src/pages/home/utils.ts` |
| Tavern 安装世界书 | `src/CreativeWorkshop/services/worldbook.ts` |
| Tavern 安装正则 | `src/CreativeWorkshop/services/regex.ts` |
| Tavern 安装状态 | `src/CreativeWorkshop/services/install-registry.ts`, `install-state.ts` |
| Tavern project/detail cache | `src/CreativeWorkshop/services/project-fetch.ts` |
| Tavern diff cache | `src/CreativeWorkshop/services/diff.ts` |
| Bridge install/update/uninstall | `src/CreativeWorkshop/bridge/host.ts` |
| Client release version | `src/CreativeWorkshop/version.ts` |
| Web advertised release | `cloudflare/src/pages/home/render/layout.ts` |
| P2 当前任务 | `docs/plans/workshop-p2.md` |
| Git / staging / production SOP | `AGENTS.md`, `docs/GIT-WORKFLOW.md` |

---

## 13. 当前 P2 的边界

本次 audit 不改变 P2 顺序。

当前方向：

```text
#22 Checkpoint 1
严格 ST 文件识别 + 中央 content policy
↓
staging 验证
↓
#22 regex-only 完整生命周期
↓
#21 taxonomy
```

不要在 #22 顺手做：

- limits 重构
- OAuth 重构
- sort cleanup
- permission architecture
- lifecycle 全面拆分
- repo-wide directory reconstruction

这些信息已经记录在这里，未来对应功能触发时再处理。

---

## 14. 本次扫描时的工作区提醒

扫描发生时主 worktree 为并行 UI 分支：

```text
feat/mobile-workshop-redesign
```

同时存在 P2 本地修改和其他并行文件。

因此未来提交 P2 时：

- 只 stage 明确的 P2 文件；
- 不使用 `git add .`；
- 不把 mobile UI / 临时 lockfile 意外混入 P2 commit；
- `origin/staging` 与 staging Worker 仍需分别验证 exact SHA。
