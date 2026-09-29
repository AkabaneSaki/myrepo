import { expect } from '@playwright/test';

export async function captureCssBaseline(locator, name, options = {}) {
  const masks = Array.isArray(options.mask) ? options.mask : [];
  await expect(locator).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    mask: masks,
    maxDiffPixelRatio: 0.01,
  });
}
