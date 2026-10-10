import { getCreativeWorkshopOrigin } from '../services/config';
import { getCurrentCreativeWorkshopContext } from '../services/context';
import { CREATIVE_WORKSHOP_CLIENT_VERSION } from '../version';
import { getCreativeWorkshopProjectDiff } from '../services/diff';
import { scanInstalledCreativeWorkshopProjects } from '../services/install-state';
import { deleteCreativeWorkshopInstallRecord, setCreativeWorkshopInstallRecord, getCreativeWorkshopInstallRecord } from '../services/install-registry';
import { repairCreativeWorkshopProject, scanCreativeWorkshopRepairCandidates } from '../services/repair';
import { listCreativeWorkshopScriptDependencies } from '../services/script-dependency';
import {
  applyPreparedCreativeWorkshopRegex,
  prepareCreativeWorkshopRegexEntries,
  uninstallCreativeWorkshopRegex,
  verifyCreativeWorkshopRegexInstallation,
} from '../services/regex';
import {
  installCreativeWorkshopProject,
  uninstallCreativeWorkshopProject,
  updateCreativeWorkshopProject,
  removeCreativeWorkshopApprovedDuplicates,
  verifyCreativeWorkshopApprovedDuplicateState,
} from '../services/worldbook';
import { createBridgeMessage, isCreativeWorkshopBridgeMessage } from './protocol';
import { createCreativeWorkshopAdditionalWorldbook, transferCreativeWorkshopInstalledWorldbook } from '../services/installed-transfer';
import { migrateCreativeWorkshopLegacyRegexRecords } from '../services/regex-record';

type HostOption = {
  iframe: HTMLIFrameElement;
  targetOrigin: string;
  hostWindow?: Window;
  onClose?: () => void;
  onReady?: () => void;
};

const OAUTH_CALLBACK_SOURCE = 'creative-workshop-auth-callback';
const OAUTH_POPUP_NAME = 'creative-workshop-oauth';
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
const OAUTH_POPUP_CLOSE_GUARD_MS = 8000;
const INITIAL_INSTALL_SCAN_TIMEOUT_MS = 8000;
let mutationQueue: Promise<void> = Promise.resolve();

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

type OAuthCallbackReadyMessage = {
  type: 'oauth-ready';
  source: typeof OAUTH_CALLBACK_SOURCE;
  state?: string;
};

type OAuthCallbackMessage = OAuthCallbackSuccessMessage | OAuthCallbackErrorMessage | OAuthCallbackReadyMessage;

function isOAuthCallbackMessage(value: unknown): value is OAuthCallbackMessage {
  return (
    _.isObject(value) &&
    (_.get(value, 'type') === 'oauth-success' ||
      _.get(value, 'type') === 'oauth-error' ||
      _.get(value, 'type') === 'oauth-ready') &&
    _.get(value, 'source') === OAUTH_CALLBACK_SOURCE
  );
}

function redactOAuthLogPayload(value: unknown) {
  return {
    type: _.isString(_.get(value, 'type')) ? String(_.get(value, 'type')) : undefined,
    state: _.isString(_.get(value, 'state')) ? String(_.get(value, 'state')) : undefined,
    success: _.isBoolean(_.get(value, 'success')) ? Boolean(_.get(value, 'success')) : undefined,
    callbackReady: _.isBoolean(_.get(value, 'callbackReady')) ? Boolean(_.get(value, 'callbackReady')) : undefined,
    hasToken: _.isString(_.get(value, 'token')),
  };
}

// Stable, searchable error codes. Do not change a code's meaning after release.
// A code identifies the failed phase; requestId identifies the specific attempt.
const DLC_PHASE_ERROR_CODE: Record<string, string> = {
  queued: '001',
  preflight: '010',
  download: '020',
  validate: '030',
  recover: '035',
  install: '040',
  install_verify: '050',
  remove_old: '060',
  worldbook_verify: '070',
  conflicts: '080',
  regex: '090',
  regex_verify: '100',
  cleanup: '110',
  registry: '120',
  final_verify: '130',
};
function getDlcPhaseErrorCode(action: string, phase: string): string {
  const kind = action === 'bridge:confirm-project-update' ? 'U' : 'I';
  return 'CW-' + kind + '-' + (DLC_PHASE_ERROR_CODE[phase] || '999');
}

async function verifyFinalCreativeWorkshopInstallScan(
  projectId: string,
  version: string,
  worldbookName: string | null,
) {
  const scan = await scanInstalledCreativeWorkshopProjects();
  if (!scan.complete) {
    throw new Error('最终验收未完成：部分世界书暂时无法读取，请重新扫描并检查安装状态');
  }
  const matching = scan.projects.filter(project =>
    project.projectId === projectId && (project.worldbookName || null) === worldbookName);
  if (matching.length !== 1 || matching[0].localVersion !== version ||
      matching[0].mixedVersions || matching[0].regexVersionMismatch || matching[0].regexInstallPending) {
    throw new Error('最终验收失败：目标 DLC 的安装位置、版本或 Regex 状态仍不一致，请重新扫描');
  }
  return scan;
}

export function createCreativeWorkshopBridgeHost(option: HostOption) {
  const { iframe, targetOrigin, hostWindow = window.parent !== window ? window.parent : window, onClose, onReady } = option;
  const oauthOrigin = getCreativeWorkshopOrigin();
  let oauthPopup: Window | null = null;
  let pendingOauthRequestId: string | undefined;
  let pendingOauthState: string | undefined;
  let oauthTimeoutId: number | null = null;
  let oauthClosePollId: number | null = null;
  let oauthPopupOpenedAt = 0;
  let initialInstalledProjectScanInFlight: ReturnType<typeof scanInstalledCreativeWorkshopProjects> | null = null;
  const projectMutationInFlight = new Set<string>();
  // Serialize all installations writing to the same character/worldbook/regex scope.

  async function getInitialInstalledProjectScan() {
    if (initialInstalledProjectScanInFlight) return initialInstalledProjectScanInFlight;
    const sourceScan = scanInstalledCreativeWorkshopProjects();
    const scan = Promise.race([
      sourceScan,
      new Promise<Awaited<ReturnType<typeof scanInstalledCreativeWorkshopProjects>>>((_, reject) => {
        hostWindow.setTimeout(() => reject(new Error('读取安装状态超时')), INITIAL_INSTALL_SCAN_TIMEOUT_MS);
      }),
    ]);
    initialInstalledProjectScanInFlight = scan;
    try {
      return await scan;
    } finally {
      if (initialInstalledProjectScanInFlight === scan) initialInstalledProjectScanInFlight = null;
    }
  }

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
      payload: redactOAuthLogPayload(payload),
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
    // TauriTavern mobile intentionally opens external URLs in the system browser
    // and returns null from window.open(). In that mode there is no popup Window
    // object to monitor; the Workshop iframe recovers the result through backend polling.
    if (oauthPopup) {
      oauthClosePollId = hostWindow.setInterval(() => {
        if (Date.now() - oauthPopupOpenedAt < OAUTH_POPUP_CLOSE_GUARD_MS) {
          console.info('[CreativeWorkshopBridgeHost] oauthClosePoll:within-guard-window', {
            elapsedMs: Date.now() - oauthPopupOpenedAt,
            guardMs: OAUTH_POPUP_CLOSE_GUARD_MS,
          });
          return;
        }

        if (oauthPopup?.closed) {
          console.info('[CreativeWorkshopBridgeHost] popup reported closed before oauth resolved', {
            state: pendingOauthState,
            guardMs: OAUTH_POPUP_CLOSE_GUARD_MS,
          });
        }
      }, 500);
    }
  }

  async function handleOAuthCallback(event: MessageEvent) {
    console.info('[CreativeWorkshopBridgeHost] handleOAuthCallback:received', {
      pendingOauthRequestId,
      pendingOauthState,
      eventOrigin: event.origin,
      sourceMatchesPopup: oauthPopup ? event.source === oauthPopup : null,
      data: redactOAuthLogPayload(event.data),
    });
    if (!pendingOauthRequestId) return;
    if (event.origin !== oauthOrigin) return;
    if (!isOAuthCallbackMessage(event.data)) return;
    if (oauthPopup && event.source !== oauthPopup) return;

    if (pendingOauthState && event.data.state !== pendingOauthState) {
      await failPendingOAuth('授权状态校验失败');
      return;
    }

    if (event.data.type === 'oauth-ready') {
      await post(
        'bridge:oauth:result',
        {
          callbackReady: true,
          state: event.data.state,
        },
        pendingOauthRequestId,
      );
      clearOAuthTimers();
      cleanupOAuthPopupReference();
      pendingOauthRequestId = undefined;
      pendingOauthState = undefined;
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
      payload: type === 'bridge:oauth:result' ? redactOAuthLogPayload(payload) : payload,
      targetOrigin,
    });
    iframe.contentWindow?.postMessage(createBridgeMessage(type as never, payload, requestId), targetOrigin);
  }

  async function handleMessage(event: MessageEvent) {
    console.info('[CreativeWorkshopBridgeHost] handleMessage:received', {
      eventOrigin: event.origin,
      sourceMatchesIframe: event.source === iframe.contentWindow,
      data: {
        type: _.get(event.data, 'type'),
        requestId: _.get(event.data, 'requestId'),
      },
    });
    if (event.source !== iframe.contentWindow) return;
    if (targetOrigin !== '*' && event.origin !== targetOrigin) return;
    if (!isCreativeWorkshopBridgeMessage(event.data)) return;

    const actionType = event.data.type;
    const actionLegacyProjectName = _.isString(_.get(event.data, 'payload.legacyProjectName'))
      ? String(event.data.payload?.legacyProjectName)
      : undefined;
    const actionProjectId = _.isString(_.get(event.data, 'payload.projectId'))
      ? String(event.data.payload?.projectId)
      : undefined;
    const isTransferMutation = actionType === 'bridge:install-project' || actionType === 'bridge:confirm-project-update';
    let currentPhase = isTransferMutation ? 'queued' : '';
    const emitProgress = (phase: string, details?: { loadedBytes?: number; totalBytes?: number; source?: string }) => {
      if (!isTransferMutation) return;
      currentPhase = phase;
      void post('bridge:operation-progress', {
        projectId: actionProjectId,
        action: actionType,
        phase,
        ...(details || {}),
      }, event.data.requestId);
    };
    const isProjectMutation =
      actionType === 'bridge:install-project' ||
      actionType === 'bridge:uninstall-project' ||
      actionType === 'bridge:transfer-installed-worldbook' ||
      actionType === 'bridge:confirm-project-update' ||
      actionType === 'bridge:repair:project';
    const isWorldbookCreation = actionType === 'bridge:create-additional-worldbook';

    if (isTransferMutation) emitProgress('queued');
    let finishMutation: (() => void) | null = null;
    if (isProjectMutation || isWorldbookCreation || actionType === 'bridge:list-installed-projects') {
      const prior = mutationQueue;
      mutationQueue = new Promise<void>(resolve => { finishMutation = resolve; });
      await prior;
      if (actionProjectId) projectMutationInFlight.add(actionProjectId);
    }

    try {
      if (isTransferMutation) emitProgress('preflight');
      if ((isProjectMutation || actionType === 'bridge:list-installed-projects') &&
          actionType !== 'bridge:transfer-installed-worldbook') await migrateCreativeWorkshopLegacyRegexRecords();
      switch (event.data.type) {
        case 'bridge:handshake':
          onReady?.();
          await post(
            'bridge:handshake:ok',
            { connected: true, clientVersion: CREATIVE_WORKSHOP_CLIENT_VERSION, capabilities: { verifiedDlcInstall: true, duplicateDlcConsolidation: true, installedManagerTransfer: true } },
            event.data.requestId,
          );
          await post('bridge:context', getCurrentCreativeWorkshopContext(), event.data.requestId);
          // Installed-project discovery can require reading several active worldbooks.
          // Keep handshake responsive; the explicit bridge:list-installed-projects request loads it in the background.
          break;
        case 'bridge:get-context':
          await post('bridge:context', getCurrentCreativeWorkshopContext(), event.data.requestId);
          break;
        case 'bridge:list-installed-projects': {
          let scan;
          try {
            scan = await getInitialInstalledProjectScan();
          } catch (error) {
            console.warn('[CreativeWorkshopBridgeHost] initial installed-project scan failed', error);
            scan = { projects: [], complete: false, unreadableWorldbookNames: [], scannedWorldbookNames: [] };
          }
          await post(
            'bridge:installed-projects',
            scan,
            event.data.requestId,
          );
          break;
        }
        case 'bridge:list-script-dependencies':
          await post(
            'bridge:script-dependencies',
            listCreativeWorkshopScriptDependencies(),
            event.data.requestId,
          );
          break;
        case 'bridge:install-project':
          if (!_.isString(_.get(event.data, 'payload.projectId'))) {
            throw new Error('缺少 projectId');
          }
          const installedDetail = await installCreativeWorkshopProject(
            String(event.data.payload?.projectId),
            Array.isArray(event.data.payload?.worldbookEntryKeys) ? event.data.payload?.worldbookEntryKeys.map(String) : undefined,
            _.isString(event.data.payload?.worldbookName) ? String(event.data.payload?.worldbookName) : undefined,
            _.isString(event.data.payload?.projectVersion) ? String(event.data.payload?.projectVersion) : undefined,
            event.data.payload?.manageOriginalConflicts === true,
            _.isString(event.data.payload?.downloadUrl) ? String(event.data.payload?.downloadUrl) : undefined,
            Array.isArray(event.data.payload?.regexEntryKeys) ? event.data.payload.regexEntryKeys.map(String) : undefined,
            emitProgress,
            _.isString(event.data.payload?.regexDownloadUrl) ? String(event.data.payload.regexDownloadUrl) : undefined,
          );
          emitProgress('regex');
          try { await applyPreparedCreativeWorkshopRegex(String(event.data.payload?.projectId), installedDetail,
            prepareCreativeWorkshopRegexEntries(installedDetail, Array.isArray(event.data.payload?.regexEntryKeys) ? event.data.payload.regexEntryKeys.map(String) : undefined));
          } catch (error) { throw new Error('部分完成：DLC 世界书阶段已完成，角色正则未通过验收。请重新扫描并重试：' + (error instanceof Error ? error.message : String(error))); }
          emitProgress('regex_verify');
          await verifyCreativeWorkshopRegexInstallation(
            String(event.data.payload?.projectId),
            installedDetail,
            undefined,
            Array.isArray(event.data.payload?.regexEntryKeys) ? event.data.payload.regexEntryKeys.map(String) : undefined,
          );
          emitProgress('registry');
          setCreativeWorkshopInstallRecord(String(event.data.payload?.projectId), installedDetail.installRecord);
          if (getCreativeWorkshopInstallRecord(String(event.data.payload?.projectId))?.installedVersion !== installedDetail.installRecord.installedVersion)
            throw new Error('部分完成：安装记录未保存，请重新扫描');
          emitProgress('final_verify');
          const verifiedInstallScan = await verifyFinalCreativeWorkshopInstallScan(
            String(event.data.payload?.projectId),
            String(installedDetail.project.version),
            installedDetail.installRecord.worldbookName,
          );
          await post(
            'bridge:install-result',
            {
              success: true,
              projectId: String(event.data.payload?.projectId),
              ...verifiedInstallScan,
            },
            event.data.requestId,
          );
          await post('bridge:context', getCurrentCreativeWorkshopContext(), event.data.requestId);
          break;
        case 'bridge:transfer-installed-worldbook': {
          const projectId = actionProjectId || '';
          const sourceName = _.isString(event.data.payload?.sourceWorldbookName)
            ? String(event.data.payload.sourceWorldbookName) : '';
          const targetName = _.isString(event.data.payload?.targetWorldbookName)
            ? String(event.data.payload.targetWorldbookName) : '';
          await transferCreativeWorkshopInstalledWorldbook(projectId, sourceName, targetName);
          const scan = await scanInstalledCreativeWorkshopProjects();
          const targetScanned = scan.scannedWorldbookNames.includes(targetName);
          const targetVisible = scan.projects.some(project =>
            project.projectId === projectId && project.worldbookName === targetName);
          if (!scan.complete || scan.projects.some(project =>
              project.projectId === projectId && project.worldbookName === sourceName) ||
              targetVisible !== targetScanned)

            throw new Error('迁移写入完成但最终扫描未通过，请检查来源与目标，勿重复操作');
          await post('bridge:transfer-installed-result',
            { success: true, projectId, movedOutsideScan: !targetScanned, ...scan }, event.data.requestId);
          await post('bridge:context', getCurrentCreativeWorkshopContext(), event.data.requestId);
          break;
        }
        case 'bridge:create-additional-worldbook': {
          const name = _.isString(event.data.payload?.worldbookName) ? String(event.data.payload.worldbookName) : '';
          const createdName = await createCreativeWorkshopAdditionalWorldbook(name);
          await post('bridge:create-additional-worldbook-result', { worldbookName: createdName }, event.data.requestId);
          await post('bridge:context', getCurrentCreativeWorkshopContext(), event.data.requestId);
          break;
        }
        case 'bridge:uninstall-project':
          if (!_.isString(_.get(event.data, 'payload.projectId'))) {
            throw new Error('缺少 projectId');
          }
          await uninstallCreativeWorkshopProject(
            String(event.data.payload?.projectId),
            actionLegacyProjectName,
            _.isString(event.data.payload?.worldbookName) ? String(event.data.payload.worldbookName) : undefined,
          );
          const remainingScan = await scanInstalledCreativeWorkshopProjects();
          if (!remainingScan.complete) {
            throw new Error('所选世界书已执行卸载，但其他世界书暂时读不到。共享 Regex 已保留，请重新扫描确认后再继续');
          }
          const remainingProjects = remainingScan.projects;
          const stillInstalled = remainingProjects.some(project =>
            project.entryCount > 0 &&
            (project.projectId === String(event.data.payload?.projectId) ||
              Boolean(actionLegacyProjectName && project.projectId === actionLegacyProjectName)));
          if (!stillInstalled) {
            await uninstallCreativeWorkshopRegex(String(event.data.payload?.projectId), actionLegacyProjectName);
            deleteCreativeWorkshopInstallRecord(String(event.data.payload?.projectId));
            if (actionLegacyProjectName && actionLegacyProjectName !== String(event.data.payload?.projectId))
              deleteCreativeWorkshopInstallRecord(actionLegacyProjectName);
          }
          await post(
            'bridge:uninstall-result',
            {
              success: true,
              projectId: String(event.data.payload?.projectId),
              ...await scanInstalledCreativeWorkshopProjects(),
            },
            event.data.requestId,
          );
          break;
        case 'bridge:get-project-diff': {
          if (!_.isString(_.get(event.data, 'payload.projectId'))) {
            throw new Error('缺少 projectId');
          }
          const diffResult = await getCreativeWorkshopProjectDiff(
            String(event.data.payload?.projectId),
            _.isString(event.data.payload?.projectVersion) ? String(event.data.payload?.projectVersion) : undefined,
            actionLegacyProjectName,
            _.isString(event.data.payload?.worldbookName) ? String(event.data.payload.worldbookName) : undefined,
          );
          await post('bridge:project-diff', diffResult, event.data.requestId);
          break;
        }
        case 'bridge:confirm-project-update':
          if (!_.isString(_.get(event.data, 'payload.projectId'))) {
            throw new Error('缺少 projectId');
          }
          const expectedVersion = _.isString(event.data.payload?.projectVersion)
            ? String(event.data.payload?.projectVersion)
            : undefined;
          const updatedDetail = await updateCreativeWorkshopProject(
            String(event.data.payload?.projectId),
            expectedVersion,
            actionLegacyProjectName,
            event.data.payload?.manageOriginalConflicts === true,
            _.isString(event.data.payload?.downloadUrl) ? String(event.data.payload?.downloadUrl) : undefined,
            _.isString(event.data.payload?.worldbookName) ? String(event.data.payload?.worldbookName) : undefined,
            Array.isArray(event.data.payload?.approvedDuplicates) ? event.data.payload.approvedDuplicates : [],
            emitProgress,
            _.isString(event.data.payload?.regexDownloadUrl) ? String(event.data.payload.regexDownloadUrl) : undefined,
          );
          emitProgress('worldbook_verify');
          try {
            await verifyCreativeWorkshopApprovedDuplicateState(String(event.data.payload?.projectId), updatedDetail.worldbookVerification?.worldbookName || null, updatedDetail.duplicateSnapshots, actionLegacyProjectName);
          } catch (error) {
            throw new Error('部分完成：世界书已更新，但重复副本检查失败，请重新扫描：' +
              (error instanceof Error ? error.message : String(error)));
          }
          emitProgress('regex');
          try {
            await applyPreparedCreativeWorkshopRegex(String(event.data.payload?.projectId), updatedDetail,
            prepareCreativeWorkshopRegexEntries(updatedDetail), actionLegacyProjectName);
          } catch (error) { throw new Error('部分完成：世界书已更新，角色正则未通过验收。请重新扫描并重试：' + (error instanceof Error ? error.message : String(error))); }
          emitProgress('regex_verify');
          await verifyCreativeWorkshopRegexInstallation(String(event.data.payload?.projectId), updatedDetail, actionLegacyProjectName);
          if (updatedDetail.duplicateSnapshots?.length) emitProgress('cleanup');
          try { await removeCreativeWorkshopApprovedDuplicates(String(event.data.payload?.projectId), updatedDetail.duplicateSnapshots, actionLegacyProjectName, updatedDetail.worldbookVerification); }
          catch (error) { throw new Error('部分完成：选定位置已更新，但重复副本清理未通过验收，请重新扫描并确认：' + (error instanceof Error ? error.message : String(error))); }
          emitProgress('registry');
          setCreativeWorkshopInstallRecord(String(event.data.payload?.projectId), updatedDetail.installRecord);
          if (getCreativeWorkshopInstallRecord(String(event.data.payload?.projectId))?.installedVersion !== updatedDetail.installRecord.installedVersion)
            throw new Error('部分完成：安装记录未保存，请重新扫描');
          if (actionLegacyProjectName && actionLegacyProjectName !== String(event.data.payload?.projectId))
            deleteCreativeWorkshopInstallRecord(actionLegacyProjectName);
          emitProgress('final_verify');
          const verifiedUpdateScan = await verifyFinalCreativeWorkshopInstallScan(
            String(event.data.payload?.projectId),
            String(updatedDetail.project.version),
            updatedDetail.installRecord.worldbookName,
          );
          await post(
            'bridge:update-result',
            {
              success: true,
              projectId: String(event.data.payload?.projectId),
              ...verifiedUpdateScan,
            },
            event.data.requestId,
          );
          break;
        case 'bridge:repair:scan': {
          const requestedWorldbookNames = Array.isArray(event.data.payload?.worldbookNames)
            ? event.data.payload?.worldbookNames.filter(_.isString).map(String)
            : undefined;
          const report = await scanCreativeWorkshopRepairCandidates({ worldbookNames: requestedWorldbookNames });
          await post('bridge:repair:scan-result', report, event.data.requestId);
          break;
        }
        case 'bridge:repair:project': {
          const result = await repairCreativeWorkshopProject({
            candidateId: _.isString(_.get(event.data, 'payload.candidateId')) ? String(event.data.payload?.candidateId) : '',
            projectId: _.isString(_.get(event.data, 'payload.projectId')) ? String(event.data.payload?.projectId) : '',
            projectVersion: _.isString(_.get(event.data, 'payload.projectVersion')) ? String(event.data.payload?.projectVersion) : null,
            downloadUrl: _.isString(_.get(event.data, 'payload.downloadUrl')) ? String(event.data.payload?.downloadUrl) : null,
            worldbookName: _.isString(_.get(event.data, 'payload.worldbookName')) ? String(event.data.payload?.worldbookName) : '',
            entryUids: Array.isArray(event.data.payload?.entryUids)
              ? (event.data.payload?.entryUids as Array<string | number>)
              : [],
            regexIds: Array.isArray(event.data.payload?.regexIds)
              ? event.data.payload?.regexIds.filter(_.isString).map(String)
              : [],
            expectedEntryCount: _.isNumber(_.get(event.data, 'payload.expectedEntryCount'))
              ? Number(event.data.payload?.expectedEntryCount)
              : undefined,
            expectedRegexCount: _.isNumber(_.get(event.data, 'payload.expectedRegexCount'))
              ? Number(event.data.payload?.expectedRegexCount)
              : undefined,
            sourceProjectIds: Array.isArray(event.data.payload?.sourceProjectIds)
              ? event.data.payload?.sourceProjectIds.filter(_.isString).map(String)
              : [],
          });
          await post(
            'bridge:repair:project-result',
            { ...result, projects: await listInstalledCreativeWorkshopProjects() },
            event.data.requestId,
          );
          await post('bridge:context', getCurrentCreativeWorkshopContext(), event.data.requestId);
          break;
        }
        case 'bridge:close-workshop':
          onClose?.();
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
          const tauriTavernMobileExternalOpen =
            _.get(hostWindow, '__TAURITAVERN_MOBILE_WINDOW_OPEN_COMPAT__') === true;
          const popup = hostWindow.open(
            authUrl,
            OAUTH_POPUP_NAME,
            `width=${width},height=${height},left=${left},top=${top}`,
          );

          if (!popup && !tauriTavernMobileExternalOpen) {
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
            popupClosed: popup?.closed ?? null,
            externalBrowserOnly: tauriTavernMobileExternalOpen && !popup,
            pendingOauthRequestId,
            pendingOauthState,
          });
          startOAuthMonitors();
          break;
        }
      }
    } catch (error) {
      if (isTransferMutation) {
        console.error('[CreativeWorkshop DLC operation failed]', {
          errorCode: getDlcPhaseErrorCode(actionType, currentPhase),
          phase: currentPhase,
          action: actionType,
          projectId: actionProjectId,
          requestId: event.data.requestId,
          error,
        });
      }
      let failedScan;
      if (isProjectMutation) {
        try { failedScan = await scanInstalledCreativeWorkshopProjects(); }
        catch { failedScan = { projects: [], complete: false, unreadableWorldbookNames: [] }; }
      }
      await post(
        'bridge:error',
        {
          message: error instanceof Error ? error.message : String(error),
          ...(isTransferMutation ? { errorCode: getDlcPhaseErrorCode(actionType, currentPhase), phase: currentPhase } : {}),
          projectId: actionProjectId,
          action: actionType,
          ...failedScan,
        },
        event.data.requestId,
      );
    } finally {
      if (isProjectMutation && actionProjectId) projectMutationInFlight.delete(actionProjectId);
      // Both mutations and installed-project scans enter this queue.
      // A scan must release the queue even when migration/scanning fails.
      finishMutation?.();
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
