import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const appSource = await readFile(resolve('src/pages/home/app.ts'), 'utf8');
const authSource = await readFile(resolve('src/endpoints/auth.ts'), 'utf8');
const hostSource = await readFile(resolve('../src/CreativeWorkshop/bridge/host.ts'), 'utf8');

assert.match(appSource, /PENDING_OAUTH_STORAGE_KEY = 'creative_workshop_pending_oauth_v1'/);
assert.match(appSource, /OAUTH_MAX_WAIT_MS = 5 \* 60 \* 1000/);
assert.match(appSource, /function resumeEmbeddedOAuthPolling\(\)/);
assert.match(appSource, /window\.addEventListener\('focus', resumeEmbeddedOAuthPolling\)/);
assert.match(appSource, /document\.addEventListener\('visibilitychange'/);
assert.match(appSource, /OAuth poll temporary failure; retrying/);
assert.match(appSource, /startEmbeddedOAuthPolling\(data\.state\)/);
assert.ok(
  appSource.indexOf('startEmbeddedOAuthPolling(data.state)') < appSource.indexOf('requestOAuthLogin(data.url, data.state)'),
  'embedded OAuth state must be persisted before the external browser is opened',
);
assert.match(appSource, /pollEmbeddedOAuthOnce\(\{ force: true \}\)/);
assert.match(appSource, /if \(!embeddedOAuthSession\)[\s\S]*readPendingOAuth\(\)/);
assert.doesNotMatch(appSource, /finalizePoll\(\{ success: false, message: '登录状态检查失败，请重试登录' \}\)/);

const pollClassStart = authSource.indexOf('export class AuthPoll');
const callbackClassStart = authSource.indexOf('export class AuthCallback');
assert.ok(pollClassStart >= 0 && callbackClassStart > pollClassStart, 'AuthPoll/AuthCallback source must be readable');
const pollSource = authSource.slice(pollClassStart, callbackClassStart);
assert.match(pollSource, /SESSION_KV\.get\(pollKey, \{ cacheTtl: 30 \}\)/);
assert.doesNotMatch(pollSource, /SESSION_KV\.delete\(pollKey\)/);

assert.match(hostSource, /OAUTH_TIMEOUT_MS = 5 \* 60 \* 1000/);
assert.match(hostSource, /__TAURITAVERN_MOBILE_WINDOW_OPEN_COMPAT__/);
assert.match(hostSource, /if \(!popup && !tauriTavernMobileExternalOpen\)/);
assert.match(hostSource, /externalBrowserOnly: tauriTavernMobileExternalOpen && !popup/);
assert.match(hostSource, /if \(oauthPopup\) \{[\s\S]*oauthClosePollId = hostWindow\.setInterval/);
assert.match(hostSource, /callbackReady: true/);
assert.match(hostSource, /'bridge:oauth:result'/);

console.log('OAuth external-browser smoke checks passed.');
