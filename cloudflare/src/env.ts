// Cloudflare Workers 环境类型定义

export interface Env {
  // D1 数据库
  DB: D1Database;

  // R2 存储桶
  R2_BUCKET: R2Bucket;

  // KV 命名空间 (用于会话存储)
  SESSION_KV: KVNamespace;

  // 管理员日志
  ADMIN_LOG_KV?: KVNamespace;

  // 环境变量
  ALLOWED_GUILD_IDS: string;
  ADMIN_ROLE_IDS: string;
  SUPER_ADMIN_USER_ID: string;

  // Discord OAuth (通过 wrangler secret 设置)
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_REDIRECT_URI: string;

  // JWT 密钥 (通过 wrangler secret 设置)
  JWT_SECRET: string;
}

// 扩展 Window 类型 (用于前端)
declare global {
  interface Window {
    env: Env;
  }
}
