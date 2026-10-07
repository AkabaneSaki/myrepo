export const homeExternalLinksScript = String.raw`
function inspectProjectExternalLinksOnDevice(project, worldbookEntries, regexEntries) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(UPLOAD_CHECKER_URL);
    const finish = (error, summary) => {
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(new Error(error)); else resolve(summary);
    };
    const timer = setTimeout(() => finish('链接检查用时过长，请重新打开项目再试。'), UPLOAD_CHECKER_TIMEOUT_MS);
    worker.onerror = () => finish('链接检查未完成，请重新打开项目再试。');
    worker.onmessage = ({ data }) => {
      const complete = data?.success && Array.isArray(data?.summary?.externalLinkRecords) && Array.isArray(data?.summary?.externalLinksNeedingReview);
      finish(complete ? '' : (data?.error || '链接检查未完成，请重新打开项目再试。'), data?.summary);
    };
    worker.postMessage({ operation: 'external-links', project: {
      description: project?.description || '',
      precautions: project?.precautions || '',
      discordThreadUrl: project?.discordThreadUrl || null,
      allowedGuildIds: WORKSHOP_CONFIG.projectCommunity?.discordGuildIds || [],
      worldbookEntries,
      regexEntries,
    } });
  });
}
`;
