import {
  buildExport,
  countExport,
  parseExport,
  type ExportCounts,
  type ExportError,
} from '@core/export'
import { err, ok, type Result } from '@core/result'
import { toRecordCsv } from '@core/stats'
import type { RecordView } from '@core/record'
import type { BackupService, DataPort, DataTransferPort } from '../ports'

export type DataError = {
  readonly code: 'EXPORT_FAILED' | 'IMPORT_FAILED' | 'BACKUP_FAILED' | ExportError['code']
  readonly message: string
}

export type ExportResult = {
  readonly saved: boolean
  readonly path: string | null
  readonly counts: ExportCounts
}

export type InspectResult =
  | { readonly canceled: true }
  | {
      readonly canceled: false
      readonly token: string
      readonly counts: ExportCounts
      readonly warnings: readonly string[]
    }

export async function exportData(
  dataPort: DataPort,
  transfer: DataTransferPort,
  appVersion: string,
  now: number,
): Promise<Result<ExportResult, DataError>> {
  const data = dataPort.snapshotAll()
  const counts = countExport(data)
  const content = JSON.stringify(buildExport(data, appVersion, now), null, 2)
  const path = await transfer.saveText(defaultExportName(now), content)
  if (path === null) {
    return ok({ saved: false, path: null, counts })
  }
  return ok({ saved: true, path, counts })
}

export async function inspectImport(
  transfer: DataTransferPort,
): Promise<Result<InspectResult, DataError>> {
  const picked = await transfer.pickImportFile()
  if (picked === null) {
    return ok({ canceled: true })
  }
  const text = transfer.readImportFile(picked.token)
  if (text === null) {
    return err({ code: 'IMPORT_FAILED', message: '无法读取所选文件' })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return err({ code: 'INVALID_FORMAT', message: '文件不是有效的 JSON' })
  }
  const validated = parseExport(parsed)
  if (!validated.ok) {
    return err({ code: validated.error.code, message: validated.error.message })
  }
  return ok({
    canceled: false,
    token: picked.token,
    counts: validated.value.counts,
    warnings: validated.value.warnings,
  })
}

// 导入前强制备份；备份失败则拒绝，避免覆盖后无法回退
export function importData(
  dataPort: DataPort,
  backupService: BackupService,
  transfer: DataTransferPort,
  token: string,
): Result<{ readonly counts: ExportCounts }, DataError> {
  const backup = backupService.create()
  if (backup === null) {
    return err({ code: 'BACKUP_FAILED', message: '导入前备份失败，已取消导入' })
  }
  const text = transfer.readImportFile(token)
  if (text === null) {
    return err({ code: 'IMPORT_FAILED', message: '导入文件已失效，请重新选择' })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return err({ code: 'INVALID_FORMAT', message: '文件不是有效的 JSON' })
  }
  const validated = parseExport(parsed)
  if (!validated.ok) {
    return err({ code: validated.error.code, message: validated.error.message })
  }
  try {
    dataPort.replaceAll(validated.value.package.data)
  } catch {
    return err({ code: 'IMPORT_FAILED', message: '写入数据库失败，已回滚' })
  }
  return ok({ counts: validated.value.counts })
}

export async function exportRecordsCsv(
  records: readonly RecordView[],
  transfer: DataTransferPort,
  now: Date,
): Promise<Result<{ readonly saved: boolean; readonly path: string | null }, DataError>> {
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`
  const path = await transfer.saveText(`spendtime-records-${stamp}.csv`, toRecordCsv(records))
  return ok({ saved: path !== null, path })
}

function defaultExportName(now: number): string {
  const date = new Date(now)
  return `spendtime-export-${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}.json`
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}
