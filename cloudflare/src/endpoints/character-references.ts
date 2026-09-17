import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../types';
import {
  createCharacterReference,
  createCharacterReferenceVersion,
  listCharacterReferences,
  updateProjectCompatibilityMetadata,
} from '../utils/character-reference.ts';
import { projectDb } from '../utils/db';
import { getCurrentUserFromRequest } from '../utils/jwt';

export class CharacterReferenceList extends OpenAPIRoute {
  schema = {
    tags: ['Character References'],
    summary: 'List Character Reference Registry',
    responses: {
      '200': { description: 'Character references and historical versions' },
    },
  };

  async handle(c: AppContext) {
    return {
      success: true,
      references: await listCharacterReferences(c),
    };
  }
}

export class AdminCharacterReferenceCreate extends OpenAPIRoute {
  schema = {
    tags: ['Admin', 'Character References'],
    summary: 'Create Character Reference',
    request: {
      headers: z.object({ authorization: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              name: z.string().min(1).max(120),
              description: z.string().max(500).nullable().optional(),
            }),
          },
        },
      },
    },
    responses: {
      '200': { description: 'Character reference created' },
      '403': { description: 'Admin only' },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) return c.json({ error: 'Unauthorized' }, 401);
    if (!payload.isAdmin) return c.json({ error: 'Admin permission required' }, 403);

    const data = await this.getValidatedData<typeof this.schema>();
    try {
      const reference = await createCharacterReference(c, {
        name: data.body.name,
        description: data.body.description,
        actorId: payload.userId,
        actorName: payload.globalName || payload.username,
      });
      await projectDb.logAdminAction(c, {
        action: 'character_reference_created',
        targetType: 'character_reference',
        targetId: reference.id,
        actorId: payload.userId,
        actorName: payload.globalName || payload.username,
        detail: { name: reference.name },
      });
      return { success: true, reference };
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Character reference creation failed' }, 400);
    }
  }
}

export class AdminCharacterReferenceVersionCreate extends OpenAPIRoute {
  schema = {
    tags: ['Admin', 'Character References'],
    summary: 'Import Character Reference Version',
    request: {
      params: z.object({ referenceId: Str({ description: 'Character Reference ID' }) }),
      headers: z.object({ authorization: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              versionLabel: z.string().min(1).max(80),
              worldbookJson: z.string().nullable().optional(),
              regexJson: z.string().nullable().optional(),
            }),
          },
        },
      },
    },
    responses: {
      '200': { description: 'Reference version imported and fingerprinted' },
      '403': { description: 'Admin only' },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) return c.json({ error: 'Unauthorized' }, 401);
    if (!payload.isAdmin) return c.json({ error: 'Admin permission required' }, 403);

    const data = await this.getValidatedData<typeof this.schema>();
    try {
      const version = await createCharacterReferenceVersion(c, {
        characterReferenceId: data.params.referenceId,
        versionLabel: data.body.versionLabel,
        worldbookJson: data.body.worldbookJson,
        regexJson: data.body.regexJson,
        actorId: payload.userId,
        actorName: payload.globalName || payload.username,
      });
      await projectDb.logAdminAction(c, {
        action: 'character_reference_version_created',
        targetType: 'character_reference_version',
        targetId: version.id,
        actorId: payload.userId,
        actorName: payload.globalName || payload.username,
        detail: {
          characterReferenceId: version.characterReferenceId,
          characterName: version.characterName,
          versionLabel: version.versionLabel,
          itemCount: version.itemCount,
          worldbookCount: version.worldbookCount,
          regexCount: version.regexCount,
          graceUntil: version.graceUntil,
        },
      });
      return { success: true, version };
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Reference version import failed' }, 400);
    }
  }
}

export class ProjectCompatibilityUpdate extends OpenAPIRoute {
  schema = {
    tags: ['Projects', 'Character References'],
    summary: 'Update Project Compatibility Metadata',
    request: {
      params: z.object({ projectId: Str({ description: 'Project ID' }) }),
      headers: z.object({ authorization: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              testedThroughReferenceVersionId: z.string().max(120).nullable().optional(),
              knownIncompatible: z.boolean().optional(),
              note: z.string().max(500).nullable().optional(),
            }),
          },
        },
      },
    },
    responses: {
      '200': { description: 'Compatibility metadata updated without content review' },
      '403': { description: 'Author or admin only' },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) return c.json({ error: 'Unauthorized' }, 401);
    const data = await this.getValidatedData<typeof this.schema>();
    const project = await projectDb.get(c, data.params.projectId, payload);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    if (project.authorId !== payload.userId && !payload.isAdmin) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    try {
      const result = await updateProjectCompatibilityMetadata(c, {
        projectId: project.id,
        publishedProjectId: project.publishedProjectId,
        builtForReferenceVersionId: project.builtForReferenceVersionId,
        beforeTestedThroughReferenceVersionId: project.testedThroughReferenceVersionId,
        beforeStatus: project.compatibilityStatus,
        beforeKnownIncompatible: project.compatibilityKnownIncompatible,
        beforeNote: project.compatibilityNote,
        testedThroughReferenceVersionId: data.body.testedThroughReferenceVersionId,
        knownIncompatible: data.body.knownIncompatible ?? project.compatibilityKnownIncompatible,
        note: data.body.note !== undefined ? data.body.note : project.compatibilityNote,
        actorId: payload.userId,
        actorName: payload.globalName || payload.username,
      });
      return {
        success: true,
        metadataOnly: true,
        compatibility: result,
      };
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Compatibility update failed' }, 400);
    }
  }
}
