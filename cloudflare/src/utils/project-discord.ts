import workshopConfig from '../../../config/workshop.json';

const DISCORD_HOSTS = new Set(['discord.com', 'www.discord.com']);
const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

export function getAllowedProjectDiscordGuildIds(): string[] {
  const configured = (workshopConfig as any)?.projectCommunity?.discordGuildIds;
  if (!Array.isArray(configured)) return [];
  return Array.from(new Set(
    configured.map(value => String(value || '').trim()).filter(value => DISCORD_SNOWFLAKE_PATTERN.test(value)),
  ));
}

export function normalizeProjectDiscordThreadUrl(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Discord 讨论帖链接格式不正确');
  }

  if (url.protocol !== 'https:' || !DISCORD_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('Discord 讨论帖必须使用 discord.com 的 HTTPS 链接');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 3 || parts[0] !== 'channels') {
    throw new Error('请填写 Discord 讨论帖链接，不要填写单条消息链接或邀请链接');
  }

  const guildId = parts[1];
  const threadId = parts[2];
  if (!DISCORD_SNOWFLAKE_PATTERN.test(guildId) || !DISCORD_SNOWFLAKE_PATTERN.test(threadId)) {
    throw new Error('Discord 讨论帖链接中的服务器或帖子 ID 不正确');
  }

  const allowedGuildIds = getAllowedProjectDiscordGuildIds();
  if (!allowedGuildIds.includes(guildId)) {
    throw new Error('这个 Discord 讨论帖不在允许的游戏讨论服务器中');
  }

  return `https://discord.com/channels/${guildId}/${threadId}`;
}

export function validateProjectDiscordThreadUrl(value: unknown): { value: string | null; error: string | null } {
  try {
    return { value: normalizeProjectDiscordThreadUrl(value), error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}
