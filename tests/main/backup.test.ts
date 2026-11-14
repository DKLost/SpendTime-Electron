import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupDatabaseBeforeOpen } from '../../src/main/adapters/sqlite/backup'

const tempDirs: string[] = []

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spendtime-backup-'))
  tempDirs.push(dir)
  return dir
}

function createLogger() {
  const errors: unknown[] = []
  return {
    errors,
    logger: {
      info: (_message: string): void => undefined,
      error: (_message: string, details?: unknown): void => {
        errors.push(details)
      },
    },
  }
}

afterEach(function cleanup(): void {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('backupDatabaseBeforeOpen', () => {
  it('数据库不存在时不创建备份', () => {
    const dir = createTempDir()
    const { logger } = createLogger()
    const result = backupDatabaseBeforeOpen(
      { databasePath: join(dir, 'spendtime.db'), backupDir: join(dir, 'backups') },
      logger,
    )
    expect(result).toBeNull()
    expect(existsSync(join(dir, 'backups'))).toBe(false)
  })

  it('拷贝现有数据库并返回备份路径', () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'spendtime.db')
    writeFileSync(databasePath, 'sqlite-bytes')
    const { logger } = createLogger()

    const result = backupDatabaseBeforeOpen(
      {
        databasePath,
        backupDir: join(dir, 'backups'),
        now: new Date(2026, 10, 13, 10, 20, 30),
      },
      logger,
    )

    expect(result).toBe(join(dir, 'backups', 'spendtime-20261113-102030.db'))
    expect(existsSync(result ?? '')).toBe(true)
  })

  it('超过保留份数时删除最旧的备份', () => {
    const dir = createTempDir()
    const backupDir = join(dir, 'backups')
    mkdirSync(backupDir, { recursive: true })
    for (let day = 1; day <= 12; day += 1) {
      const stamp = `202611${String(day).padStart(2, '0')}-000000`
      writeFileSync(join(backupDir, `spendtime-${stamp}.db`), 'old')
    }
    const databasePath = join(dir, 'spendtime.db')
    writeFileSync(databasePath, 'sqlite-bytes')
    const { logger } = createLogger()

    backupDatabaseBeforeOpen(
      {
        databasePath,
        backupDir,
        retain: 10,
        now: new Date(2026, 10, 13, 10, 20, 30),
      },
      logger,
    )

    const files = readdirSync(backupDir).sort()
    expect(files).toHaveLength(10)
    expect(files).toContain('spendtime-20261113-102030.db')
    expect(files).not.toContain('spendtime-20261101-000000.db')
  })

  it('备份失败只记日志，不抛出异常', () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'spendtime.db')
    writeFileSync(databasePath, 'sqlite-bytes')
    // 用同名文件占住 backups 路径，mkdir 会失败
    const backupDir = join(dir, 'backups')
    writeFileSync(backupDir, 'not-a-directory')
    const { logger, errors } = createLogger()

    const result = backupDatabaseBeforeOpen({ databasePath, backupDir }, logger)

    expect(result).toBeNull()
    expect(errors).toHaveLength(1)
  })
})
