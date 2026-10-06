import { spawn, spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testLabRoot = path.resolve(
  process.env.ST_TESTLAB_ROOT || path.join(repoRoot, '..', 'ST-TestLab'),
);
const targetDir = path.join(repoRoot, 'dist', 'CreativeWorkshop-staging');
const stUrl = process.env.ST_BASE_URL || 'http://127.0.0.1:8011/';
const workerUrl = process.env.WORKSHOP_LOCAL_WORKER || 'http://127.0.0.1:8791';
function resolvePnpmCli() {
  if (process.env.npm_execpath) return process.env.npm_execpath;

  if (process.platform === 'win32') {
    const found = spawnSync('where.exe', ['pnpm'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const candidates = String(found.stdout || '')
      .split(/\r?\n/)
      .map(value => value.trim())
      .filter(Boolean);
    const preferred =
      candidates.find(value => /\.exe$/i.test(value)) ||
      candidates.find(value => /\.cmd$/i.test(value)) ||
      candidates[0];
    if (preferred) return preferred;
  }

  return 'pnpm';
}

const pnpmCli = resolvePnpmCli();

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${options.label || command} exited with code ${result.status ?? 'unknown'}`,
    );
  }
}

function quoteCmdArg(value) {
  const text = String(value);
  if (!/[\s"&<>|^]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function runPnpm(args, options = {}) {
  if (/\.(?:c?js|mjs)$/i.test(pnpmCli)) {
    runChecked(process.execPath, [pnpmCli, ...args], options);
    return;
  }

  if (process.platform === 'win32' && /\.cmd$/i.test(pnpmCli)) {
    const commandLine = [pnpmCli, ...args].map(quoteCmdArg).join(' ');
    runChecked(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], options);
    return;
  }

  runChecked(pnpmCli, args, options);
}

async function canReach(url, init = {}) {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(1_500),
    });
    return response;
  } catch {
    return null;
  }
}

async function waitUntil(check, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(
    `Timed out waiting for ${label}${lastError ? `: ${lastError.message || lastError}` : ''}`,
  );
}

function killTree(child, label) {
  if (!child?.pid || child.exitCode !== null) return;

  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    if (result.status !== 0) {
      console.warn(`[TestLab] Could not fully stop ${label} tree (pid ${child.pid}).`);
    }
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {}
  }
}

async function prepareWorkshopBundle() {
  console.log('[TestLab] Building current Workshop staging bundle...');
  runPnpm(['exec', 'webpack', '--config', 'webpack.config.cjs', '--mode', 'production'], {
    label: 'Workshop staging build',
  });
}

async function ensureTestLabTarget() {
  const prepareScript = path.join(testLabRoot, 'scripts', 'prepare-fixtures.mjs');
  const interactiveScript = path.join(testLabRoot, 'scripts', 'run-interactive-target.mjs');

  await access(prepareScript);
  await access(interactiveScript);

  const existing = await canReach(stUrl);
  if (existing?.ok) {
    console.log(`[TestLab] Reusing SillyTavern at ${stUrl}`);
    runChecked(process.execPath, [prepareScript], {
      cwd: testLabRoot,
      env: { ...process.env, ST_TEST_TARGET: targetDir },
      label: 'TestLab target sync',
    });
    return null;
  }

  const url = new URL(stUrl);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(`ST_BASE_URL is not reachable and is not a local TestLab URL: ${stUrl}`);
  }

  console.log('[TestLab] SillyTavern is not running; starting the interactive TestLab target...');
  const child = spawn(process.execPath, [interactiveScript, targetDir], {
    cwd: testLabRoot,
    env: {
      ...process.env,
      ST_TEST_PORT: url.port || '8011',
    },
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
  });

  try {
    await waitUntil(async () => (await canReach(stUrl))?.ok === true, `SillyTavern at ${stUrl}`);
    // run-interactive-target installs the TavernHelper global script immediately after ST becomes reachable.
    // Give that bounded setup a moment before the Workshop journey opens a fresh browser profile.
    await new Promise(resolve => setTimeout(resolve, 3_000));
    return child;
  } catch (error) {
    killTree(child, 'SillyTavern TestLab');
    throw error;
  }
}

async function startLocalWorker() {
  const existing = await canReach(workerUrl);
  if (existing) {
    throw new Error(
      `Local Worker port is already in use at ${workerUrl}. Stop the existing 8791 process before this managed run so cleanup remains deterministic.`,
    );
  }

  console.log('[TestLab] Starting managed local Worker on 8791...');

  const child = spawn(
    process.execPath,
    [path.join(repoRoot, 'cloudflare', 'scripts', 'start-local-api-test.mjs')],
    {
      cwd: path.join(repoRoot, 'cloudflare'),
      env: process.env,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
    },
  );

  try {
    await waitUntil(async () => {
      const response = await canReach(new URL('/api/auth/local-preview', workerUrl), {
        method: 'POST',
      });
      return response?.ok === true;
    }, 'local Worker Admin endpoint on 8791');

    return child;
  } catch (error) {
    killTree(child, 'local Worker');
    throw error;
  }
}

function runAuditJourney() {
  console.log('[TestLab] Running upload → Gate → Audit Centre Playwright journey...');
  runPnpm(
    [
      'exec',
      'playwright',
      'test',
      'tests/e2e/testlab-upload-audit.spec.mjs',
      '--config',
      'playwright.config.mjs',
      '--project',
      'testlab-edge',
      '--retries=0',
      '--reporter=line',
    ],
    {
      label: 'TestLab audit Playwright journey',
      env: {
        ...process.env,
        ST_BASE_URL: stUrl,
        WORKSHOP_LOCAL_WORKER: workerUrl,
      },
    },
  );
}

let testLabChild = null;
let workerChild = null;

try {
  await prepareWorkshopBundle();
  testLabChild = await ensureTestLabTarget();
  workerChild = await startLocalWorker();
  runAuditJourney();
  console.log('[TestLab] Audit workflow passed.');
} finally {
  if (workerChild) {
    console.log('[TestLab] Stopping managed local Worker...');
    killTree(workerChild, 'local Worker');
    await waitUntil(async () => (await canReach(workerUrl)) === null, '8791 shutdown', 15_000).catch(
      error => console.warn('[TestLab] ' + error.message),
    );
  }

  if (testLabChild) {
    console.log('[TestLab] Stopping SillyTavern started by this run...');
    killTree(testLabChild, 'SillyTavern TestLab');
  }
}
