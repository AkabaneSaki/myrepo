import type { AppContext, ProjectCompatibilityStatus, ProjectReviewTarget, ProjectStatus } from '../types';
import {
  MAX_DISPLAY_TAGS,
  getProjectFacetTagValues,
  normalizeCustomTags,
  normalizeDisplayTags,
  normalizeExtensionType,
  normalizeProjectFacets,
  resolveProjectType,
  type ExtensionType,
  type ProjectFacets,
  type ProjectType,
} from '../config/project-taxonomy';
import type { JWTPayload } from './jwt';
import { getReadyProjectRankingBoard } from './project-daily-rankings';
import { r2Storage } from './r2';
import { bumpProjectVersionWithLegacyFallback, normalizeProjectVersionBase, parseProjectVersion } from './version.js';

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
      precautions?: string | null;
      version: string;
      versionLabel?: string | null;
      characterReferenceId?: string | null;
      builtForReferenceVersionId?: string | null;
      testedThroughReferenceVersionId?: string | null;
      compatibilityStatus?: ProjectCompatibilityStatus | null;
      compatibilityKnownIncompatible?: boolean;
      compatibilityNote?: string | null;
      compatibilityGraceUntil?: string | null;
      compatibilityUpdatedAt?: string | null;
      conflictsWithOriginal?: boolean;
      originalConflictReferenceItemIds?: string[];
      authorId: string;
      authorName: string;
      authorAvatar: string;
      projectType: ProjectType;
      extensionType?: ExtensionType | null;
      facets?: ProjectFacets;
      customTags?: string[];
      displayTags?: string[];
      tags?: string[];
      coverImage?: string;
      coverPositionX?: number;
      coverPositionY?: number;
      coverZoom?: number;
      downloadUrl?: string;
      fileSize?: number;
      hasEjs?: boolean;
      hasCharacterArtwork?: boolean;
      rootProjectId?: string;
      publishedProjectId?: string | null;
      draftProjectId?: string | null;
      reviewTarget?: ProjectReviewTarget;
      draftRevision?: number;
      visibility?: boolean;
      isPublished?: boolean;
      latestApprovedAt?: string | null;
      status?: ProjectStatus;
    },
  ): Promise<void> => {
    const db = c.env.DB;
    await db
      .prepare(
        `
			INSERT INTO projects (
				id, name, description, precautions, version, version_label, author_id, author_name, author_avatar,
				status, download_url, file_size, has_ejs, has_character_artwork, project_type, extension_type, facets, custom_tags, display_tags, tags, cover_image, cover_position_x, cover_position_y, cover_zoom, root_project_id, published_project_id,
				draft_project_id, review_target, draft_revision, visibility, is_published, latest_approved_at,
				character_reference_id, built_for_reference_version_id, tested_through_reference_version_id,
				compatibility_status, compatibility_known_incompatible, compatibility_note, compatibility_grace_until, compatibility_updated_at,
				conflicts_with_original, original_conflict_reference_item_ids, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
      )
      .bind(
        project.id,
        project.name,
        project.description || null,
        project.precautions || null,
        project.version,
        project.versionLabel || null,
        project.authorId,
        project.authorName,
        project.authorAvatar,
        project.status || 'pending',
        project.downloadUrl || null,
        project.fileSize || null,
        project.hasEjs ? 1 : 0,
        project.hasCharacterArtwork ? 1 : 0,
        project.projectType,
        project.extensionType || null,
        JSON.stringify(project.facets || {}),
        JSON.stringify(project.customTags || []),
        JSON.stringify(project.displayTags || []),
        JSON.stringify(project.tags || []),
        project.coverImage || null,
        project.coverPositionX ?? 50,
        project.coverPositionY ?? 50,
        project.coverZoom ?? 1,
        project.rootProjectId || project.id,
        project.publishedProjectId || null,
        project.draftProjectId || null,
        project.reviewTarget || 'project',
        project.draftRevision || 1,
        project.visibility === false ? 0 : 1,
        project.isPublished ? 1 : 0,
        project.latestApprovedAt || null,
        project.characterReferenceId || null,
        project.builtForReferenceVersionId || null,
        project.testedThroughReferenceVersionId || null,
        project.compatibilityStatus || null,
        project.compatibilityKnownIncompatible ? 1 : 0,
        project.compatibilityNote || null,
        project.compatibilityGraceUntil || null,
        project.compatibilityUpdatedAt || null,
        project.conflictsWithOriginal ? 1 : 0,
        JSON.stringify(project.originalConflictReferenceItemIds || []),
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
   * 批量获取指定项目摘要。用于本地已安装项目补全，避免逐项目 HTTP/D1 查询。
   */
  getMany: async (c: AppContext, projectIds: string[], currentUser?: JWTPayload | null) => {
    const uniqueProjectIds = Array.from(new Set(projectIds.filter(Boolean))).slice(0, 50);
    if (uniqueProjectIds.length === 0) return [];

    const results = await c.env.DB
      .prepare(
        `
          SELECT p.*
          FROM json_each(?1) requested
          JOIN projects p ON p.id = requested.value
        `,
      )
      .bind(JSON.stringify(uniqueProjectIds))
      .all<Record<string, unknown>>();

    return enrichProjects(c, (results.results || []).map(parseProjectRow), currentUser);
  },

  /**
   * Resolve DLC Repair identities without touching the public fuzzy-search path.
   * One whole batch of up to 50 candidates uses at most two indexed D1 reads.
   */
  resolvePublicRepairCandidates: async (
    c: AppContext,
    projectIds: string[],
    normalizedNames: string[],
  ) => {
    const uniqueProjectIds = Array.from(
      new Set(projectIds.map(value => String(value || '').trim()).filter(Boolean)),
    ).slice(0, 50);
    const uniqueNames = Array.from(
      new Set(normalizedNames.map(value => String(value || '').trim().toLowerCase()).filter(Boolean)),
    ).slice(0, 50);
    const byId: ReturnType<typeof parseProjectRow>[] = [];
    const byName: ReturnType<typeof parseProjectRow>[] = [];

    if (uniqueProjectIds.length > 0) {
      const placeholders = uniqueProjectIds.map(() => '?').join(', ');
      const results = await c.env.DB.prepare(
        `
          SELECT p.*, u.global_name
          FROM projects p INDEXED BY idx_projects_public_id
          LEFT JOIN users u ON p.author_id = u.id
          WHERE p.id IN (${placeholders})
            AND p.status = 'approved'
            AND p.is_published = 1
            AND p.visibility = 1
        `,
      )
        .bind(...uniqueProjectIds)
        .all<Record<string, unknown>>();
      byId.push(...(results.results || []).map(parseProjectRow));
    }

    if (uniqueNames.length > 0) {
      const placeholders = uniqueNames.map(() => '?').join(', ');
      const results = await c.env.DB.prepare(
        `
          SELECT p.*, u.global_name
          FROM projects p INDEXED BY idx_projects_public_normalized_name
          LEFT JOIN users u ON p.author_id = u.id
          WHERE lower(trim(p.name)) IN (${placeholders})
            AND p.status = 'approved'
            AND p.is_published = 1
            AND p.visibility = 1
        `,
      )
        .bind(...uniqueNames)
        .all<Record<string, unknown>>();
      byName.push(...(results.results || []).map(parseProjectRow));
    }

    return { byId, byName };
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
      precautions?: string | null;
      version?: string;
      versionLabel?: string | null;
      characterReferenceId?: string | null;
      builtForReferenceVersionId?: string | null;
      testedThroughReferenceVersionId?: string | null;
      compatibilityStatus?: ProjectCompatibilityStatus | null;
      compatibilityKnownIncompatible?: boolean;
      compatibilityNote?: string | null;
      compatibilityGraceUntil?: string | null;
      compatibilityUpdatedAt?: string | null;
      conflictsWithOriginal?: boolean;
      originalConflictReferenceItemIds?: string[];
      projectType?: ProjectType;
      extensionType?: ExtensionType | null;
      facets?: ProjectFacets;
      customTags?: string[];
      displayTags?: string[];
      tags?: string[];
      coverImage?: string;
      coverPositionX?: number;
      coverPositionY?: number;
      coverZoom?: number;
      downloadUrl?: string;
      fileSize?: number;
      hasEjs?: boolean;
      hasCharacterArtwork?: boolean;
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
    if (updates.precautions !== undefined) {
      setClauses.push('precautions = ?');
      values.push(updates.precautions);
    }
    if (updates.version !== undefined) {
      setClauses.push('version = ?');
      values.push(updates.version);
    }
    if (updates.versionLabel !== undefined) {
      setClauses.push('version_label = ?');
      values.push(updates.versionLabel);
    }
    if (updates.characterReferenceId !== undefined) {
      setClauses.push('character_reference_id = ?');
      values.push(updates.characterReferenceId);
    }
    if (updates.builtForReferenceVersionId !== undefined) {
      setClauses.push('built_for_reference_version_id = ?');
      values.push(updates.builtForReferenceVersionId);
    }
    if (updates.testedThroughReferenceVersionId !== undefined) {
      setClauses.push('tested_through_reference_version_id = ?');
      values.push(updates.testedThroughReferenceVersionId);
    }
    if (updates.compatibilityStatus !== undefined) {
      setClauses.push('compatibility_status = ?');
      values.push(updates.compatibilityStatus);
    }
    if (updates.compatibilityKnownIncompatible !== undefined) {
      setClauses.push('compatibility_known_incompatible = ?');
      values.push(updates.compatibilityKnownIncompatible ? 1 : 0);
    }
    if (updates.compatibilityNote !== undefined) {
      setClauses.push('compatibility_note = ?');
      values.push(updates.compatibilityNote);
    }
    if (updates.compatibilityGraceUntil !== undefined) {
      setClauses.push('compatibility_grace_until = ?');
      values.push(updates.compatibilityGraceUntil);
    }
    if (updates.compatibilityUpdatedAt !== undefined) {
      setClauses.push('compatibility_updated_at = ?');
      values.push(updates.compatibilityUpdatedAt);
    }
    if (updates.conflictsWithOriginal !== undefined) {
      setClauses.push('conflicts_with_original = ?');
      values.push(updates.conflictsWithOriginal ? 1 : 0);
    }
    if (updates.originalConflictReferenceItemIds !== undefined) {
      setClauses.push('original_conflict_reference_item_ids = ?');
      values.push(JSON.stringify(updates.originalConflictReferenceItemIds));
    }
    if (updates.projectType !== undefined) {
      setClauses.push('project_type = ?');
      values.push(updates.projectType);
    }
    if (updates.extensionType !== undefined) {
      setClauses.push('extension_type = ?');
      values.push(updates.extensionType);
    }
    if (updates.facets !== undefined) {
      setClauses.push('facets = ?');
      values.push(JSON.stringify(updates.facets));
    }
    if (updates.customTags !== undefined) {
      setClauses.push('custom_tags = ?');
      values.push(JSON.stringify(updates.customTags));
    }
    if (updates.displayTags !== undefined) {
      setClauses.push('display_tags = ?');
      values.push(JSON.stringify(updates.displayTags));
    }
    if (updates.tags !== undefined) {
      setClauses.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.coverImage !== undefined) {
      setClauses.push('cover_image = ?');
      values.push(updates.coverImage);
    }
    if (updates.coverPositionX !== undefined) {
      setClauses.push('cover_position_x = ?');
      values.push(updates.coverPositionX);
    }
    if (updates.coverPositionY !== undefined) {
      setClauses.push('cover_position_y = ?');
      values.push(updates.coverPositionY);
    }
    if (updates.coverZoom !== undefined) {
      setClauses.push('cover_zoom = ?');
      values.push(updates.coverZoom);
    }
    if (updates.downloadUrl !== undefined) {
      setClauses.push('download_url = ?');
      values.push(updates.downloadUrl);
    }
    if (updates.fileSize !== undefined) {
      setClauses.push('file_size = ?');
      values.push(updates.fileSize);
    }
    if (updates.hasEjs !== undefined) {
      setClauses.push('has_ejs = ?');
      values.push(updates.hasEjs ? 1 : 0);
    }
    if (updates.hasCharacterArtwork !== undefined) {
      setClauses.push('has_character_artwork = ?');
      values.push(updates.hasCharacterArtwork ? 1 : 0);
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
        .prepare(`UPDATE projects SET draft_project_id = NULL, updated_at = ? WHERE id = ? AND draft_project_id = ?`)
        .bind(now(), project.published_project_id, projectId)
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
      projectType?: ProjectType;
      tag?: string;
      tags?: string[];
      search?: string;
      sort?: 'discover' | 'published' | 'rating' | 'updated' | 'likes' | 'subscribes' | 'downloads';
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

    if (options.projectType) {
      conditions.push('p.project_type = ?');
      values.push(options.projectType);
    }

    const tagFilters = Array.from(new Set([
      ...(Array.isArray(options.tags) ? options.tags : []),
      ...(options.tag ? [options.tag] : []),
    ].map(value => String(value || '').trim()).filter(Boolean))).slice(0, 12);
    tagFilters.forEach(tag => {
      conditions.push('(p.facets LIKE ? OR p.custom_tags LIKE ? OR p.tags LIKE ? OR p.extension_type = ?)');
      const tagPattern = `%"${tag}"%`;
      values.push(tagPattern, tagPattern, tagPattern, tag);
    });

    const rawSearchTerm = options.search?.trim();
    const normalizedSearchTerm = rawSearchTerm
      ? rawSearchTerm
          .replace(/[\u0000-\u001f\u007f]/g, ' ')
          .replace(/[%_]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
    const searchTerm = Array.from(normalizedSearchTerm).slice(0, 20).join('');
    if (searchTerm) {
      conditions.push('(p.name LIKE ? OR p.description LIKE ? OR p.project_type LIKE ? OR p.extension_type LIKE ? OR p.custom_tags LIKE ? OR p.facets LIKE ? OR p.tags LIKE ? OR p.author_name LIKE ? OR u.global_name LIKE ?)');
      const searchPattern = `%${searchTerm}%`;
      values.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const listWhereClause = whereClause;





    const sortMode = options.sort || 'published';
    const hasRankingSearchFilters = Boolean(options.authorId || searchTerm || tagFilters.length > 0);
    const rankingKind: 'discover' | 'rating' | null =
      options.approvedOnly !== false && !hasRankingSearchFilters && (sortMode === 'discover' || sortMode === 'rating')
        ? sortMode
        : null;
    const orderBy = (() => {
      switch (sortMode) {
        case 'updated':
          return 'p.updated_at DESC, p.created_at DESC';
        case 'downloads':
          return 'p.downloads_count DESC, p.created_at DESC';
        case 'likes':
          return 'p.likes_count DESC, p.created_at DESC';
        case 'subscribes':
          // Legacy clients may still request this sort. Subscription is now an install/update-notification state,
          // not a public popularity metric, so use downloads as the closest cheap fallback.
          return 'p.downloads_count DESC, p.created_at DESC';
        case 'published':
        default:
          return 'p.latest_approved_at DESC, p.updated_at DESC';
      }
    })();
    const offset = options.page * options.pageSize;
    const fetchLimit = options.pageSize + 1;

    if (rankingKind) {
      const board = await getReadyProjectRankingBoard(c);
      if (board) {
        const totalCount = options.projectType
          ? Number(board.typeCounts[options.projectType] || 0)
          : board.projectCount;
        const startRank = options.page * options.pageSize + 1;
        const endRank = startRank + options.pageSize - 1;
        if (totalCount === 0 || startRank > totalCount) {
          return {
            hasMore: false,
            page: options.page,
            pageSize: options.pageSize,
            projects: [],
          };
        }

        const rankColumn = rankingKind === 'discover'
          ? options.projectType ? 'discover_type_rank' : 'discover_rank'
          : options.projectType ? 'rating_type_rank' : 'rating_rank';
        const typeClause = options.projectType ? 'AND r.project_type = ?' : '';
        const rankValues: unknown[] = [board.rankingDay];
        if (options.projectType) rankValues.push(options.projectType);
        rankValues.push(startRank, endRank);

        // Page jumps read one bounded indexed rank range. Hidden/deleted projects may
        // leave a temporary hole; hasMore is based on immutable board counts instead.
        const rankingResults = await db
          .prepare(
            `SELECT p.*, u.global_name
             FROM project_daily_rankings r
             JOIN projects p ON p.id = r.project_id
             LEFT JOIN users u ON p.author_id = u.id
             WHERE r.ranking_day = ?
               ${typeClause}
               AND r.${rankColumn} BETWEEN ? AND ?
               AND p.status = 'approved'
               AND p.is_published = 1
               AND p.visibility = 1
             ORDER BY r.${rankColumn} ASC`,
          )
          .bind(...rankValues)
          .all<Record<string, unknown>>();
        return {
          hasMore: endRank < totalCount,
          page: options.page,
          pageSize: options.pageSize,
          projects: await enrichProjects(c, (rankingResults.results || []).map(parseProjectRow), options.currentUser),
        };
      }
    }

    // Search/tag/author filters intentionally bypass the ranking board. Keeping
    // wildcard filtering off the rank hot path prevents a ranked page request
    // from turning into a whole-board scan.
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
    rejectReason: string | undefined,
    expectedRevision: number,
  ): Promise<string | null> => {
    const db = c.env.DB;
    const reviewedAt = now();

    const result = action === 'approve'
      ? await db
          .prepare(
            `UPDATE projects
             SET status = 'approved', reviewed_at = ?, reviewer_id = ?, reject_reason = NULL,
                 latest_approved_at = ?, updated_at = ?
             WHERE id = ? AND status = 'pending' AND draft_revision = ?`,
          )
          .bind(reviewedAt, reviewerId, reviewedAt, reviewedAt, projectId, expectedRevision)
          .run()
      : await db
          .prepare(
            `UPDATE projects
             SET status = 'rejected', reviewed_at = ?, reviewer_id = ?, reject_reason = ?, updated_at = ?
             WHERE id = ? AND status = 'pending' AND draft_revision = ?`,
          )
          .bind(reviewedAt, reviewerId, rejectReason || null, reviewedAt, projectId, expectedRevision)
          .run();

    return Number(result.meta?.changes || 0) === 1 ? reviewedAt : null;
  },

  restoreApprovedReviewToPending: async (
    c: AppContext,
    projectId: string,
    reviewerId: string,
    expectedRevision: number,
    reviewedAt: string,
    previousLatestApprovedAt: string | null,
  ): Promise<boolean> => {
    const result = await c.env.DB.prepare(
      `UPDATE projects
       SET status = 'pending', reviewed_at = NULL, reviewer_id = NULL, reject_reason = NULL,
           latest_approved_at = ?, updated_at = ?
       WHERE id = ? AND status = 'approved' AND draft_revision = ? AND reviewer_id = ? AND reviewed_at = ?`,
    )
      .bind(previousLatestApprovedAt, now(), projectId, expectedRevision, reviewerId, reviewedAt)
      .run();

    return Number(result.meta?.changes || 0) === 1;
  },

  /**
   * 获取待审核项目列表
   */
  getPendingList: async (
    c: AppContext,
    page: number = 0,
    pageSize: number = 20,
    currentUser?: JWTPayload | null,
    options: { sort?: 'oldest' | 'latest'; projectType?: ProjectType } = {},
  ) => {
    const db = c.env.DB;
    const offset = page * pageSize;
    const conditions = ["p.status = 'pending'"];
    const filterValues: unknown[] = [];
    if (options.projectType) {
      conditions.push('p.project_type = ?');
      filterValues.push(options.projectType);
    }
    const whereClause = conditions.join(' AND ');
    const orderBy = options.sort === 'latest' ? 'p.created_at DESC' : 'p.created_at ASC';

    const countResult = await db
      .prepare(`SELECT COUNT(*) as total FROM projects p WHERE ${whereClause}`)
      .bind(...filterValues)
      .first<{ total: number }>();

    const results = await db
      .prepare(
        `
			SELECT p.*, u.global_name, published.version AS published_version
			FROM projects p
			LEFT JOIN users u ON p.author_id = u.id
			LEFT JOIN projects published ON p.published_project_id = published.id
			WHERE ${whereClause}
			ORDER BY ${orderBy}
			LIMIT ? OFFSET ?
		`,
      )
      .bind(...filterValues, pageSize, offset)
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
          ? {
              ...project,
              publishedVersion: publishedProject.version,
              likesCount: publishedProject.likesCount,
              downloadsCount: publishedProject.downloadsCount,
              userLiked: publishedProject.userLiked,
            }
          : project;

      const currentDraft = publishedProject?.draftProjectId
        ? projects.find(project => project.id === publishedProject.draftProjectId)
        : null;
      if (currentDraft) return withPublishedVersion(currentDraft);
      if (publishedProject) return publishedProject;

      const pendingDraft = projects.find(project => project.reviewTarget === 'draft' && project.status === 'pending');
      if (pendingDraft) return withPublishedVersion(pendingDraft);

      const rejectedDraft = projects.find(project => project.reviewTarget === 'draft' && project.status === 'rejected');
      if (rejectedDraft) return withPublishedVersion(rejectedDraft);

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

  setCoverPresentation: async (
    c: AppContext,
    projectIds: string[],
    presentation: { coverPositionX: number; coverPositionY: number; coverZoom: number },
  ): Promise<void> => {
    const ids = Array.from(new Set(projectIds.filter(Boolean))).slice(0, 2);
    for (const id of ids) {
      await c.env.DB.prepare(`UPDATE projects SET cover_position_x = ?, cover_position_y = ?, cover_zoom = ? WHERE id = ?`)
        .bind(presentation.coverPositionX, presentation.coverPositionY, presentation.coverZoom, id)
        .run();
    }
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

  listDraftIdsByPublishedId: async (c: AppContext, publishedProjectId: string): Promise<string[]> => {
    const result = await c.env.DB.prepare(
      `SELECT id FROM projects WHERE published_project_id = ? AND review_target = 'draft'`,
    )
      .bind(publishedProjectId)
      .all<{ id: string }>();
    return (result.results || []).map(row => row.id);
  },

  createDraftFromPublished: async (
    c: AppContext,
    publishedProjectId: string,
    updates: {
      name?: string;
      description?: string;
      precautions?: string | null;
      version?: string;
      versionLabel?: string | null;
      characterReferenceId?: string | null;
      builtForReferenceVersionId?: string | null;
      testedThroughReferenceVersionId?: string | null;
      compatibilityStatus?: ProjectCompatibilityStatus | null;
      compatibilityKnownIncompatible?: boolean;
      compatibilityNote?: string | null;
      compatibilityGraceUntil?: string | null;
      compatibilityUpdatedAt?: string | null;
      conflictsWithOriginal?: boolean;
      originalConflictReferenceItemIds?: string[];
      projectType?: ProjectType;
      extensionType?: ExtensionType | null;
      facets?: ProjectFacets;
      customTags?: string[];
      displayTags?: string[];
      tags?: string[];
      coverImage?: string;
      coverPositionX?: number;
      coverPositionY?: number;
      coverZoom?: number;
    },
  ) => {
    const published = await projectDb.get(c, publishedProjectId);
    if (!published) return null;
    const existingDraft = published.draftProjectId ? await projectDb.get(c, published.draftProjectId) : null;
    if (existingDraft) {
      const nextVersion = updates.version ?? bumpProjectVersionWithLegacyFallback(published.version, 'patch');
      await projectDb.update(c, existingDraft.id, {
        name: updates.name ?? existingDraft.name,
        description: updates.description ?? existingDraft.description ?? '',
        precautions: updates.precautions !== undefined ? updates.precautions : existingDraft.precautions,
        version: nextVersion,
        versionLabel: updates.versionLabel !== undefined ? updates.versionLabel : existingDraft.versionLabel,
        characterReferenceId: updates.characterReferenceId !== undefined ? updates.characterReferenceId : existingDraft.characterReferenceId,
        builtForReferenceVersionId: updates.builtForReferenceVersionId !== undefined ? updates.builtForReferenceVersionId : existingDraft.builtForReferenceVersionId,
        testedThroughReferenceVersionId: updates.testedThroughReferenceVersionId !== undefined ? updates.testedThroughReferenceVersionId : existingDraft.testedThroughReferenceVersionId,
        compatibilityStatus: updates.compatibilityStatus !== undefined ? updates.compatibilityStatus : existingDraft.compatibilityStatus,
        compatibilityKnownIncompatible: updates.compatibilityKnownIncompatible !== undefined ? updates.compatibilityKnownIncompatible : existingDraft.compatibilityKnownIncompatible,
        compatibilityNote: updates.compatibilityNote !== undefined ? updates.compatibilityNote : existingDraft.compatibilityNote,
        compatibilityGraceUntil: updates.compatibilityGraceUntil !== undefined ? updates.compatibilityGraceUntil : existingDraft.compatibilityGraceUntil,
        compatibilityUpdatedAt: updates.compatibilityUpdatedAt !== undefined ? updates.compatibilityUpdatedAt : existingDraft.compatibilityUpdatedAt,
        conflictsWithOriginal: updates.conflictsWithOriginal !== undefined ? updates.conflictsWithOriginal : existingDraft.conflictsWithOriginal,
        originalConflictReferenceItemIds: updates.originalConflictReferenceItemIds !== undefined ? updates.originalConflictReferenceItemIds : existingDraft.originalConflictReferenceItemIds,
        projectType: updates.projectType ?? existingDraft.projectType,
        extensionType: updates.extensionType !== undefined ? updates.extensionType : existingDraft.extensionType,
        facets: updates.facets ?? existingDraft.facets,
        customTags: updates.customTags ?? existingDraft.customTags,
        displayTags: updates.displayTags ?? existingDraft.displayTags,
        tags: updates.tags ?? existingDraft.tags,
        coverImage: updates.coverImage ?? existingDraft.coverImage ?? undefined,
        coverPositionX: updates.coverPositionX ?? existingDraft.coverPositionX,
        coverPositionY: updates.coverPositionY ?? existingDraft.coverPositionY,
        coverZoom: updates.coverZoom ?? existingDraft.coverZoom,
      });
      await projectDb.bumpDraftRevision(c, existingDraft.id);
      return existingDraft.id;
    }

    const draftId = generateId();
    await projectDb.create(c, {
      id: draftId,
      name: updates.name ?? published.name,
      description: updates.description ?? published.description ?? undefined,
      precautions: updates.precautions !== undefined ? updates.precautions : published.precautions,
      version: updates.version ?? bumpProjectVersionWithLegacyFallback(published.version, 'patch'),
      versionLabel: updates.versionLabel !== undefined ? updates.versionLabel : published.versionLabel,
      characterReferenceId: updates.characterReferenceId !== undefined ? updates.characterReferenceId : published.characterReferenceId,
      builtForReferenceVersionId: updates.builtForReferenceVersionId !== undefined ? updates.builtForReferenceVersionId : published.builtForReferenceVersionId,
      testedThroughReferenceVersionId: updates.testedThroughReferenceVersionId !== undefined ? updates.testedThroughReferenceVersionId : published.testedThroughReferenceVersionId,
      compatibilityStatus: updates.compatibilityStatus !== undefined ? updates.compatibilityStatus : published.compatibilityStatus,
      compatibilityKnownIncompatible: updates.compatibilityKnownIncompatible !== undefined ? updates.compatibilityKnownIncompatible : published.compatibilityKnownIncompatible,
      compatibilityNote: updates.compatibilityNote !== undefined ? updates.compatibilityNote : published.compatibilityNote,
      compatibilityGraceUntil: updates.compatibilityGraceUntil !== undefined ? updates.compatibilityGraceUntil : published.compatibilityGraceUntil,
      compatibilityUpdatedAt: updates.compatibilityUpdatedAt !== undefined ? updates.compatibilityUpdatedAt : published.compatibilityUpdatedAt,
      conflictsWithOriginal: updates.conflictsWithOriginal !== undefined ? updates.conflictsWithOriginal : published.conflictsWithOriginal,
      originalConflictReferenceItemIds: updates.originalConflictReferenceItemIds !== undefined ? updates.originalConflictReferenceItemIds : published.originalConflictReferenceItemIds,
      authorId: published.authorId,
      authorName: published.authorName,
      authorAvatar: published.authorAvatar || '',
      projectType: updates.projectType ?? published.projectType,
      extensionType: updates.extensionType !== undefined ? updates.extensionType : published.extensionType,
      facets: updates.facets ?? published.facets,
      customTags: updates.customTags ?? published.customTags,
      displayTags: updates.displayTags ?? published.displayTags,
      tags: updates.tags ?? published.tags,
      coverImage: updates.coverImage ?? published.coverImage ?? undefined,
      coverPositionX: updates.coverPositionX ?? published.coverPositionX,
      coverPositionY: updates.coverPositionY ?? published.coverPositionY,
      coverZoom: updates.coverZoom ?? published.coverZoom,
      downloadUrl: published.downloadUrl || undefined,
      fileSize: published.fileSize || undefined,
      hasEjs: published.hasEjs,
      hasCharacterArtwork: published.hasCharacterArtwork,
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

function withProjectReleaseCacheIdentity(url: string, version: string): string {
  const result = new URL(url);
  result.searchParams.set('v', normalizeProjectVersionBase(version));
  return result.toString();
}

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

  const requestHostname = new URL(c.req.url).hostname.toLowerCase();
  const previewHostOctets = requestHostname.split('.').map(part => Number(part));
  const isPrivateLanHost = previewHostOctets.length === 4
    && previewHostOctets.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    && (previewHostOctets[0] === 10
      || (previewHostOctets[0] === 172 && previewHostOctets[1] >= 16 && previewHostOctets[1] <= 31)
      || (previewHostOctets[0] === 192 && previewHostOctets[1] === 168));
  const isLocalDiscoverPreview = requestHostname === '127.0.0.1'
    || requestHostname === 'localhost'
    || requestHostname.endsWith('.trycloudflare.com')
    || isPrivateLanHost;
  const previewFileBaseRaw = String(c.env.LOCAL_PREVIEW_FILE_BASE || '').trim();
  const previewFileBase = previewFileBaseRaw ? previewFileBaseRaw.replace(/\/?$/, '/') : '';

  return projects.map(project => ({
    ...project,
    downloadUrl: project.downloadUrl
      ? withProjectReleaseCacheIdentity(
          r2Storage.getProxyUrl(c, project.downloadUrl.replace(/^.*\/api\/files\//, '')),
          project.version,
        )
      : null,
    coverImage: project.coverImage
      ? isLocalDiscoverPreview && previewFileBase
        ? withProjectReleaseCacheIdentity(
            /^https?:\/\//i.test(project.coverImage)
              ? project.coverImage
              : `${previewFileBase}${project.coverImage.replace(/^.*\/api\/files\//, '').replace(/^\/+/, '')}`,
            project.version,
          )
        : withProjectReleaseCacheIdentity(
            r2Storage.getProxyUrl(c, project.coverImage.replace(/^.*\/api\/files\//, '')),
            project.version,
          )
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

  const projectType = resolveProjectType(row.project_type, parsedTags);
  const extensionType = projectType === '扩展' ? normalizeExtensionType(row.extension_type) : null;

  let rawFacets: unknown = {};
  try {
    rawFacets = typeof row.facets === 'string' && row.facets.trim() ? JSON.parse(row.facets) : {};
  } catch {
    rawFacets = {};
  }
  const facets = normalizeProjectFacets(rawFacets, projectType);

  let rawCustomTags: unknown = undefined;
  if (typeof row.custom_tags === 'string' && row.custom_tags.trim()) {
    try {
      const parsed = JSON.parse(row.custom_tags);
      if (Array.isArray(parsed)) rawCustomTags = parsed;
    } catch {
      rawCustomTags = undefined;
    }
  }
  const officialTagValues = new Set(getProjectFacetTagValues(facets));
  const customTags = normalizeCustomTags(rawCustomTags, parsedTags)
    .filter(tag => !officialTagValues.has(tag));

  let rawDisplayTags: unknown = undefined;
  if (typeof row.display_tags === 'string' && row.display_tags.trim()) {
    try {
      const parsed = JSON.parse(row.display_tags);
      if (Array.isArray(parsed)) rawDisplayTags = parsed;
    } catch {
      rawDisplayTags = undefined;
    }
  }
  const displayTags = normalizeDisplayTags(
    rawDisplayTags === undefined ? customTags.slice(0, MAX_DISPLAY_TAGS) : rawDisplayTags,
    facets,
    customTags,
  ).slice(0, MAX_DISPLAY_TAGS);

  const rawVersion = String(row.version ?? '').trim();
  const version = normalizeProjectVersionBase(rawVersion);
  const explicitVersionLabel = typeof row.version_label === 'string' ? row.version_label.trim() : '';
  const versionLabel = explicitVersionLabel || (!parseProjectVersion(rawVersion) && rawVersion ? rawVersion : null);
  const rawPublishedVersion = typeof row.published_version === 'string' ? row.published_version.trim() : '';

  return {
    id: row.id as string,
    rootProjectId: ((row.root_project_id as string | null) || (row.id as string)) as string,
    publishedProjectId: row.published_project_id as string | null,
    draftProjectId: row.draft_project_id as string | null,
    name: row.name as string,
    description: row.description as string | null,
    precautions: row.precautions as string | null,
    version,
    versionLabel,
    publishedVersion: rawPublishedVersion ? normalizeProjectVersionBase(rawPublishedVersion) : null,
    authorId: row.author_id as string,
    authorName: row.author_name as string,
    authorGlobalName: ((row.global_name as string | null) || (row.author_name as string)) as string,
    authorAvatar: row.author_avatar as string | null,
    status: row.status as 'drafting' | 'pending' | 'approved' | 'rejected',
    downloadUrl: row.download_url as string | null,
    fileSize: row.file_size as number | null,
    downloadsCount: Number(row.downloads_count ?? 0),
    hasEjs: Number(row.has_ejs ?? 0) === 1,
    hasCharacterArtwork: Number(row.has_character_artwork ?? 0) === 1,
    projectType,
    extensionType,
    facets,
    customTags,
    displayTags,
    tags: parsedTags,
    coverImage: row.cover_image as string | null,
    coverPositionX: Math.min(100, Math.max(0, Number(row.cover_position_x ?? 50))),
    coverPositionY: Math.min(100, Math.max(0, Number(row.cover_position_y ?? 50))),
    coverZoom: Math.min(3, Math.max(1, Number(row.cover_zoom ?? 1))),
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
    characterReferenceId: row.character_reference_id as string | null,
    builtForReferenceVersionId: row.built_for_reference_version_id as string | null,
    testedThroughReferenceVersionId: row.tested_through_reference_version_id as string | null,
    compatibilityStatus: row.compatibility_status as ProjectCompatibilityStatus | null,
    compatibilityKnownIncompatible: Number(row.compatibility_known_incompatible ?? 0) === 1,
    compatibilityNote: row.compatibility_note as string | null,
    compatibilityGraceUntil: row.compatibility_grace_until as string | null,
    compatibilityUpdatedAt: row.compatibility_updated_at as string | null,
    conflictsWithOriginal: Number(row.conflicts_with_original ?? 0) === 1,
    originalConflictReferenceItemIds: (() => {
      try {
        const value = JSON.parse(String(row.original_conflict_reference_item_ids || '[]'));
        return Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, 500) : [];
      } catch {
        return [];
      }
    })(),
  };
}
