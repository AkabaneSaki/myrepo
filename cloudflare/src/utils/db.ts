import type { AppContext, ProjectReviewTarget } from '../types';
import type { JWTPayload } from './jwt';
import { r2Storage } from './r2';
import { bumpProjectVersionWithLegacyFallback, classifyProjectVersionTransition } from './version.js';

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
        avatarUrl: r.avatar ? `https://cdn.discordapp.com/avatars/${r.id}/${r.avatar}.webp?size=100` : null,
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
      draftRevision?: number;
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
				draft_project_id, review_target, draft_revision, visibility, is_published, latest_approved_at, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        project.draftRevision || 1,
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
      draftRevision?: number;
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
    if (updates.draftRevision !== undefined) {
      setClauses.push('draft_revision = ?');
      values.push(updates.draftRevision);
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

  bumpDraftRevision: async (c: AppContext, projectId: string): Promise<void> => {
    await c.env.DB.prepare(
      `UPDATE projects
       SET draft_revision = draft_revision + 1,
           status = 'pending',
           reject_reason = NULL,
           reviewed_at = NULL,
           reviewer_id = NULL,
           updated_at = ?
       WHERE id = ?`,
    )
      .bind(now(), projectId)
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
      sort?: 'published' | 'updated' | 'likes' | 'subscribes' | 'downloads';
      approvedOnly?: boolean;
      currentUser?: JWTPayload | null;
    },
  ) => {
    const db = c.env.DB;
    const conditions: string[] = [];
    const values: unknown[] = [];

    // 默认只显示已审核通过的项目
    if (options.approvedOnly !== false) {
      conditions.push('p.status = ?');
      values.push('approved');
      conditions.push('p.is_published = 1');
      conditions.push('p.visibility = 1');
    } else if (options.status) {
      conditions.push('p.status = ?');
      values.push(options.status);
    }

    if (options.authorId) {
      conditions.push('p.author_id = ?');
      values.push(options.authorId);
    }

    if (options.tag) {
      conditions.push('p.tags LIKE ?');
      values.push(`%"${options.tag}"%`);
    }

    const searchTerm = options.search?.trim();
    if (searchTerm) {
      conditions.push('(p.name LIKE ? OR p.description LIKE ? OR p.tags LIKE ? OR p.author_name LIKE ? OR u.global_name LIKE ?)');
      const searchPattern = `%${searchTerm}%`;
      values.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const listWhereClause = whereClause;





    const sortMode = options.sort || 'published';
    const orderBy = (() => {
      switch (sortMode) {
        case 'updated':
          return 'p.updated_at DESC, p.created_at DESC';
        case 'downloads':
          return 'COALESCE(p.downloads_count, 0) DESC, p.created_at DESC';
        case 'likes':
          return 'COALESCE(p.likes_count, 0) DESC, p.created_at DESC';
        case 'subscribes':
          // Legacy clients may still request this sort. Subscription is now an install/update-notification state,
          // not a public popularity metric, so use downloads as the closest cheap fallback.
          return 'COALESCE(p.downloads_count, 0) DESC, p.created_at DESC';
        case 'published':
        default:
          return 'p.latest_approved_at DESC, p.updated_at DESC';
      }
    })();
    // 获取当前页，并多取 1 条用于判断是否还有下一批；无需额外 COUNT(*)。
    const offset = options.page * options.pageSize;
    const fetchLimit = options.pageSize + 1;
    const results = await db
      .prepare(
        `
			SELECT p.*, u.global_name
			FROM projects p
			LEFT JOIN users u ON p.author_id = u.id
			${listWhereClause}
			ORDER BY ${orderBy}
			LIMIT ? OFFSET ?
		`,
      )
      .bind(...values, fetchLimit, offset)
      .all<Record<string, unknown>>();

    const rows = results.results || [];
    const hasMore = rows.length > options.pageSize;
    const pageRows = hasMore ? rows.slice(0, options.pageSize) : rows;

    return {
      hasMore,
      page: options.page,
      pageSize: options.pageSize,
      projects: await enrichProjects(c, pageRows.map(parseProjectRow), options.currentUser),
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
  ): Promise<string> => {
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

    return reviewedAt;
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
			SELECT p.*, u.global_name, published.version AS published_version
			FROM projects p
			LEFT JOIN users u ON p.author_id = u.id
			LEFT JOIN projects published ON p.published_project_id = published.id
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
      const publishedProject = projects.find(project => project.isPublished);
      const withPublishedVersion = (project: (typeof enrichedProjects)[number] | undefined) =>
        project && project.reviewTarget === 'draft' && publishedProject
          ? { ...project, publishedVersion: publishedProject.version }
          : project;

      const pendingDraft = projects.find(project => project.reviewTarget === 'draft' && project.status === 'pending');
      if (pendingDraft) return withPublishedVersion(pendingDraft);

      const rejectedDraft = projects.find(project => project.reviewTarget === 'draft' && project.status === 'rejected');
      if (rejectedDraft) return withPublishedVersion(rejectedDraft);

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

    const counter = await db
      .prepare(`SELECT COALESCE(likes_count, 0) as count FROM projects WHERE id = ?`)
      .bind(projectId)
      .first<{ count: number }>();

    return { liked: !existing, count: Number(counter?.count || 0) };
  },

  getSubscribedProjectIds: async (c: AppContext, userId: string) => {
    const result = await c.env.DB.prepare(`SELECT project_id FROM project_subscribes WHERE user_id = ?`)
      .bind(userId)
      .all<{ project_id: string }>();
    return (result.results || []).map(row => row.project_id);
  },

  setSubscribe: async (c: AppContext, projectId: string, userId: string, subscribed: boolean) => {
    const db = c.env.DB;
    if (subscribed) {
      await db
        .prepare(`INSERT OR IGNORE INTO project_subscribes (project_id, user_id, created_at) VALUES (?, ?, ?)`)
        .bind(projectId, userId, now())
        .run();
    } else {
      await db
        .prepare(`DELETE FROM project_subscribes WHERE project_id = ? AND user_id = ?`)
        .bind(projectId, userId)
        .run();
    }

    return { subscribed, count: 0 };
  },

  toggleSubscribe: async (c: AppContext, projectId: string, userId: string) => {
    const existing = await c.env.DB
      .prepare(`SELECT 1 as subscribed FROM project_subscribes WHERE project_id = ? AND user_id = ?`)
      .bind(projectId, userId)
      .first<{ subscribed: number }>();

    return projectDb.setSubscribe(c, projectId, userId, !existing);
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
      const nextVersion =
        updates.version ??
        (classifyProjectVersionTransition(published.version, existingDraft.version)
          ? existingDraft.version
          : bumpProjectVersionWithLegacyFallback(published.version, 'patch'));
      await projectDb.update(c, existingDraft.id, {
        name: updates.name ?? existingDraft.name,
        description: updates.description ?? existingDraft.description ?? '',
        version: nextVersion,
        tags: updates.tags ?? existingDraft.tags,
        coverImage: updates.coverImage ?? existingDraft.coverImage ?? undefined,
      });
      await projectDb.bumpDraftRevision(c, existingDraft.id);
      return existingDraft.id;
    }

    const draftId = generateId();
    await projectDb.create(c, {
      id: draftId,
      name: updates.name ?? published.name,
      description: updates.description ?? published.description ?? undefined,
      version: updates.version ?? bumpProjectVersionWithLegacyFallback(published.version, 'patch'),
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
      draftRevision: 1,
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
        `UPDATE projects SET downloads_count = COALESCE(downloads_count, 0) + 1 WHERE id = ?`,
      )
        .bind(projectId)
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

  const likedProjectIds = new Set<string>();


  if (currentUser?.userId) {
    const projectIds = projects.map(project => project.id);
    const projectIdsJson = JSON.stringify(projectIds);
    const likes = await c.env.DB.prepare(
      `
        SELECT project_id
        FROM project_likes
        WHERE user_id = ?2 AND project_id IN (SELECT value FROM json_each(?1))
      `,
    )
      .bind(projectIdsJson, currentUser.userId)
      .all<{ project_id: string }>();

    for (const row of likes.results || []) {
      likedProjectIds.add(row.project_id);
    }
  }

  return projects.map(project => ({
    ...project,
    downloadUrl: project.downloadUrl
      ? r2Storage.getProxyUrl(c, project.downloadUrl.replace(/^.*\/api\/files\//, ''))
      : null,
    coverImage: project.coverImage
      ? r2Storage.getProxyUrl(c, project.coverImage.replace(/^.*\/api\/files\//, ''))
      : null,
    downloadsCount: Number(project.downloadsCount || 0),
    likesCount: Number(project.likesCount || 0),
    // Subscription is an install/update-notification state, not a public popularity metric.
    subscribesCount: 0,
    userLiked: likedProjectIds.has(project.id),
    userSubscribed: false,
  }));
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
    publishedVersion: row.published_version as string | null,
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
    likesCount: Number(row.likes_count ?? 0),
    subscribesCount: Number(row.subscribes_count ?? 0),
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
    draftRevision: Math.max(1, Number(row.draft_revision ?? 1)),
    latestApprovedAt: row.latest_approved_at as string | null,
  };
}
