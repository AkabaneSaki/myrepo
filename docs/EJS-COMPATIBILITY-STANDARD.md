# Poem Workshop EJS / 正则代码检查公约

版本：v1（草案）

## 1. 目标

这个 checker 不是“代码质量评分器”，也不是 malware analyzer。

它只处理对 Workshop 生态有明确收益的几类问题：

- EJS 项目之间的 scope / 共享状态冲突；
- 明确危险的 JavaScript 能力；
- 需要人工确认的敏感数据或主动联网；
- 不透明的远程资源目标；
- EJS 无法解析；
- 机器无法确定、但值得审核员多看一眼的可疑形状。

普通性能优化、DOM 数量、动画复杂度、listener 是否优雅清理、代码是否“漂亮”等，默认由作者自己负责。

绿色结果表示：

> **符合当前 Poem Workshop 代码检查公约。**

它不表示“绝对安全”“无 bug”或“任何环境下都绝对兼容”。

## 2. 检查对象

### 2.1 世界书 EJS

世界书 EJS 应用：

- L1–L7：Workshop EJS 组合兼容规则；
- M1–M5：共用 JavaScript 风险规则；
- U2–U5：共用外部资源规则；
- EJS-PARSE：EJS / JavaScript 编译检查；
- AH：不影响认证结果的人工审核提示。

### 2.2 SillyTavern 正则脚本

正则 JSON 的 `replaceString` 可能包含 HTML、CSS 和 `<script>` JavaScript，因此应用：

- M1–M5；
- U2–U5；
- AH。

**正则脚本不应用 L1–L7。**

L 系列是针对 EJS compilation unit / scope / 跨条目组合设计的规则，不能拿 EJS 的 scope 公约去限制普通 Regex HTML/JS。

### 2.3 静态分析边界

checker 不执行用户上传的 EJS 或正则脚本。

M 系列只看实际可执行代码区域：

- EJS 的可执行标签；
- Regex replacement 中的 `<script>`；
- Regex replacement 中明确的 inline event handler（含常见 quoted / unquoted 写法）；
- `javascript:` URL 中的可执行代码。

EJS comment、JavaScript comment、普通字符串里出现危险关键词，不应仅因关键词本身被判错。

### 2.4 一个检测引擎，两种产品输出

Workshop 不维护两套互相漂移的 checker。底层 analyzer 只保留一套规则，但输出两个不同用途的状态：

#### Upload Gate

Upload Gate 的目标是先挡掉不值得消耗人工审核时间的内容。

- `gate: reject`：存在明确阻断，例如 L 系列的 high 兼容错误、EJS parse / compile error、M1 / M2 / M5 等 Workshop 明确禁用能力；
- `gate: accept`：没有自动阻断，可以进入人工审核；
- M3 / M4 / U2–U5 / AH 这类“需要人判断”的 finding 本身不应因为机器不确定就自动把上传拒绝。

Upload Gate 不是免费 JavaScript debugger。对于安全/风险 detector，只需要告诉作者“脚本未通过 Workshop 自动规则”或“可以进入人工审核”，不公开完整 detector 细节、绕过条件或逐步调试方法。

L 系列例外。L1–L7 是公开的 Workshop EJS 组合兼容规范，不代表作者恶意，因此 uploader 应看到：

- L 错误码；
- 文件、条目；
- 行号和列号；
- 为什么不符合 Workshop 兼容规范；
- 正确修复方向；
- 可复制给 LLM 的修复提示。

LLM 修复提示必须要求：只修 L 系列兼容问题，保持原功能 / 输出 / UI / 变量含义，不通过隐藏或混淆来绕过检查，并返回修正后的完整条目。

#### Audit Center

只有通过 Upload Gate 的内容才进入正常人工审核。

- `audit: green`：没有需要 reviewer 特别留意的 warn / hint；
- `audit: yellow`：存在 M3 / M4 / U2–U5 / AH 等需要人工确认的位置；
- 若 `gate: reject`，`audit` 为 `not_applicable`，应先让作者修阻断项，不把明显不合格内容继续丢给 coworker。

Audit Center 可以显示完整 evidence：规则 ID、精确位置、代码片段、原因与审核建议，方便 coworker 或 LLM 只检查黄色位置。

### 2.5 Finding 可见性

每条 finding 同时带可见性：

- `uploader_detailed`：L1–L7、EJS-PARSE、文件读取错误；
- `uploader_generic`：M1 / M2 / M5 等明确阻断，但不把安全 detector 的完整实现细节当成作者调试教程；
- `reviewer_only`：M3 / M4 / U2–U5 / AH 等需要人工判断的详细 evidence。

这个边界服务的是审核流程，不是“安全靠隐藏”。真正的硬规则必须在 analyzer 本身成立；可见性只是避免把 Workshop 审核工具变成面向上传者的免费对抗式 debug 服务。

## 3. L 系列：EJS Workshop 组合公约

L 系列来自最初 coworker checklist 的 scope / leak 方向，并结合后续真实 ST 运行测试做了收敛。

### L1 — 顶层 `var`

顶层 `var` 不获得 Workshop 组合兼容通过。

原因不是“`var` 一定马上报错”，而是它使用函数作用域，未来与其他条目进入同一 compilation unit 时可能共享或覆盖。

函数内部真正局部的 `var` 可以只作为信息提示。

### L2 — 顶层 `let` / `const` 临时状态

只供当前条目使用的 `let` / `const` 不应裸露在 EJS 顶层。

推荐：

```ejs
<%
{
    const state = ...;
    let result = ...;
}
%>
```

`for (let ...)` / `for (const ...)` 的循环头已有块作用域，不为了消警告机械改写。

### L3 — 顶层函数 / class

普通 helper function / class 不应暴露在 EJS 顶层。

如果函数被存进顶层 `const` / `let`，至少会由 L2 处理；checker 不需要为了 rule ID 漂亮而重复报两次。

### L4 — 共享状态必须显式

裸赋值：

```js
state = {};
result = 1;
userName = "x";
```

不允许拿绿色。

显式写 `globalThis.xxx` / `window.xxx` 等共享状态时，离线 checker 至少要求人工确认。

### L5 — 共享名称不能过于通用

如果确实需要共享状态，不使用 `data`、`state`、`result`、`value` 等通用名字作为公共全局。

长期目标是在 Workshop uploader 中用稳定 project ID 校验项目专属 namespace。

### L6 — 跨条目 / 跨文件公开名称碰撞

同一次扫描中，如果多个 EJS 条目公开同名 symbol，L6 提示实际组合风险。

L6 是第二道保险，不是项目绿色通过的唯一基础。

原则是：

- 每个项目先通过 L1–L5 自己收好临时状态；
- L6 再检查当前被一起扫描的世界书组合是否已经发生公开名称碰撞；
- 形如 `globalThis.__PW_<PROJECT_ID>__` 的显式项目 namespace 若在多个条目中重复，是预期的跨条目共享接口，不再额外触发 L6 阻断；离线 checker 仍保留 L4“需确认”，因为它无法验证该 namespace 是否真的属于当前 Workshop 项目；
- 这个例外只适用于显式 global symbol。普通顶层 `const/let/var/function/class` 即使名字看起来像 `__PW_...__`，仍按 L1–L3/L6 处理。

离线 HTML 可以一次选择多个世界书进行 L6 比较。它不会在每次聊天生成时重新扫描所有世界书。

### L7 — Decorator 位置 / 结构错误

Decorator 的有效性必须先于 L1–L6 判断。

ST-Prompt-Template 只从 entry 的第一个字符开始连续解析 decorator，因此：

- `@@private` / 其他 `@@...` decorator 必须从 entry 真实第一行开始；
- decorator 前不能有前导空行、EJS、Workshop metadata、HTML 或普通文本；
- 多个 decorator 必须连续排列，中间不能插入空行或正文；
- 如果 `@@private` 位于无效位置，该 entry **不得**获得 private scope 豁免，后续 L1–L6 必须按普通公开 entry 检查。

例如：

```ejs
<%# metadata %>
@@private
<% const data = 1; %>
```

必须至少得到 L7；因为 `@@private` 实际不生效，顶层 `const` 还应继续得到 L2。

L7 是结构兼容规则，不是代码风格 lint。

## 4. M 系列：EJS / Regex 共用 JavaScript 规则

### M1 — 禁止可执行 `eval`

以下属于阻断：

```js
eval(code);
window.eval(code);
globalThis.eval(code);
(0, eval)(code);
```

以下不属于 M1：

```js
// eval("old code")
const text = "eval('example')";
```

EJS comment 内的 `eval` 也不因关键词本身失败。

### M2 — 禁止 `Function` 构造器动态创建代码

例如：

```js
Function("return 1");
new Function("return 1");
window.Function("return 1");
```

都阻断。

### M3 — 敏感或大范围浏览器数据访问

M3 不是“看到 localStorage 就报警”。

允许项目自己的明确设置，例如：

```js
localStorage.getItem("qy18_theme");
localStorage.getItem("font_size");
```

需要人工确认的例子：

- `document.cookie`；
- token / auth / password / secret / credential 等明显敏感键；
- 枚举整份 localStorage / sessionStorage；
- 与项目功能无明显关系的用户数据读取。

### M4 — 主动网络请求 / 数据外发

例如：

- `fetch(...)`
- `XMLHttpRequest`
- `WebSocket(...)`
- `EventSource(...)`
- `sendBeacon(...)`

进入人工确认。

静态图片、字体、CSS `url(...)` 等不算 M4，由 U 系列处理。

### M5 — 明显灾难性资源失控

只抓非常明确的失控形状，例如：

```js
while (true) {}
for (;;) {}
for (let i = 0; ; i++) {}
```

这里看的是 **for header 的 condition 是否为空**，不是只匹配字面上的 `for (;;)`。

Workshop 不负责一般性能优化。

listener 多、DOM 多、动画重、代码跑久了变慢，只要不是明显失控，默认由作者自己负责。

### 不再使用 M6

“代码看起来像混淆”很难可靠自动判断，而且容易把正常 Base64 / 字符码 / SVG 数据误判成违规。

因此 M6 删除。

可疑但不确定的形状改放到 **AH 人工审核提示**，不影响认证状态。

## 5. U 系列：EJS / Regex 共用外部资源规则

### U2 — 未确认的第三方域名

外部域名如果不在 Workshop 已确认来源范围内，进入人工确认。

同一次扫描里相同域名只提示一次，即使它分散在多个条目或多个文件中，也避免几十张图片刷几十条同类 warning。`//host/path` 这类 protocol-relative 外链同样按实际 host 检查。

### U3 — HTTP

真正会作为外部地址使用的 `http://` 需要确认 / 修正为 HTTPS。

`http://www.w3.org/2000/svg`、`http://www.w3.org/1999/xlink` 这类 XML namespace 不是网络下载目标，不应触发 U3。

### U4 — IP 直连

IPv4 / IPv6 直连远程资源进入人工确认。

### U5 — 远程资源目标不是固定可审阅集合

U5 不等于“URL 里出现变量就一定错”。

关键问题是：

> **审核时能不能确定所有可能被请求的远程资源集合。**

可以：

```js
const avatars = {
    happy: "https://example.com/happy.png",
    sad: "https://example.com/sad.png"
};
img.src = avatars[mood];
```

所有可能 URL 都已经完整列出来，因此不因动态选择本身触发 U5。

不可以直接绿色：

```text
https://cdn.example.com/picture/$2.png
https://cdn.example.com/picture/$<mood>.png
```

数字 capture（`$1/$2`）与 named capture（`$<name>`）都属于运行时替换，不能因为换了 capture 写法就绕过 U5。

或：

```js
"https://cdn.example.com/" + arbitraryName + ".png"
fetch(runtimeUrl)
```

因为任意输入可以改变实际远程目标。

这就是 Ellia-style “动态选择已知 URL”与 Dalian-style “动态构造未知远程路径”的区别。

## 6. AH — 人工审核提示

AH 不属于 L / M / U violation。

它的 UI 标记是：

> **? 人工留意**

它不会改变兼容字段 `certification`；但在实际审核路由里，AH 会让 `audit` 变成 `yellow`，提醒 coworker / LLM 查看该位置。

当前提示包括：

- AH1：Base64 / char-code 等编码、解码式字符串构造；
- AH2：动态 / 间接函数调用形状；
- AH3：运行时操作 EJS delimiter；
- AH4：运行时创建 `<script>`。

目的不是说“这里有错”，而是提醒 reviewer：

> “机器不能确定这里最后会做什么，请多看一眼。”

因此 AH 可以比硬规则稍微敏感，但不能被描述成违规。

## 7. O 系列：输出契约

### O1 — finding 必须可定位

每条 finding 至少包含：

- severity；
- 文件；
- 条目 / 正则脚本；
- 行号与列号；
- rule ID；
- 可见性；
- 处理建议。

### O2 — 输出顺序稳定

按文件顺序、内容顺序、行号、rule ID 稳定排序。

### O3 — 正常基线不制造 warning

正常合规项目不应因为纯风格问题产生 REVIEW。

AH 可以存在，因为它不影响认证状态。

### O4 — EJS 解析失败不得静默跳过

无法解析 / 编译的 EJS 必须明确 FAIL。

### O5 — 必须有机器可读的 Gate / Audit 状态

报告至少输出：

```json
{
  "standard": "PW-CODE-CHECK-v1",
  "gate": "accept",
  "audit": "yellow",
  "certification": "pass"
}
```

运营流程以 `gate` / `audit` 为准：

- `gate`：`accept` / `reject`；
- `audit`：`green` / `yellow` / `not_applicable`。

`certification` 暂时保留为兼容字段：

- high finding → `fail`；
- 没有 high、但有 warn → `review`；
- 只有 info / AH 或完全没有 finding → `pass`。

因此 AH-only 可以同时是：

```json
{
  "gate": "accept",
  "audit": "yellow",
  "certification": "pass"
}
```

这不是矛盾：`certification` 表示旧的规则严重度兼容语义；`audit` 表示实际要不要把内容送到 reviewer / LLM 的黄色重点检查。

## 8. 运营状态定义

### Gate REJECT

存在自动阻断项，例如：

- L 系列的 high 阻断；
- M1 / M2 / M5 等明确禁止能力；
- EJS parse / compile error；
- 文件无法读取；
- 其他明确违反当前公约的 high 问题。

这类内容先退回作者，不消耗 coworker 的正常人工审核时间。

### Gate ACCEPT + Audit GREEN

没有自动阻断，也没有 warn / AH。项目可以进入普通人工审核流程。

GREEN 仍不表示“绝对安全”或“无 bug”。

### Gate ACCEPT + Audit YELLOW

没有自动阻断，但存在需要 reviewer / LLM 特别查看的位置，例如：

- 显式共享全局；
- 敏感或大范围浏览器数据访问；
- 主动联网；
- 未确认第三方域名；
- 动态远程目标；
- AH 人工留意形状。

这些 finding 的意义是**缩小 coworker 的阅读范围**，不是自动定罪。

## 9. 性能与扫描时机

L6 不需要每次聊天生成都扫描全部世界书。

推荐：

- 上传 / 发布：扫描当前项目；
- 安装 / 更新：可把新项目与当前已安装项目做一次组合检查；
- 日常聊天运行：不扫描。

如果以后做本地长期组合索引，可以缓存每个世界书的 hash + exposed symbols，只在文件变化时重新解析。

## 10. 测试原则

测试必须同时覆盖：

1. 原 coworker fixture 的核心意图；
2. EJS comment / JS comment / string 不误报 `eval`；
3. 真正可执行 `eval` / `Function` 被阻断；
4. 项目自己的 localStorage 设置不误报 M3；
5. Regex `<script>` 与 EJS 共用 M / U；
6. Regex 不应用 L1–L7；
7. Dalian-style 动态远程路径触发 U5；
8. Qianyao / Ellia-style 有限固定 URL 集合不触发 U5；
9. W3C SVG namespace 不触发 U3；
10. AH 不改变 certification；
11. 多世界书 L6；
12. O5 的机器可读最终状态。

运行时事实与 Workshop policy 必须分开描述：某段代码“当前能跑”不代表符合 Workshop 公约；某条公约阻断也不能伪装成“当前运行时一定会报错”。
