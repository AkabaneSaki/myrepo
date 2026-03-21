import type { AppContext } from '../types';
import { userDb } from './db';

/**
 * Discord OAuth 配置
 */
export const discordAuth = {
  /**
   * 获取 OAuth 授权 URL
   * 如果环境变量中配置了 REDIRECT_URI，则优先使用；否则根据请求自动生成
   */
  getAuthorizationUrl: (c: AppContext, state?: string): string => {
    const clientId = c.env.DISCORD_CLIENT_ID;
    // 优先使用环境变量中配置的回调地址，如果没有配置则根据请求自动生成
    let redirectUri = c.env.DISCORD_REDIRECT_URI;

    // 如果没有配置回调地址，则根据请求自动生成
    if (!redirectUri) {
      const url = new URL(c.req.url);
      redirectUri = `${url.protocol}//${url.host}/api/auth/callback`;
      console.info('自动生成回调地址:', redirectUri);
    }

    if (!clientId) {
      console.error('DISCORD_CLIENT_ID is not set');
      throw new Error('服务器未配置 Discord OAuth (CLIENT_ID)');
    }
    if (!redirectUri) {
      console.error('DISCORD_REDIRECT_URI is not set');
      throw new Error('服务器未配置 Discord OAuth (REDIRECT_URI)');
    }

    const scopes = ['identify', 'guilds'].join(' ');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      ...(state && { state }),
    });

    return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
  },

  /**
   * 使用授权码交换 access_token
   */
  exchangeCode: async (
    c: AppContext,
    code: string,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  } | null> => {
    const clientId = c.env.DISCORD_CLIENT_ID;
    const clientSecret = c.env.DISCORD_CLIENT_SECRET;
    // 优先使用环境变量中配置的回调地址，如果没有配置则根据请求自动生成
    let redirectUri = c.env.DISCORD_REDIRECT_URI;

    // 如果没有配置回调地址，则根据请求自动生成
    if (!redirectUri) {
      const url = new URL(c.req.url);
      redirectUri = `${url.protocol}//${url.host}/api/auth/callback`;
    }

    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      console.error('Failed to exchange code:', await response.text());
      return null;
    }

    return response.json();
  },

  /**
   * 刷新 access_token
   */
  refreshToken: async (
    c: AppContext,
    refreshToken: string,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  } | null> => {
    const clientId = c.env.DISCORD_CLIENT_ID;
    const clientSecret = c.env.DISCORD_CLIENT_SECRET;

    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      console.error('Failed to refresh token:', await response.text());
      return null;
    }

    return response.json();
  },

  /**
   * 获取用户信息
   */
  getUser: async (
    accessToken: string,
  ): Promise<{
    id: string;
    username: string;
    global_name: string | null;
    avatar: string;
    discriminator: string;
  } | null> => {
    const response = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      console.error('Failed to get user:', await response.text());
      return null;
    }

    return response.json();
  },

  /**
   * 获取用户所在的服务器列表
   */
  getUserGuilds: async (
    accessToken: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      icon: string | null;
      owner: boolean;
    }>
  > => {
    const response = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      console.error('Failed to get guilds:', await response.text());
      return [];
    }

    return response.json();
  },

  /**
   * 验证并获取完整用户信息
   */
  verifyAndGetUser: async (
    c: AppContext,
    code: string,
  ): Promise<{
    user: {
      id: string;
      username: string;
      global_name: string | null;
      avatar: string;
      discriminator: string;
    };
    guilds: string[];
    tokenData: {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
  } | null> => {
    // 检查必要的环境变量
    const clientId = c.env.DISCORD_CLIENT_ID;
    const clientSecret = c.env.DISCORD_CLIENT_SECRET;
    const redirectUri = c.env.DISCORD_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      console.error('Missing Discord OAuth credentials:', {
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        hasRedirectUri: !!redirectUri,
      });
      throw new Error('服务器未配置 Discord OAuth，请联系管理员');
    }

    // 交换授权码获取 token
    const tokenData = await discordAuth.exchangeCode(c, code);
    if (!tokenData) return null;

    // 获取用户信息
    const user = await discordAuth.getUser(tokenData.access_token);
    if (!user) return null;

    // 获取用户服务器列表
    const guilds = await discordAuth.getUserGuilds(tokenData.access_token);
    const guildIds = guilds.map(g => g.id);

    // 检查用户是否在允许的服务器中
    const allowedGuildIds = c.env.ALLOWED_GUILD_IDS.split(',').filter(Boolean);
    const hasAccess = allowedGuildIds.length === 0 || guildIds.some(id => allowedGuildIds.includes(id));

    if (!hasAccess) {
      console.warn(`User ${user.id} not in allowed guilds`);
      return null;
    }

    // 保存用户到数据库
    await userDb.upsert(c, {
      id: user.id,
      username: user.username,
      global_name: user.global_name || undefined,
      avatar: user.avatar || '',
      discriminator: user.discriminator || '',
      guilds: guildIds,
    });

    return {
      user,
      guilds: guildIds,
      tokenData,
    };
  },
};

/**
 * 会话管理
 */
export const session = {
  /**
   * 创建会话
   */
  create: async (
    c: AppContext,
    userId: string,
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
  ): Promise<string> => {
    const sessionId = crypto.randomUUID();
    const expiresAt = Date.now() + expiresIn * 1000;

    await c.env.SESSION_KV.put(
      sessionId,
      JSON.stringify({
        userId,
        accessToken,
        refreshToken,
        expiresAt,
      }),
      {
        expirationTtl: expiresIn,
      },
    );

    return sessionId;
  },

  /**
   * 获取会话
   */
  get: async (
    c: AppContext,
    sessionId: string,
  ): Promise<{
    userId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  } | null> => {
    const data = await c.env.SESSION_KV.get(sessionId);
    if (!data) return null;

    const session = JSON.parse(data);

    // 检查是否过期
    if (session.expiresAt < Date.now()) {
      await c.env.SESSION_KV.delete(sessionId);
      return null;
    }

    return session;
  },

  /**
   * 删除会话 (登出)
   */
  delete: async (c: AppContext, sessionId: string): Promise<void> => {
    await c.env.SESSION_KV.delete(sessionId);
  },

  /**
   * 刷新会话 token
   */
  refresh: async (c: AppContext, sessionId: string): Promise<boolean> => {
    const sessionData = await session.get(c, sessionId);
    if (!sessionData) return false;

    const tokenData = await discordAuth.refreshToken(c, sessionData.refreshToken);
    if (!tokenData) return false;

    // 更新会话
    const expiresAt = Date.now() + tokenData.expires_in * 1000;
    await c.env.SESSION_KV.put(
      sessionId,
      JSON.stringify({
        ...sessionData,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
      }),
      {
        expirationTtl: tokenData.expires_in,
      },
    );

    return true;
  },
};

/**
 * 检查用户是否为管理员
 */
export async function checkAdmin(c: AppContext, userId: string): Promise<boolean> {
  const user = await userDb.get(c, userId);
  return user?.isAdmin || false;
}

/**
 * 检查用户是否有权限访问上传功能
 */
export async function checkUploadPermission(c: AppContext, userId: string): Promise<boolean> {
  const user = await userDb.get(c, userId);
  if (!user) return false;

  // 如果没有设置允许的服务器，则允许所有已登录用户
  const allowedGuildIds = c.env.ALLOWED_GUILD_IDS.split(',').filter(Boolean);
  if (allowedGuildIds.length === 0) return true;

  // 检查用户是否在允许的服务器中
  return user.guilds.some(guildId => allowedGuildIds.includes(guildId));
}
