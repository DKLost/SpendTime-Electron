import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings } from '@core/settings'
import type { ExportCounts } from '@core/export'
import type { Logger } from '@application/ports'
import { LATEST_SCHEMA_VERSION } from './sqlite/database'

export type DiagnosticsDeps = {
  readonly dataDir: string
  readonly logDir: string
  readonly appVersion: string
  readonly getSettings: () => AppSettings
  readonly counts: () => ExportCounts
  readonly logger: Logger
  readonly now?: () => number
}

export type DiagnosticsService = {
  readonly crashDir: string
  exportNow(): string | null
}

const MAX_LOG_FILES = 3

// 诊断包放在 userData/diagnostics/<时间戳>，只含版本、计数、脱敏设置与最近日志
export function createDiagnosticsService(deps: DiagnosticsDeps): DiagnosticsService {
  const crashDir = join(deps.dataDir, 'crashes')
  const diagnosticsRoot = join(deps.dataDir, 'diagnostics')
  const now = deps.now ?? Date.now

  function exportNow(): string | null {
    const stamp = formatStamp(new Date(now()))
    const targetDir = join(diagnosticsRoot, stamp)
    try {
      mkdirSync(targetDir, { recursive: true })
      writeFileSync(
        join(targetDir, 'summary.json'),
        JSON.stringify(buildSummary(deps, stamp), null, 2),
        'utf8',
      )
      copyRecentLogs(deps.logDir, join(targetDir, 'logs'))
      return targetDir
    } catch (error) {
      deps.logger.error('导出诊断信息失败', error)
      return null
    }
  }

  return { crashDir, exportNow }
}

function buildSummary(deps: DiagnosticsDeps, stamp: string): object {
  return {
    exportedAt: stamp,
    appVersion: deps.appVersion,
    schemaVersion: LATEST_SCHEMA_VERSION,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    counts: deps.counts(),
    settings: redactSettings(deps.getSettings()),
  }
}

// 路径与快捷键可能带个人信息，诊断包里不出现
function redactSettings(settings: AppSettings): Omit<AppSettings, 'shortcut'> & { shortcut: string } {
  return {
    ...settings,
    shortcut: settings.shortcut === null ? '' : '<configured>',
  }
}

function copyRecentLogs(logDir: string, targetDir: string): void {
  if (!existsSync(logDir)) {
    return
  }
  const logs = readdirSync(logDir)
    .filter((name) => name.endsWith('.log'))
    .map((name) => ({ name, mtime: statSync(join(logDir, name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime)
    .slice(0, MAX_LOG_FILES)
  if (logs.length === 0) {
    return
  }
  mkdirSync(targetDir, { recursive: true })
  for (const log of logs) {
    copyFileSync(join(logDir, log.name), join(targetDir, log.name))
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
