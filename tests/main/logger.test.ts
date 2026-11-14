import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildLogFileName,
  createFileLogger,
  extractLogFileDate,
  formatLogFileDate,
  formatLogLine,
  selectExpiredLogFiles,
  serializeDetails,
  truncateLogContent,
} from '../../src/main/adapters/logger'

const DAY = 86_400_000

// 测试用固定基准日，避免依赖运行机器的日历
function dayBefore(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) - days * DAY).toISOString().slice(0, 10)
}

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'spendtime-log-'))
  try {
    run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('日志格式', () => {
  it('文件名使用本地日期，前缀固定为 main', () => {
    expect(formatLogFileDate(new Date(2026, 10, 13, 23, 59).getTime())).toBe('2026-11-13')
    expect(buildLogFileName('2026-11-13')).toBe('main-2026-11-13.log')
  })

  it('每条日志一行，包含级别、作用域与可选详情', () => {
    const line = formatLogLine({
      now: Date.UTC(2026, 10, 13, 1, 2, 3),
      level: 'error',
      scope: 'main',
      message: '写入失败',
      details: { code: 7 },
    })
    expect(line).toBe('2026-11-13T01:02:03.000Z ERROR [main] 写入失败 {"code":7}\n')
    expect(line.endsWith('\n')).toBe(true)
    expect(line.slice(0, -1).includes('\n')).toBe(false)
  })

  it('Error 详情取堆栈，循环结构退化为字符串', () => {
    const error = new Error('boom')
    expect(serializeDetails(error)).toContain('Error: boom')
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    expect(serializeDetails(circular)).toBe('[object Object]')
    expect(serializeDetails(undefined)).toBe('')
  })
})

describe('日志截断', () => {
  it('未超限时原样返回', () => {
    expect(truncateLogContent('abc\n', 100)).toBe('abc\n')
  })

  it('超限时保留尾部并从完整行开始', () => {
    const content = ['aaaa', 'bbbb', 'cccc', 'dddd'].map((line) => `${line}\n`).join('')
    const truncated = truncateLogContent(content, 16)
    expect(truncated.startsWith('\n')).toBe(false)
    expect(truncated).toBe('dddd\n')
  })
})

describe('过期日志筛选', () => {
  it('保留最近 14 天，删除恰好第 14 天前的文件', () => {
    const today = '2026-11-13'
    const files = [today, dayBefore(today, 1), dayBefore(today, 13), dayBefore(today, 14)].map((date) =>
      buildLogFileName(date),
    )
    expect(selectExpiredLogFiles(files, today, 14)).toEqual([
      buildLogFileName(dayBefore(today, 14)),
    ])
  })

  it('忽略非日志文件与无法解析的日期', () => {
    const files = ['notes.txt', 'main-2026-11-13.log.bak', 'main-latest.log', 'main-2026-13-40.log']
    expect(selectExpiredLogFiles(files, '2026-11-13', 14)).toEqual([])
    expect(extractLogFileDate('main-2026-11-13.log')).toBe('2026-11-13')
    expect(extractLogFileDate('main-2026-11-13.log.bak')).toBeNull()
  })

  it('非法今天日期时不删除任何文件', () => {
    expect(selectExpiredLogFiles(['main-2026-01-01.log'], 'today', 14)).toEqual([])
  })
})

describe('文件日志', () => {
  it('按日期写入独立文件，并清理过期文件', () => {
    withTempDir((dir) => {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'main-2026-10-01.log'), 'old\n', 'utf8')
      writeFileSync(join(dir, 'notes.txt'), 'keep\n', 'utf8')

      const now = new Date(2026, 10, 13, 10, 0).getTime()
      const logger = createFileLogger({ dir, scope: 'main', now: () => now })
      logger.info('启动完成')
      logger.error('出现异常', new Error('boom'))

      const filePath = join(dir, buildLogFileName('2026-11-13'))
      expect(existsSync(filePath)).toBe(true)
      const content = readFileSync(filePath, 'utf8')
      // 堆栈本身是多行，按级别标记计数而不是按行数
      expect(content.match(/INFO \[main\]/g)).toHaveLength(1)
      expect(content.match(/ERROR \[main\]/g)).toHaveLength(1)
      expect(content).toContain('INFO [main] 启动完成')
      expect(content).toContain('ERROR [main] 出现异常')

      expect(existsSync(join(dir, 'main-2026-10-01.log'))).toBe(false)
      expect(existsSync(join(dir, 'notes.txt'))).toBe(true)
    })
  })

  it('单文件超出上限时截断尾部，不超过 maxBytes', () => {
    withTempDir((dir) => {
      const now = new Date(2026, 10, 13, 10, 0).getTime()
      const maxBytes = 400
      const logger = createFileLogger({ dir, scope: 'main', now: () => now, maxBytes })

      for (let index = 0; index < 40; index += 1) {
        logger.info(`第 ${index} 条日志，用来把文件撑到上限`)
      }

      const filePath = join(dir, buildLogFileName('2026-11-13'))
      const size = statSync(filePath).size
      expect(size).toBeLessThanOrEqual(maxBytes)
      const content = readFileSync(filePath, 'utf8')
      expect(content).toContain('第 39 条日志')
      expect(readdirSync(dir)).toEqual([buildLogFileName('2026-11-13')])
    })
  })

  it('跨天写入时切换到新文件', () => {
    withTempDir((dir) => {
      let current = new Date(2026, 10, 13, 23, 59).getTime()
      const logger = createFileLogger({ dir, scope: 'main', now: () => current })
      logger.info('第一天')
      current += 2 * 60_000
      logger.info('第二天')

      expect(existsSync(join(dir, 'main-2026-11-13.log'))).toBe(true)
      expect(readFileSync(join(dir, 'main-2026-11-14.log'), 'utf8')).toContain('第二天')
      expect(readFileSync(join(dir, 'main-2026-11-13.log'), 'utf8')).toContain('第一天')
    })
  })

  it('目录不可写时不抛出，降级到控制台', () => {
    withTempDir((dir) => {
      const blocker = join(dir, 'blocker')
      writeFileSync(blocker, 'not a directory', 'utf8')
      const logger = createFileLogger({ dir: join(blocker, 'logs'), scope: 'main' })
      expect(() => logger.info('不会抛')).not.toThrow()
    })
  })
})
