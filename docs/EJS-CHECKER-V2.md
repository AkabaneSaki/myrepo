# EJS Checker v2 实施与验收记录

基线：`origin/staging` 的 `4e08cf6505b7c92ed24e38a2156c6fe0de86a5eb`。v1 的只读快照位于 `cloudflare/tests/fixtures/ejs-checker-v1.mjs`，仅供差异测试，线上不在两个引擎之间回退。

## 冻结的规则

规则定义继续以 [EJS 检查公约](EJS-COMPATIBILITY-STANDARD.md) 为准。L1：公共函数作用域的 var 阻断，普通块和循环不能隔离 var；函数内及有效 private 的 var 仅提示。L2：公共顶层 let/const 阻断，每个声明一次，块和循环头不阻断。L3：公共顶层函数/class 阻断，赋值给顶层 let/const 的函数只由 L2 处理。L4：无本地绑定的赋值、更新、解构或循环目标阻断；显式全局写入需要审核。L5：沿用现有通用全局名集合。L6：同一次扫描全部世界书聚合公开名称，只有全部为显式全局的 `__PW_...__` 共享名称豁免。L7：有效 decorator 必须从原文第一个字符开始连续排列；无效 private 不获得隔离。

M1/M2/M5 阻断；M3/M4、U2–U5 为审核警告；AH1–AH4 为人工提示。正则的可执行区域应用共用规则，始终不应用 EJS 的 L 规则。字符串和注释中的危险关键词不能作为可执行证据。

存在 high：gate=reject、audit=not_applicable、certification=fail。存在 warn 且无 high：accept/yellow/review。只有 hint：accept/yellow/pass。没有 warn/hint/high：accept/green/pass。L/EJS-PARSE/FILE 对上传者显示详情，M 阻断转为通用 SCRIPT-RISK，审核警告及提示仅供审核员。

## 实现顺序与边界

1. 冻结 v1 快照、规则、测试及门禁输出。
2. 用 Apache-2.0 的 EJS 3.1.9 tokenizer 与固定版本 MIT Acorn 建立只解析的语法引擎；验证 Node、TypeScript、两个 Worker dry-run 和本地 Worker 运行。
3. 将语法判断接到 v2，保留原文位置；源码错误与检查器内部失败分别报告。
4. 用 AST（JavaScript 的语法结构树）及实际作用域替换 L1–L6 的字符串推测，保留 decorator 结构检查。
5. 根据固定 ST-Prompt-Template 源码版本建立 API 使用说明和独立提示，不把 API 问题称为语法错误，也不把可扩展上下文当成封闭白名单。
6. 审计原夹具、L 回归、故意损坏样本、55 条 EJS 世界书及当前 staging 项目；每项差异必须说明原因。
7. 保留选择文件即检查、条目卡片、复制给 LLM、Markdown 导出及审核中心；报告带引擎与解析兼容版本。
8. 验收后切换 staging 门禁，推送 origin/staging 后由既有部署助手部署确切提交。v1 快照暂时保留供复核，production 不变。

检查器不执行上传代码，不调用模板 render/compile，不使用 eval 或 Function 构造器；不触发上传代码的变量读写、网络或 DOM 行为。内部失败关闭门禁，但提示稍后重试，不归咎作者语法。

## 已锁定的真实回归样本

Master 提供的 `命定之诗与黄昏之歌v4.3.json`：549 个条目，55 个含 EJS。SHA256：`12fa41ced8bbae2ff761e713d33b9881f181fa797bf158bd67937ece0a4b1b97`。回归要求 EJS-PARSE=0；真实 L 问题继续检出。测试只读取该文件，不把重复的 originalData 当成新条目。

原独立 coworker 夹具尚未定位；已存在于离线工具的 20 个夹具及其回归测试属于可取得的基线。不能把它们冒称为取得了独立原文件。
