import { fromHono } from 'chanfana';
import { Hono } from 'hono';

// 类型定义
import type { Env } from './env';

// 工具函数
import { initDatabase, projectDb } from './utils/db';
import { jwt } from './utils/jwt';

// 页面
import { homePage, homeScriptPage } from './pages/home';

// 认证端点
import { AuthCallback, AuthLogin, AuthLogout, AuthMe, AuthPoll } from './endpoints/auth';

// 项目端点
import {
  MyProjects,
  ProjectCoverUpload,
  ProjectCreate,
  ProjectDelete,
  ProjectFetch,
  ProjectLikeToggle,
  ProjectList,
  ProjectRegexUpload,
  ProjectSubscribeToggle,
  ProjectUpdate,
  ProjectUpload,
  ProjectVisibilityUpdate,
} from './endpoints/projects';

// 管理员端点
import {
  AdminActionLogList,
  AdminList,
  AdminPendingList,
  AdminProjectList,
  AdminReview,
  AdminSetAdmin,
} from './endpoints/admin';

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

app.onError((error, c) => {
  console.error('Unhandled worker error:', error);
  return c.json(
    {
      error: error instanceof Error ? error.message : 'Internal server error',
    },
    500,
  );
});

// ============ CORS 中间件 =============
app.use('*', async (c, next) => {
  const isOAuthCallbackRequest = c.req.path === '/api/auth/callback';

  const applyCorsHeaders = (headers: Headers) => {
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'same-origin');

    if (!isOAuthCallbackRequest) {
      headers.set(
        'Content-Security-Policy',
        "default-src 'self'; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; script-src 'self'; img-src 'self' https://cdn.discordapp.com data:; font-src 'self' https://cdnjs.cloudflare.com; connect-src 'self' https://discord.com;",
      );
    }
  };

  applyCorsHeaders(c.res.headers);

  // 处理预检请求
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: new Headers(c.res.headers),
    });
  }

  await next();

  applyCorsHeaders(c.res.headers);

  if (c.req.method === 'GET') {
    if (c.req.path === '/api/projects') {
      c.res.headers.set('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=300');
    } else if (/^\/api\/projects\/[^/]+$/.test(c.req.path)) {
      c.res.headers.set('Cache-Control', 'public, max-age=120, s-maxage=300, stale-while-revalidate=600');
    } else if (c.req.path === '/assets/home.js') {
      c.res.headers.set('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=1800');
    }
  }
});

// ============ 数据库初始化中间件 ============
// 使用 D1 特有的方式：在第一次请求时初始化数据库
// 注意：由于数据库已经通过 wrangler d1 execute 初始化，这里主要是容错处理
let dbInitialized = false;

app.use('*', async (c, next) => {
  if (!dbInitialized) {
    try {
      await initDatabase(c);
      dbInitialized = true;
      console.info('数据库初始化完成');
    } catch (error) {
      // 如果数据库已经存在或初始化过，也认为成功
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('already exists') || errorMessage.includes('no such table')) {
        // 数据库已存在，初始化成功
        dbInitialized = true;
        console.info('数据库已存在，跳过初始化');
      } else {
        console.warn('数据库初始化遇到问题:', errorMessage);
        // 继续处理请求，可能是远程数据库已初始化
      }
    }
  }
  await next();
});

// Setup OpenAPI registry
const openapi = fromHono(app, {
  docs_url: '/docs',
});

// ============ 主页路由 ============
app.get('/assets/home.js', c => {
  return new Response(homeScriptPage(), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
});

// 主页 - 需要检查用户登录状态
app.get('/', async c => {
  const token = c.req.header('authorization');

  let user = null;
  let pendingCount = 0;

  // 检查用户是否已登录
  if (token) {
    try {
      const payload = await jwt.extractFromHeader(c, token);
      if (payload) {
        const avatarUrl = payload.avatar
          ? `https://cdn.discordapp.com/avatars/${payload.userId}/${payload.avatar}.webp?size=100`
          : `https://cdn.discordapp.com/embed/avatars/0.png`;

        user = {
          id: payload.userId,
          username: payload.username,
          avatarUrl,
          isAdmin: payload.isAdmin || false,
        };

        // 如果是管理员，获取待审核数量
        if (user.isAdmin) {
          try {
            const result = await c.env.DB.prepare('SELECT COUNT(*) as count FROM projects WHERE status = ?')
              .bind('pending')
              .first<{ count: number }>();
            pendingCount = result?.count || 0;
          } catch (e) {
            console.error('获取待审核数量失败:', e);
          }
        }
      }
    } catch (e) {
      // Token 无效或过期，视为未登录
    }
  }

  // 获取已审核项目列表（公开）
  let projects = [];
  try {
    const results = await c.env.DB.prepare(
      'SELECT p.*, u.global_name as author_global_name FROM projects p LEFT JOIN users u ON p.author_id = u.id WHERE p.status = ? ORDER BY p.updated_at DESC LIMIT 50',
    )
      .bind('approved')
      .all<{
        id: string;
        name: string;
        description: string | null;
        version: string;
        author_id: string;
        author_name: string;
        author_global_name: string | null;
        author_avatar: string | null;
        status: string;
        tags: string;
        created_at: string;
        updated_at: string;
      }>();

    projects =
      results.results?.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        version: row.version,
        authorId: row.author_id,
        authorName: row.author_name,
        authorGlobalName: row.author_global_name || row.author_name,
        authorAvatar: row.author_avatar,
        status: row.status,
        tags: JSON.parse(row.tags || '[]'),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })) || [];
  } catch (e) {
    console.error('获取项目列表失败:', e);
  }

  // 渲染主页
  const html = homePage();
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
});

// ============ 认证接口 ============
openapi.get('/api/auth/login', AuthLogin);
openapi.get('/api/auth/callback', AuthCallback);
openapi.get('/api/auth/poll', AuthPoll);
openapi.get('/api/auth/me', AuthMe);
openapi.post('/api/auth/logout', AuthLogout);

// ============ 项目接口 (公开) ============
openapi.get('/api/projects', ProjectList);
openapi.get('/api/projects/:projectId', ProjectFetch);

// ============ 项目接口 (需要登录) ============
openapi.get('/api/my/projects', MyProjects);
openapi.post('/api/projects', ProjectCreate);
openapi.put('/api/projects/:projectId', ProjectUpdate);
openapi.put('/api/projects/:projectId/visibility', ProjectVisibilityUpdate);
openapi.delete('/api/projects/:projectId', ProjectDelete);
openapi.post('/api/projects/:projectId/like', ProjectLikeToggle);
openapi.post('/api/projects/:projectId/subscribe', ProjectSubscribeToggle);

// ============ 项目文件上传 ============
openapi.post('/api/projects/:projectId/upload', ProjectUpload);
openapi.post('/api/projects/:projectId/upload-cover', ProjectCoverUpload);
openapi.post('/api/projects/:projectId/upload-regex', ProjectRegexUpload);

// ============ 项目文件下载 (代理) ============
// 通过 worker 代理下载，解决 CORS 问题
app.get('/api/files/*', async c => {
  const key = c.req.path.replace('/api/files/', '');

  try {
    const projectMatch = key.match(/^projects\/([^/]+)\//);
    if (projectMatch) {
      const projectId = projectMatch[1];
      const payload = await jwt.extractFromHeader(c, c.req.header('authorization'));
      const project = await c.env.DB.prepare('SELECT author_id, status FROM projects WHERE id = ?')
        .bind(projectId)
        .first<{ author_id: string; status: string }>();

      if (!project) {
        return c.json({ error: 'File not found' }, 404);
      }

      const canView =
        project.status === 'approved' || (payload && (payload.isAdmin || payload.userId === project.author_id));
      if (!canView) {
        return c.json({ error: 'File not found' }, 404);
      }
    }

    const object = await c.env.R2_BUCKET.get(key);

    if (!object) {
      return c.json({ error: 'File not found' }, 404);
    }

    if (projectMatch && key.endsWith(`project-${projectMatch[1]}.json`)) {
      await projectDb.incrementDownloads(c, projectMatch[1]);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Length', object.size.toString());
    headers.set('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');

    return new Response(object.body, {
      headers,
    });
  } catch (error) {
    console.error('Error downloading file:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ============ 管理员接口 ============
openapi.get('/api/admin/logs', AdminActionLogList);
openapi.get('/api/admin/pending', AdminPendingList);
openapi.post('/api/admin/review/:projectId', AdminReview);
openapi.get('/api/admin/projects', AdminProjectList);
openapi.get('/api/admin/list', AdminList);
openapi.post('/api/admin/set-admin', AdminSetAdmin);

// You may also register routes for non OpenAPI directly on Hono
// app.get('/test', (c) => c.text('Hono!'))

// Export the Hono app
export default app;
