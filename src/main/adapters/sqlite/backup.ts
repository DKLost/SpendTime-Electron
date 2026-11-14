import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { Logger } from '@application/ports'

export const DEFAULT_BACKUP_RETAIN = 10
const BACKUP_FILE_PATTERN = /^spendtime-\d{8}-\d{6}\.db$/

export type BackupOptions = {
  readonly databasePath: string
  readonly backupDir: string
  readonly retain?: number
  readonly now?: Date
}

// 启动备份只做尽力而为：失败记日志，绝不阻塞应用启动
export function backupDatabaseBeforeOpen(options: BackupOptions, logger: Logger): string | null {
  const { databasePath, backupDir } = options
  const retain = options.retain ?? DEFAULT_BACKUP_RETAIN
  const now = options.now ?? new Date()

  if (!existsSync(databasePath)) {
    return null
  }

  try {
    mkdirSync(backupDir, { recursive: true })
    const target = join(backupDir, `spendtime-${formatStamp(now)}.db`)
    copyFileSync(databasePath, target)
    pruneBackups(backupDir, retain)
    return target
  } catch (error) {
    logger.error('数据库启动备份失败', error)
    return null
  }
}

function formatStamp(date: Date): string {
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

// 文件名按时间升序排列，保留最新的 retain 份
function pruneBackups(backupDir: string, retain: number): void {
  const backups = readdirSync(backupDir)
    .filter((name) => BACKUP_FILE_PATTERN.test(name))
    .sort()
    .reverse()

  for (const name of backups.slice(retain)) {
    unlinkSync(join(backupDir, name))
  }
}
