import type { AppContext } from '../types';

/**
 * R2 存储操作工具
 */
export const r2Storage = {
  getProxyUrl: (c: AppContext, key: string): string => {
    const requestUrl = new URL(c.req.url);
    const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
    return `${baseUrl}/api/files/${key}`;
  },

  /**
   * 上传文件到 R2
   */
  upload: async (
    c: AppContext,
    key: string,
    body: ArrayBuffer,
    contentType: string,
    projectId?: string,
  ): Promise<{
    url: string;
    size: number;
  } | null> => {
    const bucket = c.env.R2_BUCKET;

    const object = await bucket.put(key, body, {
      httpMetadata: {
        contentType,
      },
    });

    if (!object) {
      console.error('Failed to upload to R2');
      return null;
    }

    const url = r2Storage.getProxyUrl(c, key);

    return {
      url,
      size: object.size,
    };
  },

  /**
   * 上传项目文件
   */
  uploadProjectFile: async (
    c: AppContext,
    projectId: string,
    file: ArrayBuffer,
    fileName: string,
    contentType: string,
  ): Promise<{
    key: string;
    url: string;
    size: number;
  } | null> => {
    const key = `projects/${projectId}/${fileName}`;

    const result = await r2Storage.upload(c, key, file, contentType, projectId);
    if (!result) return null;

    return {
      key,
      ...result,
    };
  },

  /**
   * 获取文件
   */
  get: async (c: AppContext, key: string): Promise<R2ObjectBody | null> => {
    const bucket = c.env.R2_BUCKET;
    const object = await bucket.get(key);

    return object;
  },

  /**
   * 删除文件
   */
  delete: async (c: AppContext, key: string): Promise<boolean> => {
    const bucket = c.env.R2_BUCKET;

    await bucket.delete(key);
    return true;
  },

  /**
   * 删除项目的所有文件
   */
  deleteProjectFiles: async (c: AppContext, projectId: string): Promise<void> => {
    const bucket = c.env.R2_BUCKET;
    const prefix = `projects/${projectId}/`;

    // 列出所有匹配的对象
    const objects = await bucket.list({ prefix });

    // 删除所有对象
    if (objects.objects.length > 0) {
      const keysToDelete = objects.objects.map(obj => obj.key);
      await bucket.delete(keysToDelete);
    }
  },

  /**
   * 获取项目的公开下载链接
   */
  getDownloadUrl: (c: AppContext, key: string, projectId?: string): string => {
    return r2Storage.getProxyUrl(c, projectId ? `projects/${projectId}/${key.split('/').pop()}` : key);
  },
};

/**
 * 文件类型映射
 */
export const contentTypeMap: Record<string, string> = {
  // 常见文件类型
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.tar.gz': 'application/gzip',
  '.gz': 'application/gzip',

  // 图片
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',

  // 音频
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',

  // 视频
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',

  // 文档
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.md': 'text/markdown',

  // 代码
  '.js': 'application/javascript',
  '.ts': 'application/typescript',
  '.html': 'text/html',
  '.css': 'text/css',
};

/**
 * 根据文件扩展名获取 Content-Type
 */
export function getContentType(fileName: string): string {
  const ext = fileName.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  return contentTypeMap[ext] || 'application/octet-stream';
}
