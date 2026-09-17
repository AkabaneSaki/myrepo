import type { AppContext } from '../types';

function normalizeR2Key(value?: string): string | undefined {
  if (!value) return undefined;

  const withoutFragment = value.split('#', 1)[0];
  const withoutQuery = withoutFragment.split('?', 1)[0];
  const proxyMarker = '/api/files/';
  const proxyIndex = withoutQuery.lastIndexOf(proxyMarker);
  if (proxyIndex >= 0) {
    return withoutQuery.slice(proxyIndex + proxyMarker.length);
  }

  try {
    return new URL(withoutQuery).pathname.replace(/^\/+/, '');
  } catch {
    return withoutQuery.replace(/^\/+/, '');
  }
}

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

  copyProjectFilesToPublished: async (
    c: AppContext,
    sourceProjectId: string,
    targetProjectId: string,
    selectedCoverKey?: string,
  ): Promise<{
    downloadUrl?: string;
    fileSize?: number;
    coverImage?: string;
    rollback: () => Promise<void>;
  }> => {
    const bucket = c.env.R2_BUCKET;
    const sourcePrefix = `projects/${sourceProjectId}/`;
    const normalizedSelectedCoverKey = normalizeR2Key(selectedCoverKey);
    const listed = await bucket.list({ prefix: sourcePrefix });
    const copied: {
      downloadUrl?: string;
      fileSize?: number;
      coverImage?: string;
    } = {};
    const pendingCopies: Array<{
      targetKey: string;
      targetFileName: string;
      body: ArrayBuffer;
      size: number;
      httpMetadata: R2HTTPMetadata;
      customMetadata: Record<string, string>;
    }> = [];

    for (const item of listed.objects) {
      const fileName = item.key.slice(sourcePrefix.length);
      if (!fileName) continue;
      if (fileName.startsWith('cover.') && item.key !== normalizedSelectedCoverKey) continue;

      const sourceObject = await bucket.get(item.key);
      if (!sourceObject) continue;

      let targetFileName = fileName;
      if (fileName === `project-${sourceProjectId}.json`) {
        targetFileName = `project-${targetProjectId}.json`;
      } else if (fileName === `regex-${sourceProjectId}.json`) {
        targetFileName = `regex-${targetProjectId}.json`;
      }

      const targetKey = `projects/${targetProjectId}/${targetFileName}`;
      pendingCopies.push({
        targetKey,
        targetFileName,
        body: await sourceObject.arrayBuffer(),
        size: sourceObject.size,
        httpMetadata: sourceObject.httpMetadata,
        customMetadata: sourceObject.customMetadata,
      });

      if (targetFileName === `project-${targetProjectId}.json`) {
        copied.downloadUrl = r2Storage.getProxyUrl(c, targetKey);
        copied.fileSize = sourceObject.size;
      } else if (targetFileName.startsWith('cover.')) {
        copied.coverImage = targetKey;
      }
    }

    let staleCoverKeys: string[] = [];
    if (copied.coverImage) {
      const targetCoverPrefix = `projects/${targetProjectId}/cover.`;
      const targetCovers = await bucket.list({ prefix: targetCoverPrefix });
      staleCoverKeys = targetCovers.objects.map(item => item.key).filter(key => key !== copied.coverImage);
    }

    type Backup = {
      body: ArrayBuffer;
      httpMetadata: R2HTTPMetadata;
      customMetadata: Record<string, string>;
    } | null;
    const backups = new Map<string, Backup>();
    const keysToSnapshot = new Set([
      ...pendingCopies.map(item => item.targetKey),
      ...staleCoverKeys,
    ]);
    for (const key of keysToSnapshot) {
      const existing = await bucket.get(key);
      backups.set(
        key,
        existing
          ? {
              body: await existing.arrayBuffer(),
              httpMetadata: existing.httpMetadata,
              customMetadata: existing.customMetadata,
            }
          : null,
      );
    }

    const mutatedKeys: string[] = [];
    let rollbackDone = false;
    const rollback = async () => {
      if (rollbackDone) return;
      let firstFailure: unknown = null;
      for (const key of [...mutatedKeys].reverse()) {
        try {
          const backup = backups.get(key) ?? null;
          if (backup) {
            const restored = await bucket.put(key, backup.body, {
              httpMetadata: backup.httpMetadata,
              customMetadata: backup.customMetadata,
            });
            if (!restored) throw new Error(`Failed to restore R2 object: ${key}`);
          } else {
            await bucket.delete(key);
          }
        } catch (error) {
          firstFailure ??= error;
        }
      }
      if (firstFailure) throw firstFailure;
      rollbackDone = true;
    };

    try {
      for (const item of pendingCopies) {
        const stored = await bucket.put(item.targetKey, item.body, {
          httpMetadata: item.httpMetadata,
          customMetadata: item.customMetadata,
        });
        if (!stored) throw new Error(`Failed to publish R2 object: ${item.targetKey}`);
        mutatedKeys.push(item.targetKey);
      }
      for (const key of staleCoverKeys) {
        await bucket.delete(key);
        mutatedKeys.push(key);
      }
    } catch (error) {
      try {
        await rollback();
      } catch (rollbackError) {
        console.error('Failed to rollback partial R2 publication', { targetProjectId, rollbackError });
      }
      throw error;
    }

    return { ...copied, rollback };
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
