import { getCurrentCreativeWorkshopContext } from '../services/context';
import { getCreativeWorkshopProjectDiff } from '../services/diff';
import { listInstalledCreativeWorkshopProjects } from '../services/install-state';
import {
  installCreativeWorkshopRegex,
  uninstallCreativeWorkshopRegex,
  updateCreativeWorkshopRegex,
} from '../services/regex';
import {
  installCreativeWorkshopProject,
  uninstallCreativeWorkshopProject,
  updateCreativeWorkshopProject,
} from '../services/worldbook';
import { createBridgeMessage, isCreativeWorkshopBridgeMessage } from './protocol';

type HostOption = {
  iframe: HTMLIFrameElement;
  targetOrigin: string;
  hostWindow?: Window;
};

export function createCreativeWorkshopBridgeHost(option: HostOption) {
  const { iframe, targetOrigin, hostWindow = window.parent !== window ? window.parent : window } = option;

  async function post(type: string, payload?: Record<string, unknown>, requestId?: string) {
    iframe.contentWindow?.postMessage(createBridgeMessage(type as never, payload, requestId), targetOrigin);
  }

  async function handleMessage(event: MessageEvent) {
    if (event.source !== iframe.contentWindow) return;
    if (targetOrigin !== '*' && event.origin !== targetOrigin) return;
    if (!isCreativeWorkshopBridgeMessage(event.data)) return;

    try {
      switch (event.data.type) {
        case 'bridge:handshake':
          await post('bridge:handshake:ok', { connected: true }, event.data.requestId);
          await post('bridge:context', getCurrentCreativeWorkshopContext(), event.data.requestId);
          await post(
            'bridge:installed-projects',
            { projects: await listInstalledCreativeWorkshopProjects() },
            event.data.requestId,
          );
          break;
        case 'bridge:get-context':
          await post('bridge:context', getCurrentCreativeWorkshopContext(), event.data.requestId);
          break;
        case 'bridge:list-installed-projects':
          await post(
            'bridge:installed-projects',
            { projects: await listInstalledCreativeWorkshopProjects() },
            event.data.requestId,
          );
          break;
        case 'bridge:install-project':
          if (!_.isString(_.get(event.data, 'payload.projectId'))) {
            throw new Error('缺少 projectId');
          }
          await installCreativeWorkshopProject(String(event.data.payload?.projectId));
          await installCreativeWorkshopRegex(String(event.data.payload?.projectId));
          await post(
            'bridge:install-result',
            {
              success: true,
              projectId: String(event.data.payload?.projectId),
              projects: await listInstalledCreativeWorkshopProjects(),
            },
            event.data.requestId,
          );
          break;
        case 'bridge:uninstall-project':
          if (!_.isString(_.get(event.data, 'payload.projectId'))) {
            throw new Error('缺少 projectId');
          }
          await uninstallCreativeWorkshopProject(String(event.data.payload?.projectId));
          await uninstallCreativeWorkshopRegex(String(event.data.payload?.projectId));
          await post(
            'bridge:uninstall-result',
            {
              success: true,
              projectId: String(event.data.payload?.projectId),
              projects: await listInstalledCreativeWorkshopProjects(),
            },
            event.data.requestId,
          );
          break;
        case 'bridge:get-project-diff': {
          if (!_.isString(_.get(event.data, 'payload.projectId'))) {
            throw new Error('缺少 projectId');
          }
          const diffResult = await getCreativeWorkshopProjectDiff(String(event.data.payload?.projectId));
          await post('bridge:project-diff', diffResult, event.data.requestId);
          break;
        }
        case 'bridge:confirm-project-update':
          if (!_.isString(_.get(event.data, 'payload.projectId'))) {
            throw new Error('缺少 projectId');
          }
          await updateCreativeWorkshopProject(String(event.data.payload?.projectId));
          await updateCreativeWorkshopRegex(String(event.data.payload?.projectId));
          await post(
            'bridge:update-result',
            {
              success: true,
              projectId: String(event.data.payload?.projectId),
              projects: await listInstalledCreativeWorkshopProjects(),
            },
            event.data.requestId,
          );
          break;
      }
    } catch (error) {
      await post(
        'bridge:error',
        { message: error instanceof Error ? error.message : String(error) },
        event.data.requestId,
      );
    }
  }

  hostWindow.addEventListener('message', handleMessage);

  return {
    destroy() {
      hostWindow.removeEventListener('message', handleMessage);
    },
  };
}
