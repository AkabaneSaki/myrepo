export function syntaxFindings(entry, parsed) {
  const syntaxRule = entry.sourceType === 'regex' ? 'JS-PARSE' : 'EJS-PARSE';
  return [
    ...parsed.errors.map(error => ({
      ruleId: syntaxRule, severity: 'high', index: error.index,
      title: entry.sourceType === 'regex' ? '正则中的脚本无法解析' : 'EJS 无法解析',
      detail: error.message,
      suggestion: '根据标出的行列检查脚本语法；修复后重新选择文件检查。',
    })),
    ...parsed.internalErrors.map(error => ({
      ruleId: error.kind === 'limit' ? 'CHECKER-LIMIT' : 'CHECKER-INTERNAL', severity: 'high', index: 0,
      title: error.kind === 'limit' ? '内容超过本次检查的处理上限' : '代码检查暂时无法完成',
      detail: error.kind === 'limit' ? error.message : '检查服务未能完成本次检查，这不代表您的代码有语法错误。',
      suggestion: error.kind === 'limit' ? '请按提示减少本次提交的内容，或拆分过大的脚本；重复提交相同内容仍无法通过。' : '请联系管理员，并附上当前页面截图。',
    })),
  ];
}
