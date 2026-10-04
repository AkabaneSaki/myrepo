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

## 差异审计结果

2026-10-04 19:29 UTC 从 staging site 公开接口取得 442 个已批准且公开的项目、506 个文件。此范围不包含私有或待审核项目，原始条目仅保存在忽略提交的 `.ai-bridge/ejs-checker-v2/`。每个输入都有 SHA256；取得样本的过程只读，不安装、上传或修改项目。

分组口径为 442 个公开项目、22 组冻结契约、1 组含 20 个内嵌夹具、11 组 AST 回归、5 组故意损坏代码及 1 组含 55 条 EJS 的世界书，共 482 组输入。15 组检查结果发生变化，8 组门禁或审核状态发生变化，全部已有逐项原因；没有未解释的差异。真实公开项目中有 4 个项目的检查结果变化，只有阿尔娜项目从可提交变成语法阻断。

| 样本 | 差异与依据 |
| --- | --- |
| 55 条 EJS 世界书 | 解析错误为 0；双子入口的多行 `const a` 是合法本地绑定，消除旧 L4 误报；仍检出 L1×4、L2×12。 |
| 炼金大公 | `window.top` 下的共享写入补 L4 审核提示；两处事件属性双引号提前闭合，补 JS-PARSE。原有公开声明阻断保留。 |
| 言灵改稿笺 | `pair[0].call(...)` 是间接调用，补 AH2 提示；不改变门禁。 |
| 书海迷宫 | 旧扫描把 `fetch(new URL(...))` 的 `new` 当成变量；该调用的路径与基址均固定，消除这条 U5 误报。其他既有网络审核提示保留。 |
| 阿尔娜 | 对象的前一属性值之后缺少逗号，定位到原文第 100 行第 11 列；旧括号检查漏检。 |
| 针对性 AST 样本 | 修正命名表达式的内部作用域、本地 window 遮蔽；补共享更新/嵌套写、HTML 实体解码后的 eval；数据脚本不按可执行代码处理。 |
| 故意损坏样本 | 真正非法 JavaScript 由解析器拒绝；解析失败时不臆造完整 L 规则结果。可靠的循环头 token 仍能保留 M5 证据。 |

完整机器报告：[ejs-checker-v2-differential.json](ejs-checker-v2-differential.json)。测试决策绑定输入及发现签名，后续若发现变化或样本变化，必须重新审计；这些决策不进入线上检查器，不按条目名称放行。

审计同时修复 HTML 重复属性的定位问题：浏览器及 parse5 使用第一项属性值，但 parse5 的定位记录指向最后一项。现在从已解析的开始标签定位第一次属性拼写，并验证解码后的值一致；这项修复有独立回归测试。

## 模块及许可

`source-units.mjs` 只提取模板和 HTML 的代码区域并映射原文；`syntax.mjs` 使用 Acorn 解析；`scope.mjs` 建立绑定，`policy.mjs` 判断 L 规则，`capabilities.mjs` 判断共用能力规则；`api-catalogue.mjs` 提供 API 提示；`report.mjs` 保留门禁及输出边界，`index.mjs` 组合检查流程。

固定依赖：Acorn 8.18.0（MIT）、parse5 8.0.1（MIT）、entities 8.1.0（BSD-2-Clause）；esbuild 0.28.1（MIT）只用于构建。EJS 3.1.9 tokenizer 的 Apache-2.0 许可和来源保留在 vendor；ST-Prompt-Template 只用作行为参考，没有复制其 AGPL 实现。API 依据固定源码版本 `d6f520d149aba146305b0b781ddd691d449c28d2`。

HTML 内由 EJS 运行结果生成的脚本无法在不执行模板的前提下确定最终语法。检查器分析实际 EJS，以及完全静态的 HTML 代码区域，不把未知输出猜成作者语法错误。检查结果也不承诺发现所有动态行为。

## 界面验收

离线工具由 `node cloudflare/scripts/build-ejs-offline.mjs` 构建共用 v2 浏览器包，附完整第三方许可，不再保留第二套语法判断。桌面和手机共 100 项浏览器验收通过（原 98 项及新增 2 项）；上传卡片、复制单条/全部提示、Markdown 导出、审核结果与检查版本均已验证，新增流程没有浏览器脚本错误。Browser plugin 未提供，本轮使用项目现有 Playwright Chromium；截图保存在测试输出目录。

旧浏览器测试的三个预期已迁移：真实解析位置指向原文第 19 列；`javascript :` 的空格使浏览器将其识别为普通路径，真正带制表符的协议仍检出；重复扫描通过共用引擎的公开入口验证，不保留旧内部函数。检查规则版本仍为 `PW-CODE-CHECK-v1`，独立的检查引擎版本为 `v2`。
