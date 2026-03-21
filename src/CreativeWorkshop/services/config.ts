const DEFAULT_CREATIVE_WORKSHOP_URL = 'https://poemofdestinycreativeworkshop.1528779666.workers.dev';
const CREATIVE_WORKSHOP_URL_VARIABLE_KEY = 'creative_workshop_worker_url';

function normalizeCreativeWorkshopUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function getCreativeWorkshopUrl(): string {
  const scriptId = getScriptId();
  const variables = getVariables({ type: 'script', script_id: scriptId });
  const customUrl = _.get(variables, CREATIVE_WORKSHOP_URL_VARIABLE_KEY);

  if (_.isString(customUrl) && customUrl.trim()) {
    return normalizeCreativeWorkshopUrl(customUrl);
  }

  return DEFAULT_CREATIVE_WORKSHOP_URL;
}

export function getCreativeWorkshopOrigin(): string {
  return new URL(getCreativeWorkshopUrl()).origin;
}
