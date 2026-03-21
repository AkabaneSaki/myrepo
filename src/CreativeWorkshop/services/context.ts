export function getCurrentCreativeWorkshopContext() {
  const charWorldbooks = getCharWorldbookNames('current');
  return {
    connected: true,
    characterName: getCurrentCharacterName(),
    worldbooks: {
      primary: charWorldbooks.primary,
      additional: charWorldbooks.additional || [],
    },
    regexEnabled: isCharacterTavernRegexesEnabled(),
    chatId: SillyTavern.getCurrentChatId(),
  };
}
