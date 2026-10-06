import { analyzeLocalProjectCode } from './index.mjs';
import { formatUploaderCodeCheckError, toUploaderCodeCheck } from './report.mjs';

self.onmessage = async ({ data: { file, kind } }) => {
  try {
    const text = await file.text();
    const report = analyzeLocalProjectCode([{ fileName: file.name, type: kind, text }]);
    self.postMessage({
      success: report.gate === 'accept',
      codeCheck: toUploaderCodeCheck(report),
      error: report.gate === 'reject' ? formatUploaderCodeCheckError(report) : '',
    });
  } catch {
    self.postMessage({ success: false, error: '浏览器未能完成文件检查。请减少本次提交的内容；若仍然失败，请联系管理员并附上页面截图。' });
  }
};
