// Reviewer-device checker (#42).
//
// Runs the same complete rule set as the creator device over the exact pending
// content the Worker just handed out, merges the previously accepted baseline, and
// returns everything the server needs to bind the trusted reviewer's submitted
// result: hashes, revisions, gate and the audit snapshot. The server verifies only
// those bindings afterwards and never re-runs this analysis.
import { analyzeProjectCodeV2, CHECKER_VERSION } from './index.mjs';
import { applyAuditBaseline, buildAuditSnapshot } from './audit.mjs';

self.onmessage = async ({ data: { files, baseline, projectId, draftRevision } }) => {
  try {
    const report = analyzeProjectCodeV2(files);
    const auditSnapshot = report.gate === 'reject' ? null : await buildAuditSnapshot(files, report);
    const merged = auditSnapshot
      ? applyAuditBaseline(report, auditSnapshot, baseline || null)
      : report;
    self.postMessage({
      success: true,
      gate: report.gate,
      audit: merged.audit,
      certification: merged.certification,
      engine: report.engine,
      parserCompatibility: report.parserCompatibility,
      policyVersion: report.policyVersion,
      checkerRevision: CHECKER_VERSION.engine + ':' + CHECKER_VERSION.policyVersion,
      projectId,
      draftRevision,
      filesHash: auditSnapshot ? auditSnapshot.filesHash : '',
      auditSnapshot,
      report: merged,
    });
  } catch {
    self.postMessage({ success: false, error: '本机未能完成这条内容检查，请稍后重试或联系维护人员。' });
  }
};
