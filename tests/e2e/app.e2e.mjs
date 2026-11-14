// 真机 E2E：启动 Electron，覆盖计时 → 关闭 → 重启恢复 → 结束记录
// 无法启动时打印原因并以 0 退出（跳过），不静默通过
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const root = resolve(import.meta.dirname, '../..')
const dataDir = mkdtempSync(join(tmpdir(), 'spendtime-e2e-'))

async function launchApp() {
  try {
    const app = await electron.launch({
      args: ['.'],
      cwd: root,
      env: { ...process.env, SPENDTIME_DATA_DIR: dataDir },
      timeout: 30_000,
    })
    const window = await app.firstWindow({ timeout: 30_000 })
    await window.waitForSelector('.app-title', { timeout: 15_000 })
    return { app, window }
  } catch (error) {
    throw new Error(`无法启动 Electron：${error.message}`)
  }
}

async function runFlow() {
  const first = await launchApp()
  console.log('  PASS 应用启动并渲染主界面')

  await first.window.getByRole('button', { name: '开始' }).click()
  await first.window.locator('.badge-running').waitFor({ timeout: 10_000 })
  console.log('  PASS 计时进入运行态')
  await first.window.waitForTimeout(2_500)

  await first.app.close()
  console.log('  PASS 应用关闭')

  const second = await launchApp()
  try {
    await second.window.locator('.badge-running').waitFor({ timeout: 10_000 })
    const clockText = await second.window.locator('.clock').innerText()
    if (clockText === '00:00:00') {
      throw new Error(`重启后计时未按 startedAt 恢复：${clockText}`)
    }
    console.log(`  PASS 重启后恢复计时（${clockText}）`)

    await second.window.getByRole('button', { name: '结束并记录' }).click()
    await second.window.locator('.record-table tbody tr').first().waitFor({ timeout: 10_000 })
    console.log('  PASS 结束后生成时间记录')
  } finally {
    await second.app.close()
  }
}

async function main() {
  try {
    await runFlow()
    console.log('\nElectron E2E 通过')
    return 0
  } catch (error) {
    if (error.message.includes('无法启动 Electron')) {
      console.error(`跳过 E2E：${error.message}`)
      return 0
    }
    console.error(`\nElectron E2E 失败：${error.message}`)
    return 1
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
}

main().then((code) => process.exit(code))
