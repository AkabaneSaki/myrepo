import { analyzeProjectCodeV2, CHECKER_VERSION } from './index.mjs';

// Worker-isolate memory only: repeated submissions never create D1 reads/writes.
const reports = new Map();
const MAX_ENTRIES = 32;
const MAX_BYTES = 4 * 1024 * 1024;
const TTL_MS = 5 * 60 * 1000;
let bytes = 0;

export async function analyzeProjectCodeCached(inputs) {
  const identity = JSON.stringify([CHECKER_VERSION, inputs]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const existing = reports.get(key);
  if (existing && existing.expiresAt > Date.now()) {
    reports.delete(key);
    reports.set(key, existing);
    return structuredClone(existing.report);
  }
  if (existing) { reports.delete(key); bytes -= existing.size; }
  const report = analyzeProjectCodeV2(inputs);
  const size = new TextEncoder().encode(JSON.stringify(report)).byteLength;
  if (size <= MAX_BYTES) {
    while (reports.size >= MAX_ENTRIES || bytes + size > MAX_BYTES) {
      const oldestKey = reports.keys().next().value;
      bytes -= reports.get(oldestKey).size;
      reports.delete(oldestKey);
    }
    reports.set(key, { report: structuredClone(report), size, expiresAt: Date.now() + TTL_MS });
    bytes += size;
  }
  return report;
}
