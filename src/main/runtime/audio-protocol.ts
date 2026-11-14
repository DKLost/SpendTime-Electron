import { protocol } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import {
  AUDIO_SCHEME,
  isManagedRingtoneFileName,
  parseRingtoneFileName,
} from '../adapters/ringtone-names'

// 自定义协议只暴露 userData/ringtones；内置铃声也会先复制到这里
export { AUDIO_SCHEME }

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
}

// 必须在 app ready 之前调用
export function registerAudioScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: AUDIO_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ])
}

export function registerAudioProtocol(
  ringtoneDir: string,
  logError: (message: string, error: unknown) => void,
): void {
  const root = resolve(ringtoneDir)

  protocol.handle(AUDIO_SCHEME, async (request) => {
    const fileName = parseRingtoneFileName(request.url)
    if (fileName === null) {
      return notFound()
    }
    const target = resolve(join(root, fileName))
    // 双重校验：白名单文件名 + 解析后的父目录必须就是铃声目录
    if (dirname(target) !== root || !isManagedRingtoneFileName(fileName)) {
      return notFound()
    }
    try {
      const stats = await stat(target)
      if (!stats.isFile()) {
        return notFound()
      }
      const data = await readFile(target)
      const mime = MIME_BY_EXTENSION[extname(fileName).toLowerCase()] ?? 'application/octet-stream'
      return new Response(new Uint8Array(data), {
        headers: {
          'content-type': mime,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          // 波形需要渲染层 fetch 解码，允许白名单协议跨源读取
          'access-control-allow-origin': '*',
        },
      })
    } catch (error) {
      logError(`读取铃声失败：${fileName}`, error)
      return notFound()
    }
  })
}

function notFound(): Response {
  return new Response('Not Found', { status: 404 })
}
