import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../types';
import { discordAuth } from '../utils/auth';
import { userDb } from '../utils/db';
import { jwt } from '../utils/jwt';

// 成功的 HTML 页面 - 仅通过安全 postMessage 传递 token
const successHtml = (token: string, userData: object, allowedOrigin: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>登录成功</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #fff; }
    .container { text-align: center; padding: 40px; max-width: 400px; }
    .success { color: #10b981; font-size: 1.5rem; margin-bottom: 20px; }
    .info { color: #94a3b8; margin-bottom: 20px; font-size: 0.9rem; }
    .btn { background: #10b981; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 1rem; margin-top: 20px; }
    .btn:hover { background: #059669; }
  </style>
</head>
<body>
  <div class="container">
    <div class="success">✓ 登录成功！</div>
    <p class="info">您已成功通过 Discord 授权。<br>正在通知主窗口...</p>
    <p class="info" style="font-size: 0.8rem;">如果未自动关闭，请返回主窗口重新尝试登录。</p>
    <script>
      const token = ${JSON.stringify(token)};
      const userData = ${JSON.stringify(userData)};
      const allowedOrigin = ${JSON.stringify(allowedOrigin)};

      function notifyOpener() {
        if (!window.opener) {
          return false;
        }

        try {
          window.opener.postMessage({ type: 'oauth-success', token, user: userData }, allowedOrigin);
          return true;
        } catch (e) {
          console.error('postMessage 发送失败:', e);
          return false;
        }
      }

      const delivered = notifyOpener();
      setTimeout(() => {
        if (delivered) {
          window.close();
        }
      }, 800);
    </script>
  </div>
</body>
</html>`;

// 失败的 HTML 页面
const errorHtml = (message: string, allowedOrigin?: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>登录失败</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #fff; }
    .container { text-align: center; padding: 40px; }
    .error { color: #ef4444; font-size: 1.2rem; margin-bottom: 20px; }
    .btn { background: #6366f1; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 1rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="error">${message}</div>
    <button class="btn" onclick="window.close()">关闭</button>
    <script>
      const allowedOrigin = ${JSON.stringify(allowedOrigin || '')};
      if (window.opener && allowedOrigin) {
        window.opener.postMessage({ type: 'oauth-error', message: ${JSON.stringify(message)} }, allowedOrigin);
      }
      setTimeout(() => window.close(), 3000);
    </script>
  </div>
</body>
</html>`;

/**
 * 获取 OAuth 授权 URL
 */
export class AuthLogin extends OpenAPIRoute {
  async handle(c: AppContext) {
    const state = crypto.randomUUID();
    const origin = c.req.header('origin') || new URL(c.req.url).origin;

    await c.env.SESSION_KV.put(
      'oauth_state_' + state,
      JSON.stringify({
        createdAt: Date.now(),
        origin,
      }),
      { expirationTtl: 300 },
    );

    const url = discordAuth.getAuthorizationUrl(c, state);
    return { url, state };
  }
}

/**
 * OAuth 回调处理
 */
export class AuthCallback extends OpenAPIRoute {
  schema = {
    tags: ['Auth'],
    summary: 'Handle Discord OAuth Callback',
    request: {
      query: z.object({
        code: z.string(),
        state: z.string().optional(),
        format: z.string().optional(),
      }),
    },
  };

  async handle(c: AppContext) {
    const { code, state, format } = c.req.query();
    const isJsonRequest = format === 'json';

    try {
      if (!state) {
        throw new Error('缺少 OAuth state');
      }

      const stateKey = 'oauth_state_' + state;
      const stateData = await c.env.SESSION_KV.get(stateKey);
      if (!stateData) {
        throw new Error('OAuth state 无效或已过期');
      }

      let parsedState: { createdAt?: number; origin?: string } = {};
      try {
        parsedState = JSON.parse(stateData);
      } catch {
        throw new Error('OAuth state 数据损坏');
      }

      if (!parsedState.origin || Date.now() - (parsedState.createdAt || 0) > 300000) {
        await c.env.SESSION_KV.delete(stateKey);
        throw new Error('OAuth state 无效或已过期');
      }

      // 验证用户并获取信息（此方法内部已交换 token）
      const result = await discordAuth.verifyAndGetUser(c, code);
      if (!result) {
        const errorMsg = '登录失败：您可能不在允许的 Discord 服务器中';
        if (isJsonRequest) {
          return new Response(JSON.stringify({ success: false, message: errorMsg }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(errorHtml(errorMsg, parsedState.origin), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      // 使用 verifyAndGetUser 返回的 tokenData（不再重复交换）
      const tokenData = result.tokenData;

      // 获取用户信息，检查是否是管理员
      const userInfo = await userDb.get(c, result.user.id);
      const isSuperAdmin = await userDb.isSuperAdmin(c, result.user.id);

      // 超级管理员应天然具备管理员权限
      const isAdmin = userInfo?.isAdmin || isSuperAdmin || false;

      await userDb.upsert(c, {
        id: result.user.id,
        username: result.user.username,
        global_name: result.user.global_name || undefined,
        avatar: result.user.avatar,
        discriminator: result.user.discriminator || '0000',
        guilds: [],
        isAdmin,
      });

      // 创建 JWT token
      const token = await jwt.sign(c, {
        userId: result.user.id,
        username: result.user.username,
        globalName: result.user.global_name || undefined,
        avatar: result.user.avatar,
        isAdmin,
        isSuperAdmin,
      });

      // 构建用户数据
      const avatarUrl = result.user.avatar
        ? `https://cdn.discordapp.com/avatars/${result.user.id}/${result.user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(result.user.discriminator || '0') % 5}.png`;

      const userData = {
        id: result.user.id,
        username: result.user.username,
        globalName: result.user.global_name || undefined,
        avatar: result.user.avatar,
        avatarUrl,
        isAdmin,
        isSuperAdmin,
      };

      await c.env.SESSION_KV.put(
        'oauth_result_' + state,
        JSON.stringify({
          token,
          user: userData,
          createdAt: Date.now(),
        }),
        { expirationTtl: 300 },
      );

      await c.env.SESSION_KV.delete(stateKey);

      // 如果请求指定了 format=json，返回 JSON 而不是 HTML
      if (isJsonRequest) {
        return new Response(
          JSON.stringify({
            success: true,
            token,
            user: userData,
          }),
          {
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      // 返回成功页面（用于直接浏览器访问的情况）
      return new Response(successHtml(token, userData, parsedState.origin), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } catch (error) {
      console.error('OAuth callback error:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      if (isJsonRequest) {
        return new Response(JSON.stringify({ success: false, message: errorMessage }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(errorHtml('登录失败：' + errorMessage), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
  }
}

/**
 * OAuth 轮询接口已弃用
 */
export class AuthPoll extends OpenAPIRoute {
  schema = {
    tags: ['Auth'],
    summary: 'Poll for OAuth Login Result',
    request: {
      query: z.object({
        key: z.string(),
      }),
    },
  };

  async handle(c: AppContext) {
    const { key } = c.req.query();
    const data = await c.env.SESSION_KV.get('oauth_result_' + key);
    if (!data) {
      return c.json({ ready: false }, 200);
    }

    await c.env.SESSION_KV.delete('oauth_result_' + key);
    const parsed = JSON.parse(data) as { token: string; user: unknown };
    return c.json({ ready: true, token: parsed.token, user: parsed.user }, 200);
  }
}

/**
 * 获取当前用户信息
 */
export class AuthMe extends OpenAPIRoute {
  schema = {
    tags: ['Auth'],
    summary: 'Get Current User Info',
    request: {
      headers: z.object({
        authorization: z.string().describe('JWT Token'),
      }),
    },
  };

  async handle(c: AppContext) {
    const authHeader = c.req.header('authorization');
    if (!authHeader) {
      return { user: null };
    }

    // 使用 JWT 验证
    const payload = await jwt.extractFromHeader(c, authHeader);
    if (!payload) {
      return { user: null };
    }

    const avatarUrl = payload.avatar
      ? `https://cdn.discordapp.com/avatars/${payload.userId}/${payload.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/0.png`;

    return {
      user: {
        id: payload.userId,
        username: payload.username,
        globalName: payload.globalName,
        avatar: payload.avatar,
        avatarUrl,
        isAdmin: payload.isAdmin,
        isSuperAdmin: payload.isSuperAdmin || false,
      },
    };
  }
}

/**
 * 登出
 * JWT 是无状态的，登出只需要前端清除 token 即可
 * 后端不需要做任何操作（如果需要实现 token 注销，可以将 token 加入黑名单）
 */
export class AuthLogout extends OpenAPIRoute {
  schema = {
    tags: ['Auth'],
    summary: 'Logout',
    request: {
      headers: z.object({
        authorization: z.string().describe('JWT Token'),
      }),
    },
  };

  async handle(c: AppContext) {
    // JWT 是无状态的，前端清除 token 即可
    // 如果需要实现 token 注销，可以将 token 加入黑名单（使用 KV 存储）
    return { success: true };
  }
}
