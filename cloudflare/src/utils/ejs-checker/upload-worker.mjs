// Creator-device checker (#42).
//
// The Worker must not run the heavy rule analysis on the upload path, so this
// bundle now runs the *complete* rule set (L1-L7 / M / U / AH / API) in the
// creator's browser instead of the local-only subset. A passing verdict here is
// the first of the two complete checks; the reviewer device runs the second.
import { analyzeProjectCodeV2 } from './index.mjs';
import { formatUploaderCodeCheckError, toUploaderCodeCheck } from './report.mjs';

self.onmessage = async ({ data: { file, kind } }) => {
  try {
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
