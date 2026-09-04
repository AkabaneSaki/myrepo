import { fromHono } from 'chanfana';
import { Hono } from 'hono';

// 类型定义
import type { Env } from './env';

// 工具函数
import { projectDb } from './utils/db';
import { jwt } from './utils/jwt';

// 页面
import { homePage, homeScriptPage } from './pages/home';

// 认证端点
import { AuthCallback, AuthLogin, AuthLogout, AuthMe, AuthPoll } from './endpoints/auth';

// 项目端点
import {
  MyProjects,
  MySubscriptions,
  ProjectCoverUpload,
  ProjectCreate,
  ProjectDelete,
  ProjectEntryRemove,
  ProjectFetch,
  ProjectLikeToggle,
  ProjectList,
  ProjectRegexUpload,
  ProjectSubscribeSet,
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
        "default-src 'self'; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; script-src 'self'; img-src 'self' https://cdn.discordapp.com https://wsrv.nl data: blob:; font-src 'self' https://cdnjs.cloudflare.com; connect-src 'self' https://discord.com;",
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
    const hasAuthorization = Boolean(c.req.header('authorization'));
    if (c.req.path === '/api/projects') {
      c.res.headers.append('Vary', 'Authorization');
      c.res.headers.set(
        'Cache-Control',
        hasAuthorization ? 'private, no-store' : 'public, max-age=60, s-maxage=120, stale-while-revalidate=300',
      );
    } else if (/^\/api\/projects\/[^/]+$/.test(c.req.path)) {
      c.res.headers.append('Vary', 'Authorization');
      c.res.headers.set(
        'Cache-Control',
        hasAuthorization ? 'private, no-store' : 'public, max-age=120, s-maxage=300, stale-while-revalidate=600',
      );
    } else if (c.req.path === '/assets/home.js') {
      c.res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
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

// 主页只返回静态壳；登录态、项目列表和审核状态由前端 API 按需加载。
app.get('/', c => {
  return new Response(homePage(), {
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
openapi.get('/api/my/subscriptions', MySubscriptions);
openapi.post('/api/projects', ProjectCreate);
openapi.put('/api/projects/:projectId', ProjectUpdate);
openapi.put('/api/projects/:projectId/visibility', ProjectVisibilityUpdate);
openapi.delete('/api/projects/:projectId', ProjectDelete);
openapi.post('/api/projects/:projectId/entries/remove', ProjectEntryRemove);
openapi.post('/api/projects/:projectId/like', ProjectLikeToggle);
openapi.post('/api/projects/:projectId/subscribe', ProjectSubscribeToggle);
openapi.put('/api/projects/:projectId/subscribe', ProjectSubscribeSet);

// ============ 项目文件上传 ============
openapi.post('/api/projects/:projectId/upload', ProjectUpload);
openapi.post('/api/projects/:projectId/upload-cover', ProjectCoverUpload);
openapi.post('/api/projects/:projectId/upload-regex', ProjectRegexUpload);

// ============ 项目文件下载 (代理) ============
// 通过 worker 代理下载，解决 CORS 问题
app.get('/api/files/*', async c => {
  const key = c.req.path.replace('/api/files/', '');

  try {
    let isPrivateProjectFile = false;
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
      isPrivateProjectFile = project.status !== 'approved';

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
    headers.set(
      'Cache-Control',
      isPrivateProjectFile ? 'private, no-store' : 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
    );

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
