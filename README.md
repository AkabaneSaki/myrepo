# 命定之诗与黄昏之歌

这是一个**专门为角色卡「命定之诗与黄昏之歌」服务**的 SillyTavern 扩展仓库，核心目标不是提供通用型插件集合，而是围绕该角色卡的使用体验，统一提供：

- 面向专属内容分发与同步的 **命定创意工坊**
- 面向角色对话表现优化的 **自适应正则美化**
- 面向角色演出与展示的表情、立绘等素材资源

仓库同时提供一套基于 Cloudflare Workers 的创意工坊后端，用于支撑与该角色卡生态相关的项目上传、审核、展示、点赞、订阅与鉴权等能力。

## 项目概览

### 1. 命定创意工坊

前端脚本入口位于 [`src/CreativeWorkshop/index.ts`](src/CreativeWorkshop/index.ts)，用于在 SillyTavern 内打开图形化工坊界面，并通过 iframe 连接远端服务。

核心用途包括：

- 浏览社区共享内容
- 拉取并同步世界书或相关项目资源
- 在接入审核机制的前提下进行内容上传与分发
- 通过自定义变量切换工坊服务地址，默认接入 [`src/CreativeWorkshop/services/config.ts`](src/CreativeWorkshop/services/config.ts) 中定义的 Cloudflare Worker 地址

### 2. 自适应正则美化

脚本入口位于 [`src/AutoDialogueBeautifier/index.ts`](src/AutoDialogueBeautifier/index.ts)。该模块会在 AI 输出完成后自动检测消息内容，根据命中的规则动态注册对应正则，从而实现对话格式、文本表现和展示层效果的自动美化。

特性包括：

- 支持从 CDN 拉取远程 [`regex.json`](src/AutoDialogueBeautifier/index.ts:8)
- 支持多 CDN 回退，提升加载成功率
- 自动检测消息内容并匹配所需规则
- 使用缓存与防抖机制降低重复计算和循环触发风险
- 根据聊天变量自动维护当前激活的正则列表

### 3. Cloudflare 创意工坊后端

后端代码位于 [`cloudflare/src/index.ts`](cloudflare/src/index.ts)，技术栈基于 Hono 与 chanfana，负责提供创意工坊的 Web 页面、OpenAPI 文档与接口服务。

目前可从代码结构中确认的能力包括：

- Discord OAuth 登录与登录状态查询
- 项目列表、详情、创建、更新、删除
- 项目文件、封面与正则文件上传
- 点赞、订阅、可见性切换
- 管理员审核、项目管理、管理员列表与日志查询
- 基于 D1 的项目数据管理，表结构定义见 [`cloudflare/schema.sql`](cloudflare/schema.sql)

## 仓库结构

```text
myrepo/
├─ README.md
├─ src/
│  ├─ AutoDialogueBeautifier/    # 自适应正则脚本源码
│  └─ CreativeWorkshop/          # 创意工坊脚本源码与桥接逻辑
├─ cloudflare/
│  ├─ src/                       # Worker 路由、页面和业务逻辑
│  ├─ schema.sql                 # D1 数据库结构
│  └─ package.json               # Worker 依赖与脚本
└─ picture/                      # 角色立绘、表情与 GIF 资源
```

## 主要技术组成

### 客户端脚本

- TypeScript
- SillyTavern 脚本环境
- iframe + bridge 通信
- 正则驱动的对话后处理机制

### 后端服务

- Cloudflare Workers
- Hono
- chanfana / OpenAPI 3.1
- Cloudflare D1

## 安装与接入

### SillyTavern 用户脚本安装

如果你已经构建并发布了对应脚本文件，可以在 SillyTavern 的脚本安装界面直接使用 CDN 地址接入：

- 创意工坊：`https://cdn.jsdelivr.net/gh/AkabaneSaki/myrepo@main/CreativeWorkshop/index.js`
- 自适应正则：`https://cdn.jsdelivr.net/gh/AkabaneSaki/myrepo@main/AutoDialogueBeautifier/index.js`

### 手动安装

1. 将构建后的脚本文件放入 SillyTavern 的脚本目录
2. 重启或刷新 SillyTavern
3. 确认脚本已被加载

> 当前仓库内主要保存的是源码与后端工程。如果要直接用于生产环境，通常还需要你自己的构建与发布流程。

## 开发说明

### 本地查看 Cloudflare Worker

[`cloudflare/package.json`](cloudflare/package.json) 中定义了以下常用命令：

- `npm run dev`：启动本地 Worker 开发环境
- `npm run deploy`：部署到 Cloudflare Workers
- `npm run cf-typegen`：生成 Wrangler 类型

### 数据库初始化

D1 的基础表结构定义在 [`cloudflare/schema.sql`](cloudflare/schema.sql)，包含：

- `users`
- `projects`
- `project_likes`
- `project_subscribes`
- `admins`

这些表用于支撑用户体系、项目管理、互动行为与后台审核功能。

## 使用说明

### 命定创意工坊

1. 在 SillyTavern 中加载脚本
2. 首次打开时阅读并确认免责声明
3. 进入工坊界面后浏览、筛选并导入内容
4. 如有需要，可通过脚本变量覆盖默认 Worker 地址

### 自适应正则美化

1. 加载脚本后自动运行
2. 脚本会从远端拉取规则集
3. 当 AI 输出命中特定格式时，自动激活对应正则规则
4. 规则状态会随聊天上下文动态同步

## 素材资源说明

[`picture/`](picture/) 目录下收录了多个角色或形象的表情资源，包括静态 PNG 与动态 GIF，可作为角色卡、世界书、立绘切换或前端展示素材使用。

## 适用场景

本仓库适合以下用途：

- 为 SillyTavern 角色卡提供配套世界书与资源分发能力
- 构建一个可审核、可分享的创意工坊系统
- 为 AI 输出增加自动格式修饰与表现增强能力
- 统一管理角色相关图片资产与扩展脚本

## 免责声明

- 本仓库是专门为角色卡「命定之诗与黄昏之歌」服务的项目。
- [`picture/`](picture/) 目录中的部分素材可能来源于网络收集或第三方公开资源，并非全部为仓库维护者原创。
- 对于非原创、非独占授权或权属不明确的第三方素材，其著作权、邻接权及其他相关权利归原作者或原权利人所有。
- 除非对应文件、目录或说明文字中另有明确声明，这些第三方素材**不自动纳入**根目录 [`LICENSE`](LICENSE) 的统一授权范围。
- 若你计划转载、改编、重新分发或在其他项目中使用 [`picture/`](picture/) 目录中的素材，请先自行确认原始来源与授权条件。
- 如相关权利人认为仓库内素材存在侵权、误用或授权说明不准确的情况，可联系仓库维护者处理。

## 许可证

本仓库当前采用 [`CC BY-NC-SA 4.0`](LICENSE)（知识共享署名-非商业性使用-相同方式共享 4.0 国际）对**仓库维护者有权授权的原创内容**进行授权。

这意味着你可以：

- 在**非商业**前提下复制、传播与转载本仓库中的原创内容
- 在**非商业**前提下修改、改编和二次创作原创内容
- 继续分发衍生作品，但必须保持署名，并采用相同协议共享

这也意味着你**不可以**：

- 将本仓库原创内容用于任何形式的商业用途
- 将本仓库原创内容打包售卖、付费分发，或用于盈利性服务
- 在再分发或改编后改用更宽松或更封闭的授权方式

需要特别注意：

- 根目录 [`LICENSE`](LICENSE) 主要适用于仓库中的原创脚本、原创文档及仓库维护者明确拥有授权权利的内容
- 对于 [`picture/`](picture/) 目录中的第三方素材，以及你所调用的第三方项目接口、平台接口或服务能力，本仓库**不当然取得其再授权权**
- 使用者在二次使用相关第三方内容或第三方服务接口时，应自行遵守其原始许可协议、接口条款和平台规则

具体条款以根目录 [`LICENSE`](LICENSE) 文件及本节免责声明为准。
