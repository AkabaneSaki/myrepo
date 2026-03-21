import type { AppContext, ProjectReviewTarget } from '../types';
import type { JWTPayload } from './jwt';
import { r2Storage } from './r2';

/**
 * 数据库初始化 - 创建表结构
 */
export async function initDatabase(c: AppContext): Promise<void> {
  const db = c.env.DB;
  const safeExec = async (sql: string) => {
    try {
      await db.exec(sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('duplicate column name')) {
        throw error;
      }
    }
  };

  // 创建用户表
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      global_name TEXT,
      avatar TEXT,
      discriminator TEXT,
      guilds TEXT,
      is_admin INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 创建项目表
  await db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      version TEXT DEFAULT '1.0.0',
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_avatar TEXT,
      status TEXT DEFAULT 'pending',
      download_url TEXT,
      file_size INTEGER,
      tags TEXT DEFAULT '[]',
      cover_image TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      reviewer_id TEXT,
      reject_reason TEXT,
      FOREIGN KEY (author_id) REFERENCES users(id)
    )
  `);

  // 创建索引
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_author ON projects(author_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_created ON projects(created_at DESC)`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS project_likes (
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, user_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS project_subscribes (
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, user_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db.exec(`CREATE INDEX IF NOT EXISTS idx_project_likes_project_id ON project_likes(project_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_project_likes_user_id ON project_likes(user_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_project_subscribes_project_id ON project_subscribes(project_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_project_subscribes_user_id ON project_subscribes(user_id)`);
  await db.exec(
    `CREATE TABLE IF NOT EXISTS admin_action_logs (id TEXT PRIMARY KEY, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  );
  await safeExec(`ALTER TABLE projects ADD COLUMN root_project_id TEXT`);
  await safeExec(`ALTER TABLE projects ADD COLUMN published_project_id TEXT`);
  await safeExec(`ALTER TABLE projects ADD COLUMN draft_project_id TEXT`);
  await safeExec(`ALTER TABLE projects ADD COLUMN review_target TEXT DEFAULT 'project'`);
  await safeExec(`ALTER TABLE projects ADD COLUMN visibility INTEGER DEFAULT 1`);
  await safeExec(`ALTER TABLE projects ADD COLUMN is_published INTEGER DEFAULT 0`);
  await safeExec(`ALTER TABLE projects ADD COLUMN latest_approved_at TEXT`);
  await safeExec(`ALTER TABLE projects ADD COLUMN downloads_count INTEGER DEFAULT 0`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS super_admins (
      user_id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      note TEXT
    )
  `);

  const superAdminUserId = c.env.SUPER_ADMIN_USER_ID?.trim();
  if (superAdminUserId) {
    await db
      .prepare(
        `
          INSERT INTO super_admins (user_id, note)
          VALUES (?, ?)
          ON CONFLICT(user_id) DO NOTHING
        `,
      )
      .bind(superAdminUserId, 'bootstrap super admin')
      .run();

    await db
      .prepare(
        `
          INSERT INTO users (id, username, global_name, avatar, discriminator, guilds, is_admin, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            is_admin = 1,
            updated_at = excluded.updated_at
        `,
      )
      .bind(superAdminUserId, `super-admin-${superAdminUserId}`, null, '', '', '[]', now(), now())
      .run();
  }

  console.info('Database initialized successfully');
}

/**
 * 生成 UUID
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * 获取当前时间戳 (ISO 格式)
 */
export function now(): string {
  return new Date().toISOString();
}

/**
 * 用户相关数据库操作
 */
export const userDb = {
  /**
   * 创建或更新用户
   */
  upsert: async (
    c: AppContext,
    user: {
      id: string;
      username: string;
      global_name?: string;
      avatar: string;
      discriminator: string;
      guilds: string[];
      isAdmin?: boolean;
    },
  ): Promise<void> => {
    const db = c.env.DB;
    await db
      .prepare(
        `
			INSERT INTO users (id, username, global_name, avatar, discriminator, guilds, is_admin, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				username = excluded.username,
				global_name = excluded.global_name,
				avatar = excluded.avatar,
				discriminator = excluded.discriminator,
				guilds = excluded.guilds,
				is_admin = COALESCE((SELECT is_admin FROM users WHERE id = excluded.id), excluded.is_admin),
				updated_at = excluded.updated_at
		`,
      )
      .bind(
        user.id,
        user.username,
        user.global_name || null,
        user.avatar,
        user.discriminator,
        JSON.stringify(user.guilds),
        user.isAdmin ? 1 : 0,
        now(),
      )
      .run();
  },

  /**
   * 获取用户信息
   */
  get: async (c: AppContext, userId: string) => {
    const db = c.env.DB;
    const result = await db
      .prepare(
        `
			SELECT id, username, global_name, avatar, discriminator, guilds, is_admin, created_at, updated_at
			FROM users WHERE id = ?
		`,
      )
      .bind(userId)
      .first<{
        id: string;
        username: string;
        global_name: string | null;
        avatar: string;
        discriminator: string;
        guilds: string;
        is_admin: number;
        created_at: string;
        updated_at: string;
      }>();

    if (!result) return null;

    return {
      ...result,
      globalName: result.global_name || undefined,
      guilds: JSON.parse(result.guilds || '[]'),
      isAdmin: result.is_admin === 1,
    };
  },

  /**
   * 批量获取用户信息
   */
  getBatch: async (c: AppContext, userIds: string[]) => {
    if (userIds.length === 0) return [];

    const db = c.env.DB;
    const placeholders = userIds.map(() => '?').join(',');
    const results = await db
      .prepare(
        `
			SELECT id, username, global_name, avatar, discriminator, is_admin
			FROM users WHERE id IN (${placeholders})
		`,
      )
      .bind(...userIds)
      .all<{
        id: string;
        username: string;
        global_name: string | null;
        avatar: string;
        discriminator: string;
        is_admin: number;
      }>();

    return (
      results.results?.map(r => ({
        ...r,
        globalName: r.global_name || undefined,
        isAdmin: r.is_admin === 1,
      })) || []
    );
  },

  /**
   * 设置管理员
   */
  setAdmin: async (c: AppContext, userId: string, isAdmin: boolean): Promise<void> => {
    const db = c.env.DB;
    await db
      .prepare(
        `
			UPDATE users SET is_admin = ?, updated_at = ? WHERE id = ?
		`,
      )
      .bind(isAdmin ? 1 : 0, now(), userId)
      .run();
  },

  /**
   * 获取所有管理员列表
   */
  getAdmins: async (c: AppContext) => {
    const db = c.env.DB;
    const results = await db
      .prepare(
        `
			SELECT id, username, global_name, avatar, is_admin, created_at
			FROM users WHERE is_admin = 1 ORDER BY created_at ASC
		`,
      )
      .all<{
        id: string;
        username: string;
        global_name: string | null;
        avatar: string | null;
        is_admin: number;
        created_at: string;
      }>();

    return (
      results.results?.map(r => ({
        id: r.id,
        username: r.username,
        globalName: r.global_name || undefined,
        avatar: r.avatar,
        avatarUrl: r.avatar ? `https://cdn.discordapp.com/avatars/${r.id}/${r.avatar}.png` : null,
        isAdmin: r.is_admin === 1,
        createdAt: r.created_at,
      })) || []
    );
  },

  isSuperAdmin: async (c: AppContext, userId: string): Promise<boolean> => {
    if (!userId) return false;

    if (c.env.SUPER_ADMIN_USER_ID?.trim() === userId) {
      return true;
    }

    const result = await c.env.DB.prepare(`SELECT 1 as found FROM super_admins WHERE user_id = ?`)
      .bind(userId)
      .first<{ found: number }>();
    return Boolean(result?.found);
  },
};

/**
 * 项目相关数据库操作
 */
export const projectDb = {
  /**
   * 创建项目
   */
  create: async (
    c: AppContext,
    project: {
      id: string;
      name: string;
      description?: string;
      version: string;
      authorId: string;
      authorName: string;
      authorAvatar: string;
      tags?: string[];
      coverImage?: string;
      downloadUrl?: string;
      fileSize?: number;
      rootProjectId?: string;
      publishedProjectId?: string | null;
      draftProjectId?: string | null;
      reviewTarget?: ProjectReviewTarget;
      visibility?: boolean;
      isPublished?: boolean;
      latestApprovedAt?: string | null;
    },
  ): Promise<void> => {
    const db = c.env.DB;
    await db
      .prepare(
        `
			INSERT INTO projects (
				id, name, description, version, author_id, author_name, author_avatar,
				status, download_url, file_size, tags, cover_image, root_project_id, published_project_id,
				draft_project_id, review_target, visibility, is_published, latest_approved_at, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
      )
      .bind(
        project.id,
        project.name,
        project.description || null,
        project.version,
        project.authorId,
        project.authorName,
        project.authorAvatar,
        'pending', // 默认状态为待审核
        project.downloadUrl || null,
        project.fileSize || null,
        JSON.stringify(project.tags || []),
        project.coverImage || null,
        project.rootProjectId || project.id,
        project.publishedProjectId || null,
        project.draftProjectId || null,
        project.reviewTarget || 'project',
        project.visibility === false ? 0 : 1,
        project.isPublished ? 1 : 0,
        project.latestApprovedAt || null,
        now(),
        now(),
      )
      .run();
  },

  /**
   * 获取项目详情
   */
  get: async (c: AppContext, projectId: string, currentUser?: JWTPayload | null) => {
    const db = c.env.DB;
    const result = await db
      .prepare(
        `
			SELECT p.*, u.global_name
			FROM projects p
			LEFT JOIN users u ON p.author_id = u.id
			WHERE p.id = ?
		`,
      )
      .bind(projectId)
      .first<Record<string, unknown>>();

    if (!result) return null;

    return await enrichProject(c, parseProjectRow(result), currentUser);
  },

  /**
   * 更新项目
   */
  update: async (
    c: AppContext,
    projectId: string,
    updates: {
      name?: string;
      description?: string;
      version?: string;
      tags?: string[];
      coverImage?: string;
      downloadUrl?: string;
      fileSize?: number;
      status?: string;
      publishedProjectId?: string | null;
      draftProjectId?: string | null;
      reviewTarget?: ProjectReviewTarget;
      visibility?: boolean;
      isPublished?: boolean;
      latestApprovedAt?: string | null;
    },
  ): Promise<void> => {
    const db = c.env.DB;
    const setClauses: string[] = ['updated_at = ?'];
    const values: unknown[] = [now()];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?');
      values.push(updates.description);
    }
    if (updates.version !== undefined) {
      setClauses.push('version = ?');
      values.push(updates.version);
    }
    if (updates.tags !== undefined) {
      setClauses.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.coverImage !== undefined) {
      setClauses.push('cover_image = ?');
      values.push(updates.coverImage);
    }
    if (updates.downloadUrl !== undefined) {
      setClauses.push('download_url = ?');
      values.push(updates.downloadUrl);
    }
    if (updates.fileSize !== undefined) {
      setClauses.push('file_size = ?');
      values.push(updates.fileSize);
    }
    // 新增：处理 status 字段
    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.publishedProjectId !== undefined) {
      setClauses.push('published_project_id = ?');
      values.push(updates.publishedProjectId);
    }
    if (updates.draftProjectId !== undefined) {
      setClauses.push('draft_project_id = ?');
      values.push(updates.draftProjectId);
    }
    if (updates.reviewTarget !== undefined) {
      setClauses.push('review_target = ?');
      values.push(updates.reviewTarget);
    }
    if (updates.visibility !== undefined) {
      setClauses.push('visibility = ?');
      values.push(updates.visibility ? 1 : 0);
    }
    if (updates.isPublished !== undefined) {
      setClauses.push('is_published = ?');
      values.push(updates.isPublished ? 1 : 0);
    }
    if (updates.latestApprovedAt !== undefined) {
      setClauses.push('latest_approved_at = ?');
      values.push(updates.latestApprovedAt);
    }

    values.push(projectId);

    await db
      .prepare(
        `
			UPDATE projects SET ${setClauses.join(', ')} WHERE id = ?
		`,
      )
      .bind(...values)
      .run();
  },

  /**
   * 删除项目
   */
  delete: async (c: AppContext, projectId: string): Promise<void> => {
    const db = c.env.DB;
    const project = await db
      .prepare(`SELECT published_project_id, draft_project_id FROM projects WHERE id = ?`)
      .bind(projectId)
      .first<{ published_project_id: string | null; draft_project_id: string | null }>();

    if (project?.published_project_id) {
      await db
        .prepare(`UPDATE projects SET draft_project_id = NULL, updated_at = ? WHERE id = ?`)
        .bind(now(), project.published_project_id)
        .run();
    }

    if (project?.draft_project_id) {
      await db
        .prepare(`UPDATE projects SET published_project_id = NULL, updated_at = ? WHERE id = ?`)
        .bind(now(), project.draft_project_id)
        .run();
    }

    await db.batch([
      db.prepare(`DELETE FROM project_likes WHERE project_id = ?`).bind(projectId),
      db.prepare(`DELETE FROM project_subscribes WHERE project_id = ?`).bind(projectId),
      db.prepare(`DELETE FROM projects WHERE id = ?`).bind(projectId),
    ]);
  },

  /**
   * 获取项目列表
   */
  list: async (
    c: AppContext,
    options: {
      page: number;
      pageSize: number;
      status?: string;
      authorId?: string;
      tag?: string;
      search?: string;
      approvedOnly?: boolean;
      currentUser?: JWTPayload | null;
    },
  ) => {
    const db = c.env.DB;
    const conditions: string[] = [];
    const values: unknown[] = [];

    // 默认只显示已审核通过的项目
    if (options.approvedOnly !== false) {
      conditions.push('status = ?');
      values.push('approved');
      conditions.push('is_published = 1');
      conditions.push('visibility = 1');
    } else if (options.status) {
      conditions.push('status = ?');
      values.push(options.status);
    }

    if (options.authorId) {
      conditions.push('author_id = ?');
      values.push(options.authorId);
    }

    if (options.tag) {
      conditions.push('tags LIKE ?');
      values.push(`%"${options.tag}"%`);
    }

    if (options.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)');
      values.push(`%${options.search}%`, `%${options.search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 获取总数
    const countResult = await db
      .prepare(
        `
			SELECT COUNT(*) as total FROM projects ${whereClause}
		`,
      )
      .bind(...values)
      .first<{ total: number }>();

    // 获取列表
    const offset = options.page * options.pageSize;
    const results = await db
      .prepare(
        `
			SELECT p.*, u.global_name
			FROM projects p
			LEFT JOIN users u ON p.author_id = u.id
			${whereClause.replaceAll('author_id', 'p.author_id').replaceAll('status', 'p.status').replaceAll('tags', 'p.tags').replaceAll('name', 'p.name').replaceAll('description', 'p.description')}
			ORDER BY p.created_at DESC
			LIMIT ? OFFSET ?
		`,
      )
      .bind(...values, options.pageSize, offset)
      .all<Record<string, unknown>>();

    return {
      total: countResult?.total || 0,
      page: options.page,
      pageSize: options.pageSize,
      projects: await enrichProjects(c, (results.results || []).map(parseProjectRow), options.currentUser),
    };
  },

  /**
   * 审核项目
   */
  review: async (
    c: AppContext,
    projectId: string,
    reviewerId: string,
    action: 'approve' | 'reject',
    rejectReason?: string,
  ): Promise<void> => {
    const db = c.env.DB;
    const reviewedAt = now();

    if (action === 'approve') {
      await db
        .prepare(
          `
				UPDATE projects SET status = 'approved', reviewed_at = ?, reviewer_id = ?, reject_reason = NULL, updated_at = ?
				WHERE id = ?
			`,
        )
        .bind(reviewedAt, reviewerId, reviewedAt, projectId)
        .run();

      await db.prepare(`UPDATE projects SET latest_approved_at = ? WHERE id = ?`).bind(reviewedAt, projectId).run();
    } else {
      await db
        .prepare(
          `
				UPDATE projects SET status = 'rejected', reviewed_at = ?, reviewer_id = ?, reject_reason = ?, updated_at = ?
				WHERE id = ?
			`,
        )
        .bind(reviewedAt, reviewerId, rejectReason || null, reviewedAt, projectId)
        .run();
    }
  },

  /**
   * 获取待审核项目列表
   */
  getPendingList: async (c: AppContext, page: number = 0, pageSize: number = 20, currentUser?: JWTPayload | null) => {
    const db = c.env.DB;
    const offset = page * pageSize;

    const countResult = await db
      .prepare(
        `
			SELECT COUNT(*) as total FROM projects WHERE status = 'pending'
		`,
      )
      .first<{ total: number }>();

    const results = await db
      .prepare(
        `
			SELECT p.*, u.global_name
			FROM projects p
			LEFT JOIN users u ON p.author_id = u.id
			WHERE p.status = 'pending'
			ORDER BY p.created_at ASC
			LIMIT ? OFFSET ?
		`,
      )
      .bind(pageSize, offset)
      .all<Record<string, unknown>>();

    return {
      total: countResult?.total || 0,
      page,
      pageSize,
      projects: await enrichProjects(c, (results.results || []).map(parseProjectRow), currentUser),
    };
  },

  /**
   * 获取用户的所有项目
   */
  getByAuthor: async (c: AppContext, authorId: string, currentUser?: JWTPayload | null) => {
    const db = c.env.DB;
    const results = await db
      .prepare(
        `
			SELECT p.*, u.global_name
			FROM projects p
			LEFT JOIN users u ON p.author_id = u.id
			WHERE p.author_id = ?
			ORDER BY p.created_at DESC
		`,
      )
      .bind(authorId)
      .all<Record<string, unknown>>();

    const enrichedProjects = await enrichProjects(c, (results.results || []).map(parseProjectRow), currentUser);
    const groupedProjects = new Map<string, (typeof enrichedProjects)[number][]>();

    enrichedProjects.forEach(project => {
      const rootProjectId = project.rootProjectId || project.id;
      const group = groupedProjects.get(rootProjectId) || [];
      group.push(project);
      groupedProjects.set(rootProjectId, group);
    });

    const pickPreferredProject = (projects: (typeof enrichedProjects)[number][]) => {
      const pendingDraft = projects.find(project => project.reviewTarget === 'draft' && project.status === 'pending');
      if (pendingDraft) return pendingDraft;

      const rejectedDraft = projects.find(project => project.reviewTarget === 'draft' && project.status === 'rejected');
      if (rejectedDraft) return rejectedDraft;

      const publishedProject = projects.find(project => project.isPublished);
      if (publishedProject) return publishedProject;

      return (
        [...projects].sort((left, right) => {
          const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
          const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
          return rightTime - leftTime;
        })[0] || null
      );
    };

    return Array.from(groupedProjects.values())
      .map(pickPreferredProject)
      .filter((project): project is NonNullable<typeof project> => Boolean(project))
      .sort((left, right) => {
        const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
        const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
        return rightTime - leftTime;
      });
  },

  setCoverImage: async (c: AppContext, projectId: string, coverImage: string): Promise<void> => {
    await c.env.DB.prepare(`UPDATE projects SET cover_image = ?, updated_at = ? WHERE id = ?`)
      .bind(coverImage, now(), projectId)
      .run();
  },

  toggleLike: async (c: AppContext, projectId: string, userId: string) => {
    const db = c.env.DB;
    const existing = await db
      .prepare(`SELECT 1 as liked FROM project_likes WHERE project_id = ? AND user_id = ?`)
      .bind(projectId, userId)
      .first<{ liked: number }>();

    if (existing) {
      await db.prepare(`DELETE FROM project_likes WHERE project_id = ? AND user_id = ?`).bind(projectId, userId).run();
    } else {
      await db
        .prepare(`INSERT INTO project_likes (project_id, user_id, created_at) VALUES (?, ?, ?)`)
        .bind(projectId, userId, now())
        .run();
    }

    const count = await db
      .prepare(`SELECT COUNT(*) as count FROM project_likes WHERE project_id = ?`)
      .bind(projectId)
      .first<{ count: number }>();

    return { liked: !existing, count: count?.count || 0 };
  },

  toggleSubscribe: async (c: AppContext, projectId: string, userId: string) => {
    const db = c.env.DB;
    const existing = await db
      .prepare(`SELECT 1 as subscribed FROM project_subscribes WHERE project_id = ? AND user_id = ?`)
      .bind(projectId, userId)
      .first<{ subscribed: number }>();

    if (existing) {
      await db
        .prepare(`DELETE FROM project_subscribes WHERE project_id = ? AND user_id = ?`)
        .bind(projectId, userId)
        .run();
    } else {
      await db
        .prepare(`INSERT INTO project_subscribes (project_id, user_id, created_at) VALUES (?, ?, ?)`)
        .bind(projectId, userId, now())
        .run();
    }

    const count = await db
      .prepare(`SELECT COUNT(*) as count FROM project_subscribes WHERE project_id = ?`)
      .bind(projectId)
      .first<{ count: number }>();

    return { subscribed: !existing, count: count?.count || 0 };
  },

  findDraftByPublishedId: async (c: AppContext, publishedProjectId: string) => {
    const result = await c.env.DB.prepare(
      `SELECT p.*, u.global_name FROM projects p LEFT JOIN users u ON p.author_id = u.id WHERE p.published_project_id = ? AND p.review_target = 'draft' ORDER BY CASE p.status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END, p.updated_at DESC LIMIT 1`,
    )
      .bind(publishedProjectId)
      .first<Record<string, unknown>>();
    return result ? parseProjectRow(result) : null;
  },

  createDraftFromPublished: async (
    c: AppContext,
    publishedProjectId: string,
    updates: { name?: string; description?: string; version?: string; tags?: string[]; coverImage?: string },
  ) => {
    const published = await projectDb.get(c, publishedProjectId);
    if (!published) return null;
    const existingDraft = await projectDb.findDraftByPublishedId(c, publishedProjectId);
    if (existingDraft) {
      await projectDb.update(c, existingDraft.id, {
        name: updates.name ?? published.name,
        description: updates.description ?? published.description ?? '',
        version: updates.version ?? published.version,
        tags: updates.tags ?? published.tags,
        coverImage: updates.coverImage ?? published.coverImage ?? undefined,
        status: 'pending',
      });
      await c.env.DB.prepare(
        `UPDATE projects SET reject_reason = NULL, reviewed_at = NULL, reviewer_id = NULL, updated_at = ? WHERE id = ?`,
      )
        .bind(now(), existingDraft.id)
        .run();
      return existingDraft.id;
    }

    const draftId = generateId();
    await projectDb.create(c, {
      id: draftId,
      name: updates.name ?? published.name,
      description: updates.description ?? published.description ?? undefined,
      version: updates.version ?? published.version,
      authorId: published.authorId,
      authorName: published.authorName,
      authorAvatar: published.authorAvatar || '',
      tags: updates.tags ?? published.tags,
      coverImage: updates.coverImage ?? published.coverImage ?? undefined,
      downloadUrl: published.downloadUrl || undefined,
      fileSize: published.fileSize || undefined,
      rootProjectId: published.rootProjectId || published.id,
      publishedProjectId,
      reviewTarget: 'draft',
      visibility: published.visibility,
      isPublished: false,
      latestApprovedAt: published.latestApprovedAt || published.reviewedAt,
    });
    await projectDb.update(c, publishedProjectId, { draftProjectId: draftId });
    return draftId;
  },

  setVisibility: async (c: AppContext, projectId: string, visibility: boolean): Promise<void> => {
    await c.env.DB.prepare(
      `UPDATE projects SET visibility = ?, updated_at = ? WHERE id = ? OR published_project_id = ? OR draft_project_id = ?`,
    )
      .bind(visibility ? 1 : 0, now(), projectId, projectId, projectId)
      .run();
  },

  logAdminAction: async (
    c: AppContext,
    payload: {
      action: string;
      targetType: string;
      targetId?: string;
      actorId: string;
      actorName: string;
      detail?: Record<string, unknown> | null;
    },
  ) => {
    await c.env.DB.prepare(
      `INSERT INTO admin_action_logs (id, action, target_type, target_id, actor_id, actor_name, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        generateId(),
        payload.action,
        payload.targetType,
        payload.targetId || null,
        payload.actorId,
        payload.actorName,
        payload.detail ? JSON.stringify(payload.detail) : null,
        now(),
      )
      .run();
  },

  getAdminLogs: async (c: AppContext, limit: number = 100) => {
    const results = await c.env.DB.prepare(`SELECT * FROM admin_action_logs ORDER BY created_at DESC LIMIT ?`)
      .bind(limit)
      .all<Record<string, unknown>>();
    return (results.results || []).map(row => ({
      id: String(row.id),
      action: String(row.action),
      targetType: String(row.target_type),
      targetId: row.target_id ? String(row.target_id) : undefined,
      actorId: String(row.actor_id),
      actorName: String(row.actor_name),
      detail: row.detail ? String(row.detail) : undefined,
      createdAt: String(row.created_at),
    }));
  },

  incrementDownloads: async (c: AppContext, projectId: string): Promise<void> => {
    try {
      await c.env.DB.prepare(
        `UPDATE projects SET downloads_count = COALESCE(downloads_count, 0) + 1, updated_at = ? WHERE id = ? OR published_project_id = ? OR draft_project_id = ?`,
      )
        .bind(now(), projectId, projectId, projectId)
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('no such column: downloads_count')) {
        throw error;
      }
      console.warn('downloads_count column missing, skip incrementDownloads');
    }
  },
};

async function enrichProjects(
  c: AppContext,
  projects: ReturnType<typeof parseProjectRow>[],
  currentUser?: JWTPayload | null,
) {
  if (projects.length === 0) {
    return projects;
  }

  const projectIds = projects.map(project => project.id);
  const placeholders = projectIds.map(() => '?').join(', ');
  let statsRows:
    | {
        results?: Array<{
          project_id: string;
          downloads_count: number;
          likes_count: number;
          subscribes_count: number;
          user_liked: number;
          user_subscribed: number;
        }>;
      }
    | undefined;
  try {
    statsRows = await c.env.DB.prepare(
      `
          SELECT
            p.id as project_id,
            COALESCE(p.downloads_count, 0) as downloads_count,
            COALESCE(pl.likes_count, 0) as likes_count,
            COALESCE(ps.subscribes_count, 0) as subscribes_count,
            CASE WHEN ul.project_id IS NOT NULL THEN 1 ELSE 0 END as user_liked,
            CASE WHEN us.project_id IS NOT NULL THEN 1 ELSE 0 END as user_subscribed
          FROM projects p
          LEFT JOIN (
            SELECT project_id, COUNT(*) as likes_count FROM project_likes GROUP BY project_id
          ) pl ON pl.project_id = p.id
          LEFT JOIN (
            SELECT project_id, COUNT(*) as subscribes_count FROM project_subscribes GROUP BY project_id
          ) ps ON ps.project_id = p.id
          LEFT JOIN project_likes ul ON ul.project_id = p.id AND ul.user_id = ?
          LEFT JOIN project_subscribes us ON us.project_id = p.id AND us.user_id = ?
          WHERE p.id IN (${placeholders})
        `,
    )
      .bind(currentUser?.userId || '', currentUser?.userId || '', ...projectIds)
      .all<{
        project_id: string;
        downloads_count: number;
        likes_count: number;
        subscribes_count: number;
        user_liked: number;
        user_subscribed: number;
      }>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('no such column: p.downloads_count')) {
      throw error;
    }

    console.warn('downloads_count column missing, fallback stats query activated');
    statsRows = await c.env.DB.prepare(
      `
          SELECT
            p.id as project_id,
            0 as downloads_count,
            COALESCE(pl.likes_count, 0) as likes_count,
            COALESCE(ps.subscribes_count, 0) as subscribes_count,
            CASE WHEN ul.project_id IS NOT NULL THEN 1 ELSE 0 END as user_liked,
            CASE WHEN us.project_id IS NOT NULL THEN 1 ELSE 0 END as user_subscribed
          FROM projects p
          LEFT JOIN (
            SELECT project_id, COUNT(*) as likes_count FROM project_likes GROUP BY project_id
          ) pl ON pl.project_id = p.id
          LEFT JOIN (
            SELECT project_id, COUNT(*) as subscribes_count FROM project_subscribes GROUP BY project_id
          ) ps ON ps.project_id = p.id
          LEFT JOIN project_likes ul ON ul.project_id = p.id AND ul.user_id = ?
          LEFT JOIN project_subscribes us ON us.project_id = p.id AND us.user_id = ?
          WHERE p.id IN (${placeholders})
        `,
    )
      .bind(currentUser?.userId || '', currentUser?.userId || '', ...projectIds)
      .all<{
        project_id: string;
        downloads_count: number;
        likes_count: number;
        subscribes_count: number;
        user_liked: number;
        user_subscribed: number;
      }>();
  }

  const statsMap = new Map((statsRows.results || []).map(row => [row.project_id, row]));

  return projects.map(project => {
    const stats = statsMap.get(project.id);
    return {
      ...project,
      downloadUrl: project.downloadUrl
        ? r2Storage.getProxyUrl(c, project.downloadUrl.replace(/^.*\/api\/files\//, ''))
        : null,
      coverImage: project.coverImage
        ? r2Storage.getProxyUrl(c, project.coverImage.replace(/^.*\/api\/files\//, ''))
        : null,
      downloadsCount: Number(stats?.downloads_count || project.downloadsCount || 0),
      likesCount: stats?.likes_count || 0,
      subscribesCount: stats?.subscribes_count || 0,
      userLiked: Boolean(stats?.user_liked),
      userSubscribed: Boolean(stats?.user_subscribed),
    };
  });
}

async function enrichProject(
  c: AppContext,
  project: ReturnType<typeof parseProjectRow>,
  currentUser?: JWTPayload | null,
) {
  const [result] = await enrichProjects(c, [project], currentUser);
  return result;
}

/**
 * 解析项目数据库行
 */
function parseProjectRow(row: Record<string, unknown>) {
  let parsedTags: string[] = [];
  try {
    const rawTags = row.tags;
    parsedTags = typeof rawTags === 'string' && rawTags.trim() ? JSON.parse(rawTags) : [];
    if (!Array.isArray(parsedTags)) {
      parsedTags = [];
    }
  } catch {
    parsedTags = [];
  }

  return {
    id: row.id as string,
    rootProjectId: ((row.root_project_id as string | null) || (row.id as string)) as string,
    publishedProjectId: row.published_project_id as string | null,
    draftProjectId: row.draft_project_id as string | null,
    name: row.name as string,
    description: row.description as string | null,
    version: row.version as string,
    authorId: row.author_id as string,
    authorName: row.author_name as string,
    authorGlobalName: ((row.global_name as string | null) || (row.author_name as string)) as string,
    authorAvatar: row.author_avatar as string | null,
    status: row.status as 'pending' | 'approved' | 'rejected',
    downloadUrl: row.download_url as string | null,
    fileSize: row.file_size as number | null,
    downloadsCount: Number(row.downloads_count ?? 0),
    tags: parsedTags,
    coverImage: row.cover_image as string | null,
    worldbookEntriesPreview: [],
    regexEntriesPreview: [],
    likesCount: 0,
    subscribesCount: 0,
    userLiked: false,
    userSubscribed: false,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    reviewedAt: row.reviewed_at as string | null,
    reviewerId: row.reviewer_id as string | null,
    rejectReason: row.reject_reason as string | null,
    reviewTarget: ((row.review_target as string | null) || 'project') as ProjectReviewTarget,
    visibility: Number(row.visibility ?? 1) === 1,
    isPublished: Number(row.is_published ?? 0) === 1,
    hasPendingDraft: Boolean(row.draft_project_id),
    latestApprovedAt: row.latest_approved_at as string | null,
  };
}
