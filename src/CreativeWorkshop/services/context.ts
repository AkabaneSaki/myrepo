export function getCurrentCreativeWorkshopContext() {
  const charWorldbooks = getCharWorldbookNames('current');
  let chatWorldbook: string | null = null;
  try { chatWorldbook = getChatWorldbookName('current'); } catch {}
  return {
    connected: true,
    characterName: getCurrentCharacterName(),
    worldbooks: {
      primary: charWorldbooks.primary,
      additional: charWorldbooks.additional || [],
      available: getWorldbookNames(),
      global: getGlobalWorldbookNames(),
      chat: chatWorldbook,
    },
    regexEnabled: isCharacterTavernRegexesEnabled(),
    chatId: SillyTavern.getCurrentChatId(),
  };
}
