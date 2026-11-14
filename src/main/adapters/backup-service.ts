import { shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { err, ok, type Result } from '@core/result'
import type { BackupEntry, BackupService, Logger } from '@application/ports'
import type { Db } from './sqlite/database'

const BACKUP_PATTERN = /^spendtime-\d{8}-\d{6}\.db$/

export type BackupServiceDeps = {
  readonly db: Db
  readonly databasePath: string
  readonly backupDir: string
  readonly retain: () => number
  readonly logger: Logger
  readonly onRestart: () => void
}

export function createBackupService(deps: BackupServiceDeps): BackupService {
  function checkpoint(): void {
    try {
      deps.db.pragma('wal_checkpoint(TRUNCATE)')
    } catch (error) {
      deps.logger.error('备份前 WAL 检查点失败', error)
    }
  }

  function list(): readonly BackupEntry[] {
    if (!existsSync(deps.backupDir)) {
      return []
    }
    return readdirSync(deps.backupDir)
      .filter((name) => BACKUP_PATTERN.test(name))
      .sort()
      .reverse()
      .map((name) => {
        const stats = statSync(join(deps.backupDir, name))
        return { name, sizeBytes: stats.size, createdAt: stats.mtimeMs }
      })
  }

  function create(): BackupEntry | null {
    if (!existsSync(deps.databasePath)) {
      return null
    }
    try {
      mkdirSync(deps.backupDir, { recursive: true })
      checkpoint()
      const name = `spendtime-${stamp(new Date())}.db`
      const target = join(deps.backupDir, name)
      copyFileSync(deps.databasePath, target)
      prune(deps.backupDir, deps.retain())
      const stats = statSync(target)
      return { name, sizeBytes: stats.size, createdAt: stats.mtimeMs }
    } catch (error) {
      deps.logger.error('手动备份失败', error)
      return null
    }
  }

  function openDir(): boolean {
    if (!existsSync(deps.backupDir)) {
      return false
    }
    void shell.openPath(deps.backupDir)
    return true
  }

  function restore(name: string): Result<{ restarting: boolean }, { code: string; message: string }> {
    if (!BACKUP_PATTERN.test(name)) {
      return err({ code: 'INVALID_BACKUP', message: '备份文件名不合法' })
    }
    const source = join(deps.backupDir, name)
    if (!existsSync(source)) {
      return err({ code: 'NOT_FOUND', message: '备份文件不存在' })
    }
    try {
      checkpoint()
      // 覆盖前再留一份当前库，恢复错了还能回来
      copyFileSync(deps.databasePath, join(deps.backupDir, `pre-restore-${stamp(new Date())}.db`))
      copyFileSync(source, deps.databasePath)
      deps.onRestart()
      return ok({ restarting: true })
    } catch (error) {
      deps.logger.error('恢复备份失败', error)
      return err({ code: 'RESTORE_FAILED', message: '恢复备份失败，请查看日志' })
    }
  }

  return { list, create, openDir, restore }
}

function stamp(date: Date): string {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    '-',
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
  ].join('')
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

function prune(backupDir: string, retain: number): void {
  const backups = readdirSync(backupDir)
    .filter((name) => BACKUP_PATTERN.test(name))
    .sort()
    .reverse()
  for (const name of backups.slice(Math.max(1, retain))) {
    try {
      unlinkSync(join(backupDir, name))
    } catch {
      // 保留失败不阻塞备份
    }
  }
}
