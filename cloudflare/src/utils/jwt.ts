import type { AppContext } from '../types';

/**
 * JWT 工具函数
 * 使用 HS256 算法进行签名和验证
 */

// JWT 头部
const JWT_HEADER = {
  alg: 'HS256',
  typ: 'JWT',
};

// JWT 声明
export interface JWTPayload {
  userId: string;
  username: string;
  globalName?: string;
  avatar: string;
  isAdmin: boolean;
  isSuperAdmin?: boolean;
  iat: number; // 签发时间
  exp: number; // 过期时间
}

/**
 * 将 Base64URL 编码的字符串转换为 Uint8Array
 */
function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const decoded = atob(base64 + padding);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return bytes;
}

/**
 * 将 Uint8Array 转换为 Base64URL 编码的字符串
 */
function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * 创建 HMAC-SHA256 签名
 */
async function signHMAC(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return uint8ArrayToBase64Url(new Uint8Array(signature));
}

/**
 * 验证 HMAC-SHA256 签名
 */
async function verifyHMAC(secret: string, data: string, signature: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);

  const signatureBytes = base64UrlToUint8Array(signature);
  return await crypto.subtle.verify('HMAC', cryptoKey, signatureBytes, messageData);
}

/**
 * JWT 工具
 */
export const jwt = {
  /**
   * 生成 JWT Token
   * @param c 上下文（用于获取环境变量中的 JWT_SECRET）
   * @param payload JWT 载荷
   * @param expiresIn 过期时间（秒）
   */
  sign: async (
    c: AppContext,
    payload: Omit<JWTPayload, 'iat' | 'exp'>,
    expiresIn: number = 7 * 24 * 60 * 60, // 默认 7 天
  ): Promise<string> => {
    const secret = c.env.JWT_SECRET;
    if (!secret) {
      console.error('JWT_SECRET is not set');
      throw new Error('服务器未配置 JWT_SECRET');
    }

    const now = Math.floor(Date.now() / 1000);
    const fullPayload: JWTPayload = {
      ...payload,
      iat: now,
      exp: now + expiresIn,
    };

    // 编码 header 和 payload
    const headerEncoded = uint8ArrayToBase64Url(new Uint8Array(new TextEncoder().encode(JSON.stringify(JWT_HEADER))));
    const payloadEncoded = uint8ArrayToBase64Url(new Uint8Array(new TextEncoder().encode(JSON.stringify(fullPayload))));

    // 生成签名
    const signature = await signHMAC(secret, `${headerEncoded}.${payloadEncoded}`);

    return `${headerEncoded}.${payloadEncoded}.${signature}`;
  },

  /**
   * 验证并解码 JWT Token
   * @returns 解码后的 payload，如果验证失败返回 null
   */
  verify: async (c: AppContext, token: string): Promise<JWTPayload | null> => {
    const secret = c.env.JWT_SECRET;
    if (!secret) {
      console.error('JWT_SECRET is not set');
      return null;
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      console.warn('Invalid JWT format');
      return null;
    }

    const [headerEncoded, payloadEncoded, signature] = parts;

    // 验证签名
    const isValid = await verifyHMAC(secret, `${headerEncoded}.${payloadEncoded}`, signature);
    if (!isValid) {
      console.warn('Invalid JWT signature');
      return null;
    }

    // 解析 payload
    try {
      const payload = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(payloadEncoded))) as JWTPayload;

      // 检查是否过期
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now) {
        console.warn('JWT token expired');
        return null;
      }

      return payload;
    } catch (e) {
      console.error('Failed to parse JWT payload:', e);
      return null;
    }
  },

  /**
   * 从 Authorization header 中提取并验证 JWT
   * @returns 解码后的 payload，如果验证失败返回 null
   */
  extractFromHeader: async (c: AppContext, authHeader: string | undefined): Promise<JWTPayload | null> => {
    if (!authHeader) {
      return null;
    }

    // 支持 Bearer token 格式
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    return await jwt.verify(c, token);
  },
};

/**
 * 从请求中获取当前用户
 * 这是一个辅助函数，用于需要认证的端点
 */
export async function getCurrentUserFromRequest(c: AppContext): Promise<JWTPayload | null> {
  const authHeader = c.req.header('authorization');
  return await jwt.extractFromHeader(c, authHeader);
}
