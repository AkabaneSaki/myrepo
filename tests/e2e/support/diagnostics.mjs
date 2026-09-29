import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

function safeUrl(raw) {
  try {
    const url = new URL(raw);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return String(raw || '');
  }
}

function isWorkshopSource(raw) {
  const value = String(raw || '');
  return (
    value.includes('workshop-test.uika.cc.cd') ||
    /CreativeWorkshop(?:-staging)?\/index\.js/i.test(value) ||
    /(?:uikawinwing|AkabaneSaki)\/myrepo/i.test(value) ||
    value.includes('[CreativeWorkshop]')
  );
}

function isCriticalUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.origin === 'https://workshop-test.uika.cc.cd') return true;
    if (
      (url.origin === 'http://127.0.0.1:8000' || url.origin === 'http://localhost:8000') &&
      (url.pathname === '/' || /CreativeWorkshop/i.test(url.pathname))
    ) {
      return true;
    }
    return isWorkshopSource(raw);
  } catch {
    return isWorkshopSource(raw);
  }
}

export class JourneyDiagnostics {
  constructor(page) {
    this.page = page;
    this.currentStep = 'bootstrap';
    this.consoleErrors = [];
    this.pageErrors = [];
    this.failedRequests = [];
    this.badResponses = [];
    this.projectRequests = [];
    this.stateProvider = null;
  }

  start() {
    this.page.on('console', message => {
      if (message.type() !== 'error') return;
      const text = message.text();
      // Chromium reports HTTP resource failures through console too; network capture below is more useful.
      if (/^Failed to load resource:/i.test(text)) return;
      // Cloudflare injects its analytics beacon while Workshop CSP intentionally blocks third-party scripts.
      // This is expected telemetry noise, not an application runtime failure.
      if (/static\.cloudflareinsights\.com\/beacon\.min\.js/i.test(text) && /Content Security Policy/i.test(text)) return;
      const source = message.location()?.url || '';
      this.consoleErrors.push({
        step: this.currentStep,
        text,
        source: safeUrl(source),
        critical: isWorkshopSource(source) || isWorkshopSource(text),
      });
    });

    this.page.on('pageerror', error => {
      const stack = String(error.stack || error.message || '');
      this.pageErrors.push({
        step: this.currentStep,
        message: error.message,
        critical: isWorkshopSource(stack),
      });
    });

    this.page.on('request', request => {
      try {
        const url = new URL(request.url());
        if (url.pathname === '/api/projects') {
          this.projectRequests.push({
            step: this.currentStep,
            method: request.method(),
            page: url.searchParams.get('page'),
            pageSize: url.searchParams.get('pageSize'),
            sort: url.searchParams.get('sort'),
            search: url.searchParams.get('search'),
            tags: url.searchParams.get('tags'),
            category:
              url.searchParams.get('projectType') ||
              url.searchParams.get('type') ||
              url.searchParams.get('category'),
          });
        }
      } catch {}
    });

    this.page.on('requestfailed', request => {
      this.failedRequests.push({
        step: this.currentStep,
        url: safeUrl(request.url()),
        method: request.method(),
        failure: request.failure()?.errorText || 'request failed',
        critical: isCriticalUrl(request.url()),
      });
    });

    this.page.on('response', response => {
      if (response.status() < 400) return;
      this.badResponses.push({
        step: this.currentStep,
        url: safeUrl(response.url()),
        status: response.status(),
        critical: isCriticalUrl(response.url()),
      });
    });
  }

  markStep(name) {
    this.currentStep = String(name || 'unknown-step');
  }

  registerStateProvider(provider) {
    this.stateProvider = provider;
  }

  latestProjectRequests() {
    return [...this.projectRequests];
  }

  assertHealthy() {
    expect(
      this.pageErrors.filter(item => item.critical),
      'Workshop 出现未捕获 JavaScript 异常',
    ).toEqual([]);
    expect(
      this.consoleErrors.filter(item => item.critical),
      'Workshop 出现 console.error',
    ).toEqual([]);
    expect(
      this.failedRequests.filter(item => item.critical),
      'ST / Workshop 关键请求发生 requestfailed',
    ).toEqual([]);
    expect(
      this.badResponses.filter(item => item.critical && item.status >= 500),
      'ST / Workshop 关键请求出现 5xx',
    ).toEqual([]);
  }

  async attachFailureArtifacts(testInfo) {
    if (testInfo.status === 'passed' && testInfo.expectedStatus === 'passed') return;
    if (testInfo.status === 'skipped' && testInfo.expectedStatus === 'skipped') return;

    let state = {
      failedStep: this.currentStep,
      pageUrl: safeUrl(this.page.url()),
      title: await this.page.title().catch(() => ''),
      viewport: this.page.viewportSize(),
      frames: this.page.frames().map(frame => safeUrl(frame.url())),
      consoleErrors: this.consoleErrors,
      pageErrors: this.pageErrors,
      failedRequests: this.failedRequests,
      badResponses: this.badResponses,
      projectRequests: this.projectRequests,
    };

    if (this.stateProvider) {
      try {
        state = { ...state, workshopState: await this.stateProvider() };
      } catch (error) {
        state.workshopStateError = error?.message || String(error);
      }
    }

    const statePath = testInfo.outputPath('journey-failure-state.json');
    await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
    await testInfo.attach('journey-failure-state', {
      path: statePath,
      contentType: 'application/json',
    });

    const screenshotPath = testInfo.outputPath('journey-failure.png');
    await this.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    await testInfo.attach('journey-failure-screenshot', {
      path: screenshotPath,
      contentType: 'image/png',
    }).catch(() => {});
  }
}
