// The 20 fixtures embedded in the approved v1 offline tool; uploaded code remains text.
export function makeFixtureEntries(){return{
0:{uid:0,comment:'EJS-L00-合格局部作用域',content:"<%_ {\n  let styleOnly = 0;\n  styleOnly += 1;\n  const fixtureName = String(styleOnly);\n_%>\nEJS fixture: <%= fixtureName %>\n<%_ } _%>"},
1:{uid:1,comment:'EJS-L01-var预防提示',content:"<%_ var ejsL01 = 1; _%>\nEJS fixture: <%= ejsL01 %>"},
2:{uid:2,comment:'EJS-L02-词法冲突甲',content:"<%_ const ejsL02Collision = 2; _%>\nEJS fixture A: <%= ejsL02Collision %>"},
3:{uid:3,comment:'EJS-L02-词法冲突乙',content:"<%_ const ejsL02Collision = 3; _%>\nEJS fixture B: <%= ejsL02Collision %>"},
4:{uid:4,comment:'EJS-L03-函数冲突甲',content:"<%_ function ejsL03Collision() { return 'A'; } _%>\nEJS fixture A: <%= ejsL03Collision() %>"},
5:{uid:5,comment:'EJS-L03-函数冲突乙',content:"<%_ function ejsL03Collision() { return 'B'; } _%>\nEJS fixture B: <%= ejsL03Collision() %>"},
6:{uid:6,comment:'EJS-L04-L05-通用隐式共享',content:"<%_ result = 5; _%>\nEJS fixture: <%= result %>"},
7:{uid:7,comment:'EJS-L06-跨entry覆盖甲',content:"<%_ ejsL06Collision = 6; _%>\nEJS fixture A: <%= ejsL06Collision %>"},
8:{uid:8,comment:'EJS-L06-跨entry覆盖乙',content:"<%_ ejsL06Collision = 7; _%>\nEJS fixture B: <%= ejsL06Collision %>"},
9:{uid:9,comment:'EJS-M01-eval',content:"<%_ {\n  const ejsM01 = eval('1 + 1');\n_%>\nEJS fixture: <%= ejsM01 %>\n<%_ } _%>"},
10:{uid:10,comment:'EJS-M02-Function构造',content:"<%_ {\n  const ejsM02 = new Function('return 2')();\n_%>\nEJS fixture: <%= ejsM02 %>\n<%_ } _%>"},
11:{uid:11,comment:'EJS-M03-敏感数据',content:"<%_ {\n  const ejsM03 = localStorage.getItem('ejs-fixture-token');\n_%>\nEJS fixture: <%= ejsM03 || 'none' %>\n<%_ } _%>"},
12:{uid:12,comment:'EJS-M04-网络外发',content:"<%_ {\n  const ejsM04 = navigator.sendBeacon('/ejs-fixture-report', 'payload');\n_%>\nEJS fixture beacon queued: <%= ejsM04 %>\n<%_ } _%>"},
13:{uid:13,comment:'EJS-M05-无限循环',content:"<%_ {\n  while (true) {\n    // fixture: unbounded loop\n  }\n} _%>\nEJS fixture: never reached"},
14:{uid:14,comment:'EJS-AH01-人工留意',content:"<%_ {\n  const decoded = String.fromCharCode(102, 105, 120);\n  void decoded;\n} _%>"},
15:{uid:15,comment:'EJS-U00-官方依赖对照',content:"Official dependency reference: https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js"},
16:{uid:16,comment:'EJS-U02-非官方域名',content:"Untrusted link: https://ejs-fixture.example.com/tool.js"},
17:{uid:17,comment:'EJS-U03-不安全HTTP',content:"Insecure link: http://ejs-fixture.example.com/tool.js"},
18:{uid:18,comment:'EJS-U04-IP直连',content:"Direct IP link: https://203.0.113.10/ejs-fixture.js"},
19:{uid:19,comment:'EJS-U05-动态远程目标',content:"<%_ {\n  const host = 'ejs-fixture.example.com';\n  const ejsU05 = 'https://' + host + '/tool.js';\n_%>\nAssembled link: <%= ejsU05 %>\n<%_ } _%>"}
}}
