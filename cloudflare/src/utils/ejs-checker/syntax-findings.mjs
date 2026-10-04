export function syntaxFindings(entry, parsed) {
  const syntaxRule = entry.sourceType === 'regex' ? 'JS-PARSE' : 'EJS-PARSE';
  return [
    ...parsed.errors.map(error => ({
      ruleId: syntaxRule, severity: 'high', index: error.index,
      title: entry.sourceType === 'regex' ? '正则中的脚本无法解析' : 'EJS 无法解析',
      detail: error.message,
      suggestion: '根据标出的行列检查脚本语法；修复后重新选择文件检查。',
    })),
    ...parsed.internalErrors.map(() => ({
      ruleId: 'CHECKER-INTERNAL', severity: 'high', index: 0,
      title: '代码检查暂时无法完成',
      detail: '检查服务未能完成本次检查，这不代表您的代码有语法错误。',
      suggestion: '请稍后重新选择文件检查；如果仍然失败，请联系管理员。',
    })),
  ];
}
