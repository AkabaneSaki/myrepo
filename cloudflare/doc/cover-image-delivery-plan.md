# 封面图交付方案

## 当前止血方案

- 前端封面优先使用 `wsrv.nl` 代理 URL。
- 如果 `wsrv` 加载失败，前端再切换到原始 `/api/files/.../cover.*`。
- 两者都失败时，回退到内置 SVG 占位图。

实现效果：

- 常见情况下，浏览器命中 wsrv 缓存，不再直接请求 Worker。
- 如果 wsrv 不可用或拉取失败，前端会显式切换到当前直连封面 URL。
- 不改现有 R2/Worker 封面存储结构，风险最小。

## 为什么只是临时方案

- wsrv 是第三方服务，可用性和限流不受我们控制。
- wsrv 首次缓存 miss 时，仍会回源到 `/api/files/*`，Worker 仍会被打到。
- 用户请求会额外经过第三方。

## 理想方案

### 方案 A：公开 R2 自定义域名

- 给公开资源单独配置 R2 public/custom domain。
- 封面直接返回 `https://assets.example.com/...`。
- 下载文件继续走 `/api/files/*`，封面不再经过 Worker。

优点：

- 彻底移除封面图片的 Worker invocation。
- 直接使用 Cloudflare Cache，链路最短。

缺点：

- 需要 Cloudflare 侧配置。
- 如果复用当前私有 bucket，需要谨慎处理对象公开范围。

### 方案 B：单独 public bucket

- 新建一个只放封面的 public bucket。
- 私有项目文件继续留在当前 bucket。

这是最稳妥的长期方案。

## 推荐迁移顺序

1. 现在先保留 wsrv 止血。
2. 后续新增 public bucket 或 public custom domain。
3. Worker 列表接口返回公开封面 URL。
4. 下线 wsrv 代理逻辑。

## 额外建议

- 当前封面版本参数优先使用 `updatedAt`，会在项目任意更新时导致封面缓存失效。
- 后续可改为只在封面变更时更新版本，例如单独的 `coverUpdatedAt`。
