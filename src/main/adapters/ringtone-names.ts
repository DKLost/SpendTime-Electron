// 文件名与协议地址的唯一白名单，协议、导入、删除共用
export const AUDIO_SCHEME = 'spendtime-audio'
export const AUDIO_HOST = 'ringtone'

const BUILTIN_NAME_PATTERN = /^builtin-(chime|bell|pulse)\.wav$/
const CUSTOM_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(mp3|wav|ogg|flac|m4a)$/i
// 导入期间的暂存文件：界面通过协议试听它，提交或取消后立刻消失
export const PENDING_NAME_PATTERN =
  /^pending-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(mp3|wav|ogg|flac|m4a)$/i

export function isManagedRingtoneFileName(name: string): boolean {
  return (
    BUILTIN_NAME_PATTERN.test(name) ||
    CUSTOM_NAME_PATTERN.test(name) ||
    PENDING_NAME_PATTERN.test(name)
  )
}

// 只接受 spendtime-audio://ringtone/<basename>，拒绝任何分隔符与编码绕过
export function parseRingtoneFileName(url: string): string | null {
  // URL 解析会把 ../ 规范化掉，先按原始字符串拒绝编码绕过
  if (/\.\.|%2e|%2f|%5c|%00/i.test(url)) {
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${AUDIO_SCHEME}:` || parsed.host !== AUDIO_HOST) {
    return null
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(parsed.pathname.slice(1))
  } catch {
    return null
  }
  if (
    decoded === '' ||
    decoded.includes('/') ||
    decoded.includes('\\') ||
    decoded.includes('\0') ||
    decoded.startsWith('.')
  ) {
    return null
  }
  return isManagedRingtoneFileName(decoded) ? decoded : null
}
