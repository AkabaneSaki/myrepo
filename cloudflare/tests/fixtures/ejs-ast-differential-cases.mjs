export const astDifferentialCases=[
  ['named-function-expression','<% const helper=function hidden() {}; %>','函数表达式的内部名称不属于 EJS 顶层公开声明，保留 helper 的 L2。'],
  ['named-class-expression','<% const helper=class Hidden {}; %>','class 表达式的内部名称不属于 EJS 顶层公开声明，保留 helper 的 L2。'],
  ['catch-binding','<% try {} catch(err) { err=1; } %>','catch 参数是实际本地绑定，不能当成裸全局赋值。'],
  ['method-binding','<% { const obj={method(x){x=1;}}; } %>','对象方法的参数属于函数作用域，不能当成裸全局赋值。'],
  ['global-shadow','<% { const window={}; window.state=1; } %>','这里 window 是本地对象，并非浏览器共享全局。'],
  ['global-update','<% window.own++; %>','更新表达式也是显式共享全局写入，按已有 L4 定义提醒审核。'],
  ['global-nested','<% window.project.own=1; %>','嵌套成员写入也修改显式共享对象，按已有 L4 定义提醒审核。'],
  ['template-call','<% { const text=`safe ${eval("1")}`; } %>','模板字符串插值里的 eval 是真正可执行表达式，旧 masking 漏检。'],
  ['html-entity','<button onclick="ev&#97;l(&quot;1&quot;)">x</button>','浏览器会解码事件属性，实际调用 eval；HTML parser 消除旧实体漏检。','regex'],
  ['inert-script','<script type="application/json">eval("1")</script>','application/json 是数据脚本，不是可执行 JavaScript，旧区域提取误报。','regex'],
  ['real-invalid','<% { const x=1 2; } %>','相邻数值缺少运算符，真实语法错误被旧括号检查漏检。'],
];
