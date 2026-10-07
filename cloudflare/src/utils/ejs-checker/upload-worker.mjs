// Creator-device checker (#42).
//
// The Worker runs the complete rule set (L1-L7 / M / U / AH / API) in the
// creator's browser. #43 also reuses this browser Worker for lightweight
// project external-link presentation analysis; neither operation runs the
// heavy checker on Cloudflare.
import { analyzeProjectCodeV2 } from './index.mjs';
import { formatUploaderCodeCheckError, toUploaderCodeCheck } from './report.mjs';
import { collectProjectExternalLinks, externalLinksNeedingReview, groupExternalLinksByHostname } from '../external-links/collect.mjs';

self.onmessage = async ({ data }) => {
  try {
    if (data?.operation === 'external-links') {
      const records = collectProjectExternalLinks(data.project);
      self.postMessage({
        success: true,
        summary: {
          externalLinkRecords: records,
          externalLinksNeedingReview: externalLinksNeedingReview(records),
          externalLinkGroups: groupExternalLinksByHostname(records),
        },
      });
      return;
    }

    const { file, kind } = data || {};
    const text = await file.text();
    const report = analyzeProjectCodeV2([{ fileName: file.name, type: kind, text }]);
    self.postMessage({
      success: report.gate === 'accept',
      codeCheck: toUploaderCodeCheck(report),
      error: report.gate === 'reject' ? formatUploaderCodeCheckError(report) : '',
    });
  } catch {
    self.postMessage({ success: false, error: '浏览器未能完成文件检查。请减少本次提交的内容；若仍然失败，请联系管理员并附上页面截图。' });
  }
};
