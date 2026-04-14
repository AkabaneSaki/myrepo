import { getCreativeWorkshopOrigin } from '../services/config';
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

const OAUTH_CALLBACK_SOURCE = 'creative-workshop-auth-callback';
const OAUTH_POPUP_NAME = 'creative-workshop-oauth';
const OAUTH_TIMEOUT_MS = 180000;
const OAUTH_POPUP_CLOSE_GUARD_MS = 8000;

type OAuthCallbackSuccessMessage = {
  type: 'oauth-success';
  source: typeof OAUTH_CALLBACK_SOURCE;
  state?: string;
  token?: string;
  user?: Record<string, unknown>;
};

type OAuthCallbackErrorMessage = {
  type: 'oauth-error';
  source: typeof OAUTH_CALLBACK_SOURCE;
  state?: string;
  message?: string;
};

type OAuthCallbackMessage = OAuthCallbackSuccessMessage | OAuthCallbackErrorMessage;

function isOAuthCallbackMessage(value: unknown): value is OAuthCallbackMessage {
  return (
    _.isObject(value) &&
    (_.get(value, 'type') === 'oauth-success' || _.get(value, 'type') === 'oauth-error') &&
    _.get(value, 'source') === OAUTH_CALLBACK_SOURCE
  );
}

export function createCreativeWorkshopBridgeHost(option: HostOption) {
  const { iframe, targetOrigin, hostWindow = window.parent !== window ? window.parent : window } = option;
  const oauthOrigin = getCreativeWorkshopOrigin();
  let oauthPopup: Window | null = null;
  let pendingOauthRequestId: string | undefined;
  let pendingOauthState: string | undefined;
  let oauthTimeoutId: number | null = null;
  let oauthClosePollId: number | null = null;
  let oauthPopupOpenedAt = 0;

  console.info('[CreativeWorkshopBridgeHost] created', {
    targetOrigin,
    oauthOrigin,
    iframeSrc: iframe.getAttribute('src'),
  });

  function cleanupOAuthPopupReference() {
    console.info('[CreativeWorkshopBridgeHost] cleanupOAuthPopupReference', {
      hasPopup: Boolean(oauthPopup),
      popupClosed: oauthPopup?.closed ?? null,
    });
    if (oauthPopup && !oauthPopup.closed) {
      oauthPopup.close();
    }
    oauthPopup = null;
  }

  function clearOAuthTimers() {
    console.info('[CreativeWorkshopBridgeHost] clearOAuthTimers', {
      hasTimeout: oauthTimeoutId !== null,
      hasClosePoll: oauthClosePollId !== null,
    });
    if (oauthTimeoutId !== null) {
      hostWindow.clearTimeout(oauthTimeoutId);
      oauthTimeoutId = null;
    }
    if (oauthClosePollId !== null) {
      hostWindow.clearInterval(oauthClosePollId);
      oauthClosePollId = null;
    }
  }

  async function resolveOAuthResult(payload: Record<string, unknown>, requestId = pendingOauthRequestId) {
    console.info('[CreativeWorkshopBridgeHost] resolveOAuthResult', {
      requestId,
      payload,
    });
    await post('bridge:oauth:result', payload, requestId);
    clearOAuthTimers();
    cleanupOAuthPopupReference();
    pendingOauthRequestId = undefined;
    pendingOauthState = undefined;
  }

  async function failPendingOAuth(message: string) {
    console.warn('[CreativeWorkshopBridgeHost] failPendingOAuth', {
      message,
      pendingOauthRequestId,
      pendingOauthState,
    });
    if (!pendingOauthRequestId) return;
    await resolveOAuthResult(
      {
        success: false,
        message,
        state: pendingOauthState,
      },
      pendingOauthRequestId,
    );
  }

  function startOAuthMonitors() {
    clearOAuthTimers();
    oauthPopupOpenedAt = Date.now();
    console.info('[CreativeWorkshopBridgeHost] startOAuthMonitors', {
      pendingOauthRequestId,
      pendingOauthState,
      popupClosed: oauthPopup?.closed ?? null,
    });
    oauthTimeoutId = hostWindow.setTimeout(() => {
      void failPendingOAuth('授权超时');
    }, OAUTH_TIMEOUT_MS);
    oauthClosePollId = hostWindow.setInterval(() => {
      if (!oauthPopup) {
        console.warn('[CreativeWorkshopBridgeHost] oauthClosePoll:no-popup-reference');
        return;
      }

      if (Date.now() - oauthPopupOpenedAt < OAUTH_POPUP_CLOSE_GUARD_MS) {
        console.info('[CreativeWorkshopBridgeHost] oauthClosePoll:within-guard-window', {
          elapsedMs: Date.now() - oauthPopupOpenedAt,
          guardMs: OAUTH_POPUP_CLOSE_GUARD_MS,
        });
        return;
      }

      if (oauthPopup.closed) {
        console.info('[CreativeWorkshopBridgeHost] popup reported closed before oauth resolved', {
          state: pendingOauthState,
          guardMs: OAUTH_POPUP_CLOSE_GUARD_MS,
        });
        return;
      }
    }, 500);
  }

  async function handleOAuthCallback(event: MessageEvent) {
    console.info('[CreativeWorkshopBridgeHost] handleOAuthCallback:received', {
      pendingOauthRequestId,
      pendingOauthState,
      eventOrigin: event.origin,
      sourceMatchesPopup: oauthPopup ? event.source === oauthPopup : null,
      data: event.data,
    });
    if (!pendingOauthRequestId) return;
    if (event.origin !== oauthOrigin) return;
    if (!isOAuthCallbackMessage(event.data)) return;
    if (oauthPopup && event.source !== oauthPopup) return;

    if (pendingOauthState && event.data.state !== pendingOauthState) {
      await failPendingOAuth('授权状态校验失败');
      return;
    }

    if (event.data.type === 'oauth-success') {
      if (!_.isString(event.data.token) || !_.isObject(event.data.user)) {
        await failPendingOAuth('授权回调缺少有效登录信息');
        return;
      }

      await resolveOAuthResult({
        success: true,
        token: event.data.token,
        user: event.data.user,
        state: event.data.state,
      });
      return;
    }

    await resolveOAuthResult({
      success: false,
      message: _.isString(event.data.message) ? event.data.message : '登录失败',
      state: event.data.state,
    });
  }

  async function post(type: string, payload?: Record<string, unknown>, requestId?: string) {
    console.info('[CreativeWorkshopBridgeHost] post', {
      type,
      requestId,
      payload,
      targetOrigin,
    });
    iframe.contentWindow?.postMessage(createBridgeMessage(type as never, payload, requestId), targetOrigin);
  }

  async function handleMessage(event: MessageEvent) {
    console.info('[CreativeWorkshopBridgeHost] handleMessage:received', {
      eventOrigin: event.origin,
      sourceMatchesIframe: event.source === iframe.contentWindow,
      data: event.data,
    });
    if (event.source !== iframe.contentWindow) return;
    if (targetOrigin !== '*' && event.origin !== targetOrigin) return;
    if (!isCreativeWorkshopBridgeMessage(event.data)) return;

    const actionType = event.data.type;
    const actionProjectId = _.isString(_.get(event.data, 'payload.projectId'))
      ? String(event.data.payload?.projectId)
      : undefined;

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
        case 'bridge:oauth:start': {
          const authUrl = _.get(event.data, 'payload.authUrl');
          const state = _.get(event.data, 'payload.state');
          if (!_.isString(authUrl) || !authUrl.trim()) {
            throw new Error('缺少 authUrl');
          }
          if (state != null && !_.isString(state)) {
            throw new Error('state 类型无效');
          }

          if (pendingOauthRequestId) {
            await failPendingOAuth('新的登录请求已开始，旧的授权流程已取消');
          }

          console.info('[CreativeWorkshopBridgeHost] bridge:oauth:start', {
            authUrl,
            state,
            requestId: event.data.requestId,
          });

          const width = 600;
          const height = 700;
          const left = Math.max(0, Math.round((hostWindow.screen.width - width) / 2));
          const top = Math.max(0, Math.round((hostWindow.screen.height - height) / 2));
          const popup = hostWindow.open(
            authUrl,
            OAUTH_POPUP_NAME,
            `width=${width},height=${height},left=${left},top=${top}`,
          );

          if (!popup) {
            console.error('[CreativeWorkshopBridgeHost] bridge:oauth:start popup blocked');
            await post(
              'bridge:oauth:result',
              {
                success: false,
                message: '请允许浏览器弹窗后重试登录',
                state: _.isString(state) ? state : undefined,
              },
              event.data.requestId,
            );
            break;
          }

          oauthPopup = popup;
          oauthPopupOpenedAt = Date.now();
          pendingOauthRequestId = event.data.requestId;
          pendingOauthState = _.isString(state) ? state : undefined;
          console.info('[CreativeWorkshopBridgeHost] bridge:oauth:start popup opened', {
            popupClosed: popup.closed,
            pendingOauthRequestId,
            pendingOauthState,
          });
          startOAuthMonitors();
          break;
        }
      }
    } catch (error) {
      await post(
        'bridge:error',
        {
          message: error instanceof Error ? error.message : String(error),
          projectId: actionProjectId,
          action: actionType,
        },
        event.data.requestId,
      );
    }
  }

  hostWindow.addEventListener('message', handleOAuthCallback);
  hostWindow.addEventListener('message', handleMessage);

  return {
    destroy() {
      if (pendingOauthRequestId || pendingOauthState) {
        console.warn('[CreativeWorkshopBridgeHost] OAuth 监听在授权完成前被销毁', {
          requestId: pendingOauthRequestId,
          state: pendingOauthState,
          popupClosed: oauthPopup?.closed ?? null,
          iframeStillConnected: document.contains(iframe),
          iframeSrc: iframe.getAttribute('src'),
          iframeHref: (() => {
            try {
              return iframe.contentWindow?.location.href ?? null;
            } catch {
              return '[cross-origin]';
            }
          })(),
        });
      }
      console.info('[CreativeWorkshopBridgeHost] destroy');
      clearOAuthTimers();
      cleanupOAuthPopupReference();
      pendingOauthRequestId = undefined;
      pendingOauthState = undefined;
      hostWindow.removeEventListener('message', handleOAuthCallback);
      hostWindow.removeEventListener('message', handleMessage);
    },
  };
}
