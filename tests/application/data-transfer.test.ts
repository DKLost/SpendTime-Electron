import { describe, expect, it } from 'vitest'
import { buildExport, type ExportData } from '@core/export'
import type { BackupService, DataPort, DataTransferPort } from '@application/ports'
import {
  exportData,
  importData,
  inspectImport,
} from '@application/use-cases/data-transfer'

const DATA: ExportData = {
  actions: [
    {
      id: 1,
      name: '写作',
      archived: false,
      createdAt: 1,
      archivedAt: null,
      timerTargetSec: null,
      startRingtone: null,
      endRingtone: null,
      sortOrder: 1,
    },
  ],
  plans: [],
  records: [
    {
      id: 1,
      actionId: 1,
      startAt: 1_000,
      endAt: 2_000,
      durationSec: 1_000,
      localDate: '2026-11-13',
      source: 'timer',
    },
  ],
  todos: [],
}

const PACKAGE = buildExport(DATA, '0.1.0', 5_000)

function createDataPort(initial: ExportData = DATA): { port: DataPort; replaced: ExportData[] } {
  const replaced: ExportData[] = []
  let current = initial
  return {
    replaced,
    port: {
      snapshotAll: () => current,
      replaceAll: (next) => {
        replaced.push(next)
        current = next
      },
      counts: () => ({
        actions: current.actions.length,
        plans: current.plans.length,
        records: current.records.length,
        todos: current.todos.length,
      }),
    },
  }
}

function createTransfer(files: Record<string, string>): { port: DataTransferPort; saved: string[] } {
  const saved: string[] = []
  const tokens = Object.keys(files)
  return {
    saved,
    port: {
      saveText: async (name, content) => {
        saved.push(`${name}:${content.length}`)
        return `memory/${name}`
      },
      pickImportFile: async () => (tokens.length === 0 ? null : { token: tokens[0]! }),
      readImportFile: (token) => files[token] ?? null,
    },
  }
}

function createBackupService(created: boolean): BackupService {
  return {
    list: () => [],
    create: () =>
      created
        ? { name: 'spendtime-20260101-000000.db', sizeBytes: 100, createdAt: 1 }
        : null,
    openDir: () => true,
    restore: () => ({ ok: true, value: { restarting: true } }),
  }
}

describe('数据导出', () => {
  it('保存 JSON 快照并返回各表条数', async () => {
    const { port } = createDataPort()
    const transfer = createTransfer({})
    const result = await exportData(port, transfer.port, '0.1.0', 5_000)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.saved).toBe(true)
    expect(result.value.counts).toEqual({ actions: 1, plans: 0, records: 1, todos: 0 })
    expect(transfer.saved).toHaveLength(1)
    expect(transfer.saved[0]).toMatch(/^spendtime-export-\d{8}\.json:/)
  })
})

describe('导入预览', () => {
  it('用户取消时返回 canceled', async () => {
    const transfer = createTransfer({})
    const result = await inspectImport(transfer.port)
    expect(result).toEqual({ ok: true, value: { canceled: true } })
  })

  it('合法文件返回 token、条数与告警', async () => {
    const transfer = createTransfer({ 'token-1': JSON.stringify(PACKAGE) })
    const result = await inspectImport(transfer.port)
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.canceled) {
      return
    }
    expect(result.value.token).toBe('token-1')
    expect(result.value.counts).toEqual({ actions: 1, plans: 0, records: 1, todos: 0 })
    expect(result.value.warnings).toEqual([])
  })

  it('非法 JSON 直接报错', async () => {
    const transfer = createTransfer({ 'token-1': 'not-json' })
    const result = await inspectImport(transfer.port)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_FORMAT')
    }
  })
})

describe('导入写入', () => {
  it('备份失败时拒绝覆盖', () => {
    const { port, replaced } = createDataPort()
    const transfer = createTransfer({ 'token-1': JSON.stringify(PACKAGE) })
    const result = importData(port, createBackupService(false), transfer.port, 'token-1')
    expect(result.ok).toBe(false)
    expect(replaced).toHaveLength(0)
  })

  it('成功时先备份再单次替换', () => {
    const { port, replaced } = createDataPort({
      actions: [],
      plans: [],
      records: [],
      todos: [],
    })
    const transfer = createTransfer({ 'token-1': JSON.stringify(PACKAGE) })
    const result = importData(port, createBackupService(true), transfer.port, 'token-1')
    expect(result.ok).toBe(true)
    expect(replaced).toHaveLength(1)
    expect(replaced[0]?.actions).toHaveLength(1)
  })

  it('token 失效时提示重新选择', () => {
    const { port } = createDataPort()
    const transfer = createTransfer({ 'token-1': JSON.stringify(PACKAGE) })
    const result = importData(port, createBackupService(true), transfer.port, 'missing')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('IMPORT_FAILED')
    }
  })
})
