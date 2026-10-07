import workshopConfig from '../../../config/workshop.json';
import {
  DISCORD_SNOWFLAKE_PATTERN,
  normalizeProjectDiscordThreadUrl as normalizeThreadUrl,
} from './external-links/policy.mjs';

// The Discord shape and guild rules live in the shared external-link policy so
// the generic link checker and this project field validator can never disagree.
// Only the user-facing Chinese error messages stay here.
const DISCORD_HOSTS_ERROR = 'Discord 讨论帖必须使用 discord.com 的 HTTPS 链接';
const THREAD_SHAPE_ERROR = '请填写 Discord 讨论帖链接，不要填写单条消息链接或邀请链接';
const SNOWFLAKE_ERROR = 'Discord 讨论帖链接中的服务器或帖子 ID 不正确';
const GUILD_ERROR = '这个 Discord 讨论帖不在允许的游戏讨论服务器中';

export function getAllowedProjectDiscordGuildIds(): string[] {
  const configured = (workshopConfig as any)?.projectCommunity?.discordGuildIds;
  if (!Array.isArray(configured)) return [];
  return Array.from(new Set(
    configured.map(value => String(value || '').trim()).filter(value => DISCORD_SNOWFLAKE_PATTERN.test(value)),
  ));
}

export function normalizeProjectDiscordThreadUrl(value: unknown): string | null {
  const result = normalizeThreadUrl(value, getAllowedProjectDiscordGuildIds());
  if (result.ok) return result.value;

  throw new Error(
    {
      'invalid-url': 'Discord 讨论帖链接格式不正确',
      'not-https-discord-host': DISCORD_HOSTS_ERROR,
      'not-a-thread-url': THREAD_SHAPE_ERROR,
      'invalid-snowflake': SNOWFLAKE_ERROR,
      'guild-not-allowed': GUILD_ERROR,
    }[result.reason] ?? 'Discord 讨论帖链接格式不正确',
  );
}

export function validateProjectDiscordThreadUrl(value: unknown): { value: string | null; error: string | null } {
  try {
    return { value: normalizeProjectDiscordThreadUrl(value), error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}
