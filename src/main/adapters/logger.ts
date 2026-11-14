import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { Logger } from '@application/ports'
import { LOG_FILE_PREFIX, LOG_MAX_BYTES, LOG_RETENTION_DAYS } from '../config/logging'

export type LogLevel = 'info' | 'error'

type LogRecord = {
  readonly now: number
  readonly level: LogLevel
  readonly scope: string
  readonly message: string
  readonly details?: unknown
}

export type FileLoggerOptions = {
  readonly dir: string
  readonly scope: string
  readonly retentionDays?: number
  readonly maxBytes?: number
  readonly now?: () => number
}

// 开发态写标准流；打包态同样保留，便于从终端排障
export function createConsoleLogger(scope: string): Logger {
  function write(level: LogLevel, message: string, details?: unknown): void {
    const target = level === 'error' ? console.error : console.log
    if (details === undefined) {
      target(`[${scope}] ${message}`)
      return
    }
    target(`[${scope}] ${message}`, details)
  }

  return {
    info: (message, details) => write('info', message, details),
    error: (message, details) => write('error', message, details),
  }
}

// 文件日志：每天一个 main-YYYY-MM-DD.log，保留 retentionDays 天，单文件超限时截断尾部
export function createFileLogger(options: FileLoggerOptions): Logger {
  const now = options.now ?? Date.now
  const retentionDays = options.retentionDays ?? LOG_RETENTION_DAYS
  const maxBytes = options.maxBytes ?? LOG_MAX_BYTES
  let preparedDate: string | null = null

  function prepare(date: string): void {
    try {
      mkdirSync(options.dir, { recursive: true })
      pruneExpiredLogs(options.dir, date, retentionDays)
    } catch (error) {
      console.error(`[${options.scope}] 初始化日志目录失败`, error)
    }
    preparedDate = date
  }

  function write(level: LogLevel, message: string, details?: unknown): void {
    try {
      const timestamp = now()
      const date = formatLogFileDate(timestamp)
      if (preparedDate !== date) {
        prepare(date)
      }
      const filePath = join(options.dir, buildLogFileName(date))
      const line = formatLogLine({ now: timestamp, level, scope: options.scope, message, details })
      truncateIfNeeded(filePath, maxBytes, Buffer.byteLength(line, 'utf8'))
      appendFileSync(filePath, line, 'utf8')
    } catch (error) {
      // 日志失败不能影响业务，降级到标准错误即可
      console.error(`[${options.scope}] 写入日志失败`, error)
    }
  }

  return {
    info: (message, details) => write('info', message, details),
    error: (message, details) => write('error', message, details),
  }
}

// 组合日志：开发态双写，生产态同样写文件；控制台失败不影响文件
export function createAppLogger(input: {
  readonly scope: string
  readonly logDir: string
  readonly isDev: boolean
  readonly now?: () => number
}): Logger {
  const consoleLogger = createConsoleLogger(input.scope)
  const fileLogger = createFileLogger({
    dir: input.logDir,
    scope: input.scope,
    now: input.now,
  })

  function info(message: string, details?: unknown): void {
    consoleLogger.info(message, details)
    fileLogger.info(message, details)
  }

  function error(message: string, details?: unknown): void {
    consoleLogger.error(message, details)
    fileLogger.error(message, details)
  }

  return { info, error }
}

export function buildLogFileName(date: string): string {
  return `${LOG_FILE_PREFIX}-${date}.log`
}

// 日志文件名与清理都使用本地日期，跨时区时与用户看到的日期一致
export function formatLogFileDate(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatLogLine(record: LogRecord): string {
  const time = new Date(record.now).toISOString()
  const head = `${time} ${record.level.toUpperCase()} [${record.scope}] ${record.message}`
  const details = serializeDetails(record.details)
  return details === '' ? `${head}\n` : `${head} ${details}\n`
}

export function serializeDetails(details: unknown): string {
  if (details === undefined) {
    return ''
  }
  if (details instanceof Error) {
    return details.stack ?? `${details.name}: ${details.message}`
  }
  if (typeof details === 'string') {
    return details
  }
  try {
    return JSON.stringify(details) ?? String(details)
  } catch {
    return String(details)
  }
}

// 按行截断尾部：保留最近的一半，避免一次写入把旧内容全丢掉
export function truncateLogContent(content: string, maxBytes: number): string {
  if (Buffer.byteLength(content, 'utf8') <= maxBytes) {
    return content
  }
  const keepBytes = Math.max(0, Math.floor(maxBytes / 2))
  const buffer = Buffer.from(content, 'utf8')
  const tail = buffer.subarray(Math.max(0, buffer.length - keepBytes)).toString('utf8')
  const firstBreak = tail.indexOf('\n')
  return firstBreak === -1 ? tail : tail.slice(firstBreak + 1)
}

// 文件名格式固定，无法解析的文件一律不动，避免误删用户数据
export function selectExpiredLogFiles(
  fileNames: readonly string[],
  today: string,
  retentionDays: number,
): readonly string[] {
  const todayMs = parseDateKey(today)
  if (todayMs === null) {
    return []
  }
  return fileNames.filter((name) => {
    const dateKey = extractLogFileDate(name)
    if (dateKey === null) {
      return false
    }
    const fileMs = parseDateKey(dateKey)
    if (fileMs === null) {
      return false
    }
    const ageDays = Math.floor((todayMs - fileMs) / 86_400_000)
    return ageDays >= retentionDays
  })
}

export function extractLogFileDate(fileName: string): string | null {
  const prefix = `${LOG_FILE_PREFIX}-`
  if (!fileName.startsWith(prefix) || !fileName.endsWith('.log')) {
    return null
  }
  const dateKey = fileName.slice(prefix.length, -'.log'.length)
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : null
}

function parseDateKey(dateKey: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (match === null) {
    return null
  }
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function pruneExpiredLogs(dir: string, today: string, retentionDays: number): void {
  const expired = selectExpiredLogFiles(readdirSync(dir), today, retentionDays)
  for (const name of expired) {
    unlinkSync(join(dir, name))
  }
}

// 写入前先腾出本次日志的空间，保证单文件不会超过上限
function truncateIfNeeded(filePath: string, maxBytes: number, incomingBytes: number): void {
  if (!existsSync(filePath)) {
    return
  }
  const size = statSync(filePath).size
  if (size + incomingBytes <= maxBytes) {
    return
  }
  const content = readFileSync(filePath, 'utf8')
  const keepBytes = Math.max(0, maxBytes - incomingBytes)
  writeFileSync(filePath, truncateLogContent(content, keepBytes), 'utf8')
}
