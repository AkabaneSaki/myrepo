# Poem Workshop 文档索引

`docs/` 保存需要跨会话、跨任务长期保留的项目资料。不要把当前聊天的临时上下文当成项目真源。

## 目录约定

- `GIT-WORKFLOW.md`：当前 Git / staging / production 操作规范。
- `plans/`：仍可能执行或需要继续验证的计划。计划文件应写清状态，完成或废弃后移入 `archive/`。
- `audits/`：仍有参考价值的审计、架构与政策分析。
- `archive/`：已经结束的阶段记录、历史证据与旧会话摘要；只用于追溯，不代表当前状态。
- `archive/ai-sessions/`：从旧 `.ai-bridge` 保存下来的历史会话计划/交接。
- `archive/review-evidence/`：一次性 reviewer / 审核证据。

## 本机临时目录

- `.ai-bridge/`：**只放当前会话**的计划、handover 与自动生成上下文；会话结束后可覆盖或清理。
- `.cotel/local/`：本机长期使用但不应提交到 Git 的脚本、部署工具、配置、日志与诊断工具；已加入 `.gitignore`。

长期有效的规则、方案、历史结论不要堆回 `.ai-bridge/`。
