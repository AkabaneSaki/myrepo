# Poem Workshop 文档索引

`docs/` 保存需要跨会话、跨任务长期保留的项目资料。不要把当前聊天的临时上下文当成项目真源。

## 目录约定

- `GIT-WORKFLOW.md`：当前 Git / staging / production 操作规范。
- `plans/`：仍可能执行或需要继续验证的计划。计划文件应写清状态，完成或废弃后移入 `archive/`。
- `audits/`：仍有参考价值的审计、架构与政策分析。
- `archive/`：已经结束的阶段记录、历史证据与旧会话摘要；只用于追溯，不代表当前状态。
- `archive/ai-sessions/`：从旧 `.ai-bridge` 保存下来的历史会话计划/交接。
- `archive/review-evidence/`：一次性 reviewer / 审核证据。

## 当前长期文档

- `GIT-WORKFLOW.md`：Git / staging / production 的长期操作 SOP，并包含 owner/fork issue tracker 分工。
- `WORKSHOP-RELEASE-SOP.md`：Creative Workshop client SemVer 与 Worker/web release identity 的发布规则。
- `CONFIG-HARDCODE-AUDIT.md`：哪些值应进入配置、哪些应留在实现代码的长期判断依据。
- `audits/workshop-architecture.md`：长期维护的 Workshop 架构 / policy 参考，不记录当前 branch、SHA 或临时 WIP。
- `plans/workshop-persistent-session.md`：设计已确定、尚未实现的 iframe/session 生命周期方案。
- `plans/cover-image-delivery.md`：当前 wsrv fallback 与长期 public asset delivery 迁移方案，实施前需重新验证基础设施选择。

## 本机临时目录

- `.ai-bridge/`：**只放当前会话**的计划、handover 与自动生成上下文；会话结束后可覆盖或清理。
- `.cotel/local/`：本机长期使用但不应提交到 Git 的脚本、部署工具、配置、日志与诊断工具；已加入 `.gitignore`。

长期有效的规则、方案、历史结论不要堆回 `.ai-bridge/`。

## 维护规则

- README / audit 不记录“当前 task branch、当前 SHA、尚未 deploy”之类会快速过期的 session 状态；这类信息放 GitHub issue / PR 或当前 handoff。
- `plans/` 只保留仍有效、尚未完成的方案；完成、取消或被替代后移入 `archive/`。
- `archive/` 只用于历史追溯，不能作为当前实现或部署状态的依据。
- migration、script、config 等容易变化的清单优先链接实际目录 / `package.json` / 配置文件，不在 README 复制第二份“当前列表”。
- 判断实际行为时，以当前代码、配置、schema / migrations 和测试为准。
