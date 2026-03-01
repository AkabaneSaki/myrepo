# 命定之诗与黄昏之歌

SillyTavern 扩展仓库，为角色卡「命定之诗与黄昏之歌」提供配套的世界书内容及美化工具。

## 功能模块

### 命定创意工坊 (CreativeWorkshop)

图形化界面工具，用于浏览和同步各类世界书内容：

- **系统核心** - 同步游戏系统配置
- **角色世界书** - 批量部署角色设定
- **种族世界书** - 批量部署种族设定

### 自适应正则美化 (AutoDialogueBeautifier)

自动检测对话内容并应用正则替换规则，实时美化 AI 输出。

## 目录结构

```
myrepo/
├── AutoDialogueBeautifier/     # 自适应正则美化模块
├── CreativeWorkshop/          # 命定创意工坊
├── character/                 # 角色世界书
├── system/                    # 系统核心
├── race/                      # 种族世界书
└── picture/                   # 角色表情图片
```

## 安装方式

### 方式一：SillyTavern 用户脚本安装

1. 打开 SillyTavern 的 **脚本** 标签
2. 点击 **安装新脚本**
3. 粘贴以下 URL：
   - 创意工坊：`https://cdn.jsdelivr.net/gh/AkabaneSaki/myrepo@main/CreativeWorkshop/index.js`
   - 自适应正则：`https://cdn.jsdelivr.net/gh/AkabaneSaki/myrepo@main/AutoDialogueBeautifier/index.js`

### 方式二：手动安装

1. 将脚本文件放入 SillyTavern 的 `scripts` 目录
2. 重启 SillyTavern

## 使用指南

### 创意工坊

1. 点击 **命定创意工坊** 按钮
2. 选择内容类型
3. 选择要添加的内容
4. 点击 **应用选中项**

### 自适应正则

安装后自动启用。

## 许可证

MIT License
