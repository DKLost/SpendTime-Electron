import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { Logger } from '@application/ports'
import {
  LATEST_SCHEMA_VERSION,
  openDatabase,
  SCHEMA_MIGRATIONS,
} from '../../src/main/adapters/sqlite/database'
import { createFixtureDatabase, seedV1Fixture } from '../fixtures/db/fixture-db'

const logger: Logger = {
  info: (): void => undefined,
  error: (): void => undefined,
}

function withTempDb(run: (dbPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'spendtime-migration-'))
  try {
    run(join(dir, 'spendtime.db'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function readUserVersion(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.pragma('user_version', { simple: true }) as number
  } finally {
    db.close()
  }
}

function readColumns(dbPath: string, table: string): readonly string[] {
  const db = new Database(dbPath, { readonly: true })
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    return rows.map((row) => row.name)
  } finally {
    db.close()
  }
}

describe('schema 迁移链', () => {
  it('迁移列表版本从 1 连续到最新版本', () => {
    expect(SCHEMA_MIGRATIONS.map((migration) => migration.version)).toEqual(
      Array.from({ length: LATEST_SCHEMA_VERSION }, (_, index) => index + 1),
    )
  })

  it('v1 库升级到最新版本时数据不丢失，并补齐新列', () => {
    withTempDb((dbPath) => {
      createFixtureDatabase(dbPath, 1)
      seedV1Fixture(dbPath, { actionName: '历史行动', recordDurationSec: 600 })

      const db = openDatabase(dbPath, logger)
      try {
        expect(readUserVersion(dbPath)).toBe(LATEST_SCHEMA_VERSION)

        const action = db.prepare('SELECT name, archived FROM actions WHERE id = 1').get() as {
          name: string
          archived: number
        }
        expect(action).toEqual({ name: '历史行动', archived: 0 })

        const record = db
          .prepare('SELECT duration_sec, local_date FROM time_records WHERE session_id = ?')
          .get('fixture-session') as { duration_sec: number; local_date: string }
        expect(record).toEqual({ duration_sec: 600, local_date: '2026-11-13' })

        const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('theme') as {
          value: string
        }
        expect(setting.value).toBe('porcelain')

        expect(readColumns(dbPath, 'todos')).toContain('archived_at')
        expect(readColumns(dbPath, 'plans')).toContain('alarm_enabled')
        expect(readColumns(dbPath, 'actions')).toContain('sort_order')
        const sorted = db.prepare('SELECT sort_order FROM actions WHERE id = 1').get() as {
          sort_order: number
        }
        expect(sorted.sort_order).toBe(1)
      } finally {
        db.close()
      }
    })
  })

  it.each([1, 2, 3, 4, 5])('v%i 夹具升级到最新版本且保留行动', (version) => {
    withTempDb((dbPath) => {
      createFixtureDatabase(dbPath, version)
      seedV1Fixture(dbPath, { actionName: `v${version} 行动`, recordDurationSec: 120 })

      const db = openDatabase(dbPath, logger)
      try {
        expect(readUserVersion(dbPath)).toBe(LATEST_SCHEMA_VERSION)
        const count = db.prepare('SELECT COUNT(*) AS count FROM actions').get() as { count: number }
        expect(count.count).toBe(1)
        const name = db.prepare('SELECT name FROM actions WHERE id = 1').get() as { name: string }
        expect(name.name).toBe(`v${version} 行动`)
      } finally {
        db.close()
      }
    })
  })

  it('v11 的旧铃声升级后补上截取区间，并允许超过 60 秒的源文件', () => {
    withTempDb((dbPath) => {
      createFixtureDatabase(dbPath, 11)
      const legacyId = '6f9619ff-8b86-4d01-b42d-00cf4fc964ff'
      const external = new Database(dbPath)
      external
        .prepare(
          `INSERT INTO custom_ringtones (id, name, file_name, duration_sec, size_bytes, created_at)
           VALUES (?, '旧铃声', ?, 8, 1024, 1)`,
        )
        .run(legacyId, `${legacyId}.mp3`)
      external.close()

      const db = openDatabase(dbPath, logger)
      try {
        expect(readUserVersion(dbPath)).toBe(LATEST_SCHEMA_VERSION)
        expect(readColumns(dbPath, 'custom_ringtones')).toEqual(
          expect.arrayContaining(['clip_start_sec', 'clip_end_sec']),
        )
        const row = db
          .prepare(
            'SELECT name, duration_sec, clip_start_sec, clip_end_sec FROM custom_ringtones WHERE id = ?',
          )
          .get(legacyId) as {
          name: string
          duration_sec: number
          clip_start_sec: number
          clip_end_sec: number | null
        }
        // 旧数据按整段播放：起点 0，终点为空
        expect(row).toEqual({
          name: '旧铃声',
          duration_sec: 8,
          clip_start_sec: 0,
          clip_end_sec: null,
        })

        // v12 去掉了 duration_sec 的 60 秒上限
        const longId = '9a9619ff-8b86-4d01-b42d-00cf4fc964ff'
        db.prepare(
          `INSERT INTO custom_ringtones
             (id, name, file_name, duration_sec, clip_start_sec, clip_end_sec, size_bytes, created_at)
           VALUES (?, '长音频', ?, 600, 12.5, 30.5, 2048, 2)`,
        ).run(longId, `${longId}.mp3`)
        const inserted = db
          .prepare('SELECT duration_sec, clip_start_sec, clip_end_sec FROM custom_ringtones WHERE id = ?')
          .get(longId) as { duration_sec: number; clip_start_sec: number; clip_end_sec: number }
        expect(inserted).toEqual({ duration_sec: 600, clip_start_sec: 12.5, clip_end_sec: 30.5 })
      } finally {
        db.close()
      }
    })
  })

  it('已是最新版本的库重复打开不报错', () => {
    withTempDb((dbPath) => {
      createFixtureDatabase(dbPath, LATEST_SCHEMA_VERSION)
      const first = openDatabase(dbPath, logger)
      first.close()
      const second = openDatabase(dbPath, logger)
      expect(readUserVersion(dbPath)).toBe(LATEST_SCHEMA_VERSION)
      second.close()
    })
  })

  it('数据库版本高于程序支持时拒绝打开', () => {
    withTempDb((dbPath) => {
      createFixtureDatabase(dbPath, LATEST_SCHEMA_VERSION)
      const db = new Database(dbPath)
      db.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 1}`)
      db.close()

      expect(() => openDatabase(dbPath, logger)).toThrow(/高于程序支持/)
    })
  })
})
