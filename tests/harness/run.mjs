// 无头渲染 harness：esbuild 打包渲染入口 + 假 API，用系统 Edge 跑关键流程并截图
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const root = resolve(import.meta.dirname, '../..')
const outDir = join(root, 'out', 'harness')
const shotDir = join(outDir, 'screenshots')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

async function bundleHarness() {
  mkdirSync(outDir, { recursive: true })
  await build({
    entryPoints: [join(root, 'tests/harness/harness-entry.ts')],
    outfile: join(outDir, 'harness.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    jsx: 'automatic',
    sourcemap: 'inline',
    loader: { '.css': 'css' },
    alias: {
      '@core': join(root, 'src/core'),
      '@application': join(root, 'src/application'),
      '@shared': join(root, 'src/shared'),
      '@renderer': join(root, 'src/renderer/src'),
    },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning',
  })

  writeFileSync(
    join(outDir, 'index.html'),
    `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SpendTime Harness</title>
    <link rel="stylesheet" href="./harness.css" />
  </head>
  <body>
    <div id="root"></div>
    <script src="./harness.js"></script>
  </body>
</html>
`,
    'utf8',
  )
}

function startServer() {
  const server = createServer((request, response) => {
    const urlPath = (request.url ?? '/').split('?')[0]
    if (urlPath === '/favicon.ico') {
      response.writeHead(204).end()
      return
    }
    const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '')
    const filePath = join(outDir, relative)
    try {
      const body = readFileSync(filePath)
      response.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' })
      response.end(body)
    } catch {
      response.writeHead(404).end('not found')
    }
  })
  return new Promise((resolveServer, rejectServer) => {
    server.on('error', rejectServer)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolveServer({ server, origin: `http://127.0.0.1:${address.port}` })
    })
  })
}

async function runFlows(page) {
  const failures = []

  async function check(name, work) {
    try {
      await work()
      console.log(`  PASS ${name}`)
    } catch (error) {
      failures.push(`${name}: ${error.message}`)
      console.error(`  FAIL ${name}: ${error.message}`)
    }
  }
  await page.waitForSelector('.app-title')

  await check('新建待办', async () => {
    const input = page.getByPlaceholder('新增待办，回车保存')
    await input.fill('写周报')
    await input.press('Enter')
    await page.locator('.todo-item', { hasText: '写周报' }).waitFor({ timeout: 5_000 })
    await page.screenshot({ path: join(shotDir, '01-todo.png'), fullPage: true })
  })

  await check('新建并编辑周计划', async () => {
    await page.getByPlaceholder('09:00').fill('09:00')
    await page.getByPlaceholder('10:30').fill('10:30')
    await page.locator('.plan-form button.primary').click()

    const created = page.locator('.plan-row', {
      has: page.locator('.time-cell', { hasText: '09:00-10:30' }),
    })
    await created.waitFor({ timeout: 5_000 })
    await created.getByRole('button', { name: '编辑' }).click()
    await page.screenshot({ path: join(shotDir, '10-plan-edit-light.png') })

    await page.getByLabel('结束时间').fill('11:00')
    await page.locator('.row-editing button.primary').click()
    await page
      .locator('.plan-row', { has: page.locator('.time-cell', { hasText: '09:00-11:00' }) })
      .waitFor({ timeout: 5_000 })

    await page.getByPlaceholder('09:00').fill('14:00')
    await page.getByPlaceholder('10:30').fill('15:30')
    await page.locator('.plan-form button.primary').click()
    await page
      .locator('.plan-row', { has: page.locator('.time-cell', { hasText: '14:00-15:30' }) })
      .waitFor({ timeout: 5_000 })

    await page.getByPlaceholder('09:00').fill('19:00')
    await page.getByPlaceholder('10:30').fill('20:30')
    await page.locator('.plan-form button.primary').click()
    await page
      .locator('.plan-row', { has: page.locator('.time-cell', { hasText: '19:00-20:30' }) })
      .waitFor({ timeout: 5_000 })
    await page.screenshot({ path: join(shotDir, '02-plan.png'), fullPage: true })
  })

  await check('浅色主题下列表网格可读', async () => {
    await page.locator('.theme-picker select').selectOption('celadon')
    const planPanel = page.locator('.panel', { has: page.locator('h2', { hasText: '周计划' }) })
    const recordPanel = page.locator('.panel', { has: page.locator('h2', { hasText: '时间记录' }) })
    const recordRows = recordPanel.locator('tbody tr')
    if ((await recordRows.count()) < 2) {
      throw new Error('时间记录列表没有可用于截图的数据行')
    }
    // 记录面板头部只表达条数；所选日合计保留在页头，避免同一数字出现两次
    const countBadge = (await recordPanel.locator('.panel-head .badge').textContent())?.trim() ?? ''
    if (!/^\d+ 条$/.test(countBadge)) {
      throw new Error(`记录面板头部应只显示条数：${countBadge}`)
    }
    const headerTotal = (await page.locator('.app-total strong').textContent())?.trim() ?? ''
    if (!/^\d{2}:\d{2}:\d{2}$/.test(headerTotal)) {
      throw new Error(`页头所选日累计缺失或格式异常：${headerTotal}`)
    }
    const todayDate = localDateString(new Date())
    if ((await recordPanel.locator('.records-date').inputValue()) !== todayDate) {
      throw new Error('时间记录默认没有显示今天')
    }
    if ((await page.locator('.app-total .label').textContent())?.trim() !== '今日累计') {
      throw new Error('默认状态的页头累计不是今日口径')
    }
    if ((await recordPanel.locator('.records-gaps .slot-chip').count()) === 0) {
      throw new Error('时间记录缺少空档脚注')
    }
    await planPanel.screenshot({ path: join(shotDir, '06-plan-light.png') })
    await recordPanel.screenshot({ path: join(shotDir, '07-records-light.png') })
    await assertSlotRows(planPanel, '周计划（浅色）', 3, 'light')
    await assertSlotRows(recordPanel, '时间记录（浅色）', 4, 'light')
    await page.screenshot({ path: join(shotDir, '12-app-light.png') })

    // 空档脚注紧接表格收尾，但必须留出与单元格内边距同档的间隙，不能贴死
    const planTableBox = await planPanel.locator('table').boundingBox()
    const chipsBox = await planPanel.locator('.slot-chips').boundingBox()
    if (planTableBox === null || chipsBox === null) {
      throw new Error('无法测量计划表与空档脚注的间距')
    }
    const footnoteGap = chipsBox.y - (planTableBox.y + planTableBox.height)
    if (footnoteGap < 4 || footnoteGap > 12) {
      throw new Error(`空档脚注间距异常：${footnoteGap}px，应在 4-12px 之间`)
    }

    // 表格之外的行与控件也必须沿用同一套 30/24/20 尺度
    const indexes = (await planPanel.locator('tbody .index-cell').allTextContents())
      .map((text) => text.trim())
      .filter((text) => text.length > 0)
    if (indexes.join(',') !== '1,2,3') {
      throw new Error(`周计划行号不是按显示顺序：${indexes.join(',')}`)
    }

    // 两处必须共用同一套行：时间列宽度、行高、对齐、分隔线与时间色一致
    const planTimeBox = await planPanel.locator('thead .time-cell').boundingBox()
    const recordTimeBox = await recordPanel.locator('thead .time-cell').boundingBox()
    if (planTimeBox === null || recordTimeBox === null) {
      throw new Error('无法测量时间列宽度')
    }
    if (Math.abs(planTimeBox.width - recordTimeBox.width) > 1) {
      throw new Error(`时间列宽度不一致：周计划 ${planTimeBox.width}，记录 ${recordTimeBox.width}`)
    }

    const planRowBox = await planPanel.locator('tbody .plan-row').first().boundingBox()
    const recordRowBox = await recordPanel.locator('tbody tr').first().boundingBox()
    if (planRowBox === null || recordRowBox === null) {
      throw new Error('无法测量列表行高')
    }
    if (Math.abs(planRowBox.height - recordRowBox.height) > 1) {
      throw new Error(`行高不一致：周计划 ${planRowBox.height}，记录 ${recordRowBox.height}`)
    }

    // 表格之外的行与控件也必须沿用同一套 30/24/20 尺度
    const timerPanel = page.locator('.panel', { has: page.locator('h2', { hasText: '计时' }) })
    const controlBoxes = await Promise.all([
      timerPanel.locator('select').boundingBox(),
      timerPanel.locator('input[type="text"]').boundingBox(),
      timerPanel.locator('button.primary').boundingBox(),
      page.locator('.plan-form select').boundingBox(),
    ])
    for (const box of controlBoxes) {
      if (box === null || Math.abs(box.height - planRowBox.height) > 1) {
        throw new Error(`控件高度未对齐表格行高：${box?.height ?? 'null'}`)
      }
    }
    const iconBox = await planPanel.locator('tbody .icon').first().boundingBox()
    if (iconBox === null || Math.abs(iconBox.height - 20) > 1) {
      throw new Error(`行内小控件高度异常：${iconBox?.height ?? 'null'}`)
    }

    const planTimeStyle = await planPanel.locator('tbody .time-cell').first().evaluate((cell) => {
      const style = getComputedStyle(cell)
      return {
        color: style.color,
        align: style.textAlign,
        border: style.borderRightColor,
      }
    })
    const recordTimeStyle = await recordPanel.locator('tbody .time-cell').first().evaluate((cell) => {
      const style = getComputedStyle(cell)
      return {
        color: style.color,
        align: style.textAlign,
        border: style.borderRightColor,
      }
    })
    if (planTimeStyle.color !== recordTimeStyle.color) {
      throw new Error(`时间文字色不一致：${planTimeStyle.color} / ${recordTimeStyle.color}`)
    }
    if (planTimeStyle.align !== 'right' || recordTimeStyle.align !== 'right') {
      throw new Error(`时间列未统一右对齐：${planTimeStyle.align} / ${recordTimeStyle.align}`)
    }
    if (planTimeStyle.border !== recordTimeStyle.border) {
      throw new Error(`时间列分隔线不一致：${planTimeStyle.border} / ${recordTimeStyle.border}`)
    }
  })

  await check('归档时间统一带年份', async () => {
    const archivedPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
    const todoPanel = page.locator('.panel', { has: page.locator('h2', { hasText: '待办' }) })
    const todoItem = todoPanel.locator('.todo-item', { hasText: '写周报' })
    await todoItem.getByRole('button', { name: '归档待办' }).click()
    await todoPanel.getByRole('button', { name: /^归档 \d+$/ }).click()
    const todoArchivedAt = todoPanel.locator('.todo-archived-at').first()
    await todoArchivedAt.waitFor({ timeout: 5_000 })
    const todoText = (await todoArchivedAt.textContent())?.trim() ?? ''
    if (!archivedPattern.test(todoText)) {
      throw new Error(`待办归档时间未带年份：${todoText}`)
    }
    await todoPanel.screenshot({ path: join(shotDir, '33-todo-archive-time.png') })
    await todoPanel.getByRole('button', { name: '恢复' }).first().click()
    await todoPanel.getByRole('button', { name: '返回' }).click()

    const actionPanel = page.locator('.panel', { has: page.locator('h2', { hasText: '行动' }) })
    page.once('dialog', (dialog) => void dialog.accept())
    await actionPanel
      .locator('.action-item', { hasText: '阅读' })
      .getByRole('button', { name: '归档', exact: true })
      .click()
    await actionPanel.getByRole('button', { name: /^归档 \d+$/ }).click()
    const actionArchivedAt = actionPanel.locator('.action-archived-at').first()
    await actionArchivedAt.waitFor({ timeout: 5_000 })
    const actionText = (await actionArchivedAt.textContent())?.trim() ?? ''
    if (!archivedPattern.test(actionText)) {
      throw new Error(`行动归档时间未带年份：${actionText}`)
    }
    await actionPanel.screenshot({ path: join(shotDir, '34-action-archive-time.png') })
    await actionPanel.getByRole('button', { name: '恢复' }).first().click()
    await actionPanel.getByRole('button', { name: '返回' }).click()
  })

  await check('统计周期预设覆盖本季、本年与全部', async () => {
    const statsPanel = page.locator('.stats-panel')
    const now = new Date()
    const year = now.getFullYear()
    const today = localDateString(now)
    const yesterday = shiftDateString(today, -1)
    const pad = (value) => String(value).padStart(2, '0')
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3 + 1
    const quarterEndMonth = quarterStartMonth + 2

    await clickStatsPreset(statsPanel, '本季')
    await waitStatsBadge(
      page,
      statsPanel,
      `${year}-${pad(quarterStartMonth)}-01 ~ ${year}-${pad(quarterEndMonth)}-${pad(lastDayOfMonth(year, quarterEndMonth))}`,
      '本季',
    )

    await clickStatsPreset(statsPanel, '本年')
    await waitStatsBadge(page, statsPanel, `${year}-01-01 ~ ${year}-12-31`, '本年')

    await clickStatsPreset(statsPanel, '全部')
    await waitStatsBadge(page, statsPanel, `${yesterday} ~ ${today}`, '全部')
    await statsPanel.screenshot({ path: join(shotDir, '35-stats-all-light.png') })

    await clickStatsPreset(statsPanel, '本周')
  })

  await check('记录行内编辑可用', async () => {
    const recordPanel = page.locator('.panel', { has: page.locator('h2', { hasText: '时间记录' }) })
    const firstRow = recordPanel.locator('tbody tr').first()
    await firstRow.getByRole('button', { name: '编辑' }).click()
    const editRow = recordPanel.locator('tbody tr.row-editing')
    await editRow.waitFor({ timeout: 5_000 })
    await editRow.getByLabel('开始时间').waitFor({ timeout: 5_000 })
    await page.screenshot({ path: join(shotDir, '11-record-edit-light.png') })
    await editRow.getByRole('button', { name: '取消' }).click()
    await recordPanel.locator('tbody tr.row-editing').waitFor({ state: 'detached', timeout: 5_000 })
  })

  await check('时间记录可按日期回溯', async () => {
    const recordPanel = page.locator('.panel', { has: page.locator('h2', { hasText: '时间记录' }) })
    const dateInput = recordPanel.locator('.records-date')
    const todayDate = localDateString(new Date())
    const yesterday = shiftDateString(todayDate, -1)
    const tomorrow = shiftDateString(todayDate, 1)

    // 前一天：列表、空档脚注与页头当日累计一起切换
    await recordPanel.getByRole('button', { name: '前一天' }).click()
    await recordPanel.locator('tbody tr', { hasText: '14:20-15:50' }).waitFor({ timeout: 5_000 })
    if ((await dateInput.inputValue()) !== yesterday) {
      throw new Error(`前一天按钮没有切到 ${yesterday}`)
    }
    if ((await page.locator('.app-total .label').textContent())?.trim() !== '所选日累计') {
      throw new Error('回溯后页头累计没有切换到所选日口径')
    }
    if ((await page.locator('.app-total strong').textContent())?.trim() !== '02:00:00') {
      throw new Error('回溯后页头累计数值不正确')
    }
    const summary = (await recordPanel.locator('.panel-head .badge').textContent())?.trim() ?? ''
    if (summary !== '2 条') {
      throw new Error(`记录面板条数没有跟随日期：${summary}`)
    }
    const gaps = (await recordPanel.locator('.records-gaps .slot-chip').allTextContents()).map(
      (text) => text.trim(),
    )
    if (!gaps.includes('00:00-14:20') || !gaps.includes('15:50-23:30')) {
      throw new Error(`前一天空档不正确：${gaps.join(' / ')}`)
    }
    if (gaps.some((text) => text.startsWith('23:30'))) {
      throw new Error(`跨零点末段之后不应再出现空档：${gaps.join(' / ')}`)
    }
    if ((await recordPanel.locator('tbody tr', { hasText: '23:30-24:00' }).count()) !== 1) {
      throw new Error('跨零点末段没有按 24:00 显示')
    }
    await recordPanel.screenshot({ path: join(shotDir, '22-records-past-light.png') })

    // 后一天回到今天，页头恢复今日口径
    await recordPanel.getByRole('button', { name: '后一天' }).click()
    await recordPanel.locator('tbody tr', { hasText: '02:10-03:00' }).waitFor({ timeout: 5_000 })
    if ((await dateInput.inputValue()) !== todayDate) {
      throw new Error('后一天按钮没有回到今天')
    }
    if ((await page.locator('.app-total .label').textContent())?.trim() !== '今日累计') {
      throw new Error('回到今天后页头没有恢复今日口径')
    }

    // 未来日期：允许选择，但空状态必须明确说明“还没有到来”
    await dateInput.fill(tomorrow)
    await recordPanel
      .getByText('这一天还没有到来，暂时没有记录。')
      .waitFor({ timeout: 5_000 })
    if ((await recordPanel.locator('table').count()) !== 0) {
      throw new Error('未来日期不应渲染记录表格')
    }
    const futureSummary = (await recordPanel.locator('.panel-head .badge').textContent())?.trim() ?? ''
    if (!futureSummary.includes('0 条')) {
      throw new Error(`未来日期的汇总不正确：${futureSummary}`)
    }

    // 回到今天按钮：直接复位到默认状态
    await recordPanel.getByRole('button', { name: '回到今天' }).click()
    await recordPanel.locator('tbody tr', { hasText: '02:10-03:00' }).waitFor({ timeout: 5_000 })
    if ((await dateInput.inputValue()) !== todayDate) {
      throw new Error('回到今天按钮没有复位日期')
    }
    if (!(await recordPanel.getByRole('button', { name: '回到今天' }).isDisabled())) {
      throw new Error('已在今天时，回到今天按钮应禁用')
    }
  })

  await check('时钟走秒并高亮下一条提醒', async () => {
    const clock = page.locator('.clock-time')
    const first = (await clock.textContent())?.trim() ?? ''
    if (!/^\d{2}:\d{2}:\d{2}$/.test(first)) {
      throw new Error(`时钟格式异常：${first}`)
    }
    await page.waitForTimeout(1_100)
    const second = (await clock.textContent())?.trim() ?? ''
    if (second === first) {
      throw new Error('时钟没有按秒更新')
    }
    const nextRow = page.locator('.plan-row.is-next').first()
    await nextRow.waitFor({ timeout: 5_000 })
    const nextTime = (await nextRow.locator('.time-cell').textContent())?.trim() ?? ''
    const nextStart = nextTime.split('-')[0]
    const nextMeta = (await page.locator('.clock-next-meta').textContent()) ?? ''
    if (!nextMeta.includes(nextStart)) {
      throw new Error(`下一个提醒与高亮行不一致：${nextMeta} / ${nextTime}`)
    }
  })

  await check('提醒与计划刷新不改所选日期，周计划可回到今天', async () => {
    const planPanel = page.locator('.panel', { has: page.locator('h2', { hasText: '周计划' }) })
    const recordPanel = page.locator('.panel', { has: page.locator('h2', { hasText: '时间记录' }) })
    await assertClockDate(page, '浅色时钟')

    const now = new Date()
    const todayLabel = WEEKDAY_LABELS[now.getDay()]
    const todayButton = planPanel.getByRole('button', { name: '回到今天' })
    const activeLabel = async () =>
      (await planPanel.locator('.weekday-tab.active').textContent())?.trim() ?? ''
    if ((await activeLabel()) !== todayLabel) {
      throw new Error(`周计划默认星期不是今天：${await activeLabel()} ≠ ${todayLabel}`)
    }
    if (!(await todayButton.isDisabled())) {
      throw new Error('已在今天时，周计划的回到今天按钮应禁用')
    }

    // 记录面板先翻到昨天：后续任何计划操作都不应把记录日期带回今天
    const yesterday = shiftDateString(localDateString(now), -1)
    await recordPanel.getByRole('button', { name: '前一天' }).click()
    if ((await recordPanel.locator('.records-date').inputValue()) !== yesterday) {
      throw new Error('记录面板没有切到前一天')
    }

    const otherWeekdays = WEEKDAY_LABELS.filter((label) => label !== todayLabel)
    const otherLabel = otherWeekdays[0]
    const copyFromLabel = otherWeekdays[1]
    const copyToLabel = otherWeekdays[2]
    await planPanel.locator('.weekday-tab', { hasText: otherLabel }).click()
    if ((await activeLabel()) !== otherLabel) {
      throw new Error(`星期切换失败：${await activeLabel()} ≠ ${otherLabel}`)
    }
    if (await todayButton.isDisabled()) {
      throw new Error('离开今天后，周计划的回到今天按钮应可用')
    }
    await planPanel.screenshot({ path: join(shotDir, '29-plan-light-today-button.png') })
    await page.locator('.clock-panel').screenshot({ path: join(shotDir, '30-clock-light.png') })

    // 空源复制也会触发计划列表刷新；旧的“跟随下一条提醒”会在这里把星期切回今天
    await planPanel.locator('.plan-copy select').first().selectOption({ label: copyFromLabel })
    await planPanel.locator('.plan-copy select').last().selectOption({ label: copyToLabel })
    await planPanel.getByRole('button', { name: '复制覆盖' }).click()
    await page.waitForTimeout(250)
    if ((await activeLabel()) !== otherLabel) {
      throw new Error(`计划刷新后星期被重置：${await activeLabel()} ≠ ${otherLabel}`)
    }
    if ((await recordPanel.locator('.records-date').inputValue()) !== yesterday) {
      throw new Error('计划刷新改变了记录面板所选日期')
    }

    await todayButton.click()
    if ((await activeLabel()) !== todayLabel) {
      throw new Error(`回到今天没有复位星期：${await activeLabel()} ≠ ${todayLabel}`)
    }
    if (!(await todayButton.isDisabled())) {
      throw new Error('回到今天后按钮应禁用')
    }
    if ((await recordPanel.locator('.records-date').inputValue()) !== yesterday) {
      throw new Error('周计划回到今天不应改动记录面板日期')
    }

    // 恢复记录面板到今天，后续用例仍按今天断言
    await recordPanel.getByRole('button', { name: '回到今天' }).click()
  })

  await check('开始计时并显示运行态', async () => {
    const timerPanel = page.locator('.panel', { has: page.locator('h2', { hasText: '计时' }) })
    await timerPanel.getByRole('button', { name: '开始' }).click()
    await timerPanel.locator('.badge-running').waitFor({ timeout: 5_000 })
    await timerPanel.locator('.clock').filter({ hasText: /00:01:3\d/ }).waitFor({ timeout: 5_000 })
    await timerPanel.screenshot({ path: join(shotDir, '13-timer-light.png') })
    await page.screenshot({ path: join(shotDir, '03-timer.png'), fullPage: true })
  })

  await check('添加按钮与行动下拉框等高', async () => {
    const addButton = await page.locator('.plan-form button.primary').boundingBox()
    const planSelect = await page.locator('.plan-form .field-row').last().locator('select').boundingBox()
    if (addButton === null || planSelect === null) {
      throw new Error('无法测量周计划添加按钮或行动选择框')
    }
    if (Math.abs(addButton.height - planSelect.height) > 2) {
      throw new Error(`周计划添加按钮高度 ${addButton.height}px 与下拉框 ${planSelect.height}px 不一致`)
    }
    const alarm = await page.locator('.plan-form .plan-alarm').boundingBox()
    const selectTop = planSelect.y
    const selectBottom = planSelect.y + planSelect.height
    if (alarm === null || alarm.y < selectTop - 2 || alarm.y + alarm.height > selectBottom + 2) {
      throw new Error('提醒开关超出行动下拉框的垂直范围')
    }
  })

  await check('设置按钮与主题下拉框对齐', async () => {
    const settingsButton = await page.locator('.settings-trigger').boundingBox()
    const themeSelect = await page.locator('.theme-picker select').boundingBox()
    if (settingsButton === null || themeSelect === null) {
      throw new Error('无法测量设置按钮或主题选择框')
    }
    if (Math.abs(settingsButton.height - themeSelect.height) > 2) {
      throw new Error(`设置按钮高度 ${settingsButton.height}px 与主题下拉框 ${themeSelect.height}px 不一致`)
    }
    if (Math.abs(settingsButton.y + settingsButton.height - (themeSelect.y + themeSelect.height)) > 2) {
      throw new Error('设置按钮与主题下拉框底边未对齐')
    }
  })

  await check('时段底色开关即时生效且关闭后时间格保持中性', async () => {
    const planPanel = page.locator('.panel', { has: page.locator('h2', { hasText: '周计划' }) })
    const recordPanel = page.locator('.panel', { has: page.locator('h2', { hasText: '时间记录' }) })
    const attr = () => page.evaluate(() => document.documentElement.dataset.slotTint)
    if ((await attr()) !== 'on') {
      throw new Error(`时段底色默认应为开启，实际 ${await attr()}`)
    }
    await planPanel.screenshot({ path: join(shotDir, '26-plan-light-tint-on.png') })

    await setSlotTint(page, false)
    if ((await attr()) !== 'off') {
      throw new Error('关闭后 html 未标记 data-slot-tint=off')
    }
    await assertSlotRows(planPanel, '周计划（浅色·关闭底色）', 0, 'light', false)
    await assertSlotRows(recordPanel, '时间记录（浅色·关闭底色）', 0, 'light', false)
    await assertSlotHoverNeutral(page, planPanel, '周计划（浅色·关闭底色）')
    await planPanel.screenshot({ path: join(shotDir, '27-plan-light-tint-off.png') })

    // 再打开应立即恢复偏置，不需要刷新
    await setSlotTint(page, true)
    await assertSlotRows(planPanel, '周计划（浅色·重新开启）', 3, 'light')
  })

  await check('Steam 深色主题下下拉框为浅字深底', async () => {
    await page.locator('.theme-picker select').selectOption('steam')
    const sample = await page.locator('.theme-picker select').evaluate((element) => {
      const option = element.querySelector('option')
      const selectStyle = getComputedStyle(element)
      const optionStyle = option === null ? null : getComputedStyle(option)
      return {
        color: selectStyle.color,
        colorScheme: selectStyle.colorScheme,
        optionColor: optionStyle?.color ?? '',
        optionBackground: optionStyle?.backgroundColor ?? '',
      }
    })

    const textColor = parseRgb(sample.color)
    const optionColor = parseRgb(sample.optionColor)
    const optionBackground = parseRgb(sample.optionBackground)
    if (!sample.colorScheme.includes('dark')) {
      throw new Error(`select 未继承深色 color-scheme：${sample.colorScheme}`)
    }
    if (textColor === null || optionColor === null || optionBackground === null) {
      throw new Error(`无法解析颜色：${JSON.stringify(sample)}`)
    }
    if (brightness(textColor) < 150 || brightness(optionColor) < 150) {
      throw new Error(`下拉文字过深：${JSON.stringify(sample)}`)
    }
    if (brightness(optionBackground) > 110) {
      throw new Error(`option 背景不是深色：${JSON.stringify(sample)}`)
    }

    const surfaces = await page.evaluate(() => ({
      page: getComputedStyle(document.body).backgroundColor,
      sidebar: getComputedStyle(document.querySelector('.column-scroll')).backgroundColor,
    }))
    if (surfaces.page !== 'rgb(35, 39, 47)') {
      throw new Error(`页面底色应为 #23272f，实际 ${surfaces.page}`)
    }
    if (surfaces.sidebar !== 'rgb(23, 29, 37)') {
      throw new Error(`侧栏底色应为 #171d25，实际 ${surfaces.sidebar}`)
    }

    await page.screenshot({ path: join(shotDir, '04-steam-dark.png'), fullPage: true })

    const statsPanel = page.locator('.stats-panel')
    await clickStatsPreset(statsPanel, '全部')
    await waitStatsBadge(
      page,
      statsPanel,
      `${shiftDateString(localDateString(new Date()), -1)} ~ ${localDateString(new Date())}`,
      '深色全部',
    )
    await statsPanel.screenshot({ path: join(shotDir, '36-stats-all-dark.png') })
    await clickStatsPreset(statsPanel, '本周')

    const planPanel = page.locator('.panel', { has: page.locator('h2', { hasText: '周计划' }) })
    const recordPanel = page.locator('.panel', { has: page.locator('h2', { hasText: '时间记录' }) })
    await planPanel.screenshot({ path: join(shotDir, '08-plan-steam.png') })
    await recordPanel.screenshot({ path: join(shotDir, '09-records-steam.png') })
    await assertSlotRows(planPanel, '周计划（深色）', 3, 'dark')
    await assertSlotRows(recordPanel, '时间记录（深色）', 4, 'dark')

    // 深色下关闭时段底色：时间格回到深色表面，文字与分隔线仍可读
    await setSlotTint(page, false)
    await assertSlotRows(planPanel, '周计划（深色·关闭底色）', 0, 'dark', false)
    await assertSlotRows(recordPanel, '时间记录（深色·关闭底色）', 0, 'dark', false)
    await assertSlotHoverNeutral(page, recordPanel, '时间记录（深色·关闭底色）')
    await planPanel.screenshot({ path: join(shotDir, '28-plan-dark-tint-off.png') })
    await setSlotTint(page, true)
    await assertSlotRows(planPanel, '周计划（深色·重新开启）', 3, 'dark')

    await assertClockDate(page, '深色时钟')
    const darkTodayLabel = WEEKDAY_LABELS[new Date().getDay()]
    const darkOtherLabel = darkTodayLabel === '周一' ? '周二' : '周一'
    await planPanel.locator('.weekday-tab', { hasText: darkOtherLabel }).click()
    await planPanel.screenshot({ path: join(shotDir, '31-plan-dark-today-button.png') })
    await planPanel.getByRole('button', { name: '回到今天' }).click()

    // 深色空状态：未来日期允许查看，但不能与“当天没有记录”混为一谈
    const tomorrow = shiftDateString(localDateString(new Date()), 1)
    await recordPanel.locator('.records-date').fill(tomorrow)
    await recordPanel
      .getByText('这一天还没有到来，暂时没有记录。')
      .waitFor({ timeout: 5_000 })
    await recordPanel.screenshot({ path: join(shotDir, '23-records-future-steam.png') })
    await recordPanel.getByRole('button', { name: '回到今天' }).click()
    await recordPanel.locator('tbody tr', { hasText: '02:10-03:00' }).waitFor({ timeout: 5_000 })

    await page.locator('.app-header-right button').first().click()
    await page.locator('.settings-modal').waitFor({ timeout: 5_000 })
    await page.screenshot({ path: join(shotDir, '14-settings-general-steam.png'), fullPage: true })
    await page.locator('.settings-tab[data-tab="data"]').click()
    await page.locator('.settings-modal').waitFor({ timeout: 5_000 })
    await page.screenshot({ path: join(shotDir, '05-settings-data-steam.png'), fullPage: true })
    await page.keyboard.press('Escape')
  })

  await check('切换紧凑密度后立即压缩行高与控件', async () => {
    const planPanel = page.locator('.panel', { has: page.locator('h2', { hasText: '周计划' }) })
    const recordPanel = page.locator('.panel', { has: page.locator('h2', { hasText: '时间记录' }) })
    const comfortableRow = await planPanel.locator('tbody .plan-row').first().boundingBox()
    const comfortableSelect = await page.locator('.plan-form select').boundingBox()

    await page.locator('.app-header-right button').first().click()
    await page.locator('.settings-tab[data-tab="appearance"]').click()
    await page.locator('.settings-form select').selectOption('compact')
    await page.waitForFunction(
      () => document.documentElement.dataset.density === 'compact',
      null,
      { timeout: 5_000 },
    )
    await page.screenshot({ path: join(shotDir, '17-settings-compact-steam.png'), fullPage: true })
    await page.keyboard.press('Escape')
    await assertClockDate(page, '紧凑深色时钟')
    const statsPanel = page.locator('.stats-panel')
    await clickStatsPreset(statsPanel, '全部')
    await waitStatsBadge(
      page,
      statsPanel,
      `${shiftDateString(localDateString(new Date()), -1)} ~ ${localDateString(new Date())}`,
      '紧凑深色全部',
    )
    await statsPanel.screenshot({ path: join(shotDir, '37-stats-all-compact-dark.png') })
    await clickStatsPreset(statsPanel, '本周')

    // 紧凑密度下行高变了，时段底色与文字对比度不能跟着变差
    await assertSlotRows(planPanel, '周计划（紧凑深色）', 3, 'dark')
    await assertSlotRows(recordPanel, '时间记录（紧凑深色）', 4, 'dark')
    await setSlotTint(page, false)
    await assertSlotRows(planPanel, '周计划（紧凑深色·关闭底色）', 0, 'dark', false)
    await assertSlotRows(recordPanel, '时间记录（紧凑深色·关闭底色）', 0, 'dark', false)
    await setSlotTint(page, true)

    // 紧凑密度下日期回溯仍然可用，日期框不高于记录行
    await recordPanel.getByRole('button', { name: '前一天' }).click()
    await recordPanel.locator('tbody tr', { hasText: '14:20-15:50' }).waitFor({ timeout: 5_000 })
    await recordPanel.getByRole('button', { name: '回到今天' }).click()
    await recordPanel.locator('tbody tr', { hasText: '02:10-03:00' }).waitFor({ timeout: 5_000 })
    const compactDateBox = await recordPanel.locator('.records-date').boundingBox()
    const compactRecordRow = await recordPanel.locator('tbody tr').first().boundingBox()
    if (
      compactDateBox === null ||
      compactRecordRow === null ||
      compactDateBox.height > compactRecordRow.height + 1
    ) {
      throw new Error('紧凑密度下日期框高度没有跟随行高')
    }

    const compactRow = await planPanel.locator('tbody .plan-row').first().boundingBox()
    const compactSelect = await page.locator('.plan-form select').boundingBox()
    if (comfortableRow === null || compactRow === null || comfortableSelect === null || compactSelect === null) {
      throw new Error('无法测量密度切换前后的行高或控件高度')
    }
    if (comfortableRow.height - compactRow.height < 4) {
      throw new Error(`紧凑档行高压缩不足：${comfortableRow.height} → ${compactRow.height}`)
    }
    if (comfortableSelect.height - compactSelect.height < 4) {
      throw new Error(`紧凑档控件压缩不足：${comfortableSelect.height} → ${compactSelect.height}`)
    }

    // 压缩后周计划与时间记录的时间列仍需等宽
    const planTimeBox = await planPanel.locator('thead .time-cell').boundingBox()
    const recordTimeBox = await recordPanel.locator('thead .time-cell').boundingBox()
    if (
      planTimeBox === null ||
      recordTimeBox === null ||
      Math.abs(planTimeBox.width - recordTimeBox.width) > 1
    ) {
      throw new Error('紧凑档下两处时间列宽度不一致')
    }

    await page.locator('.theme-picker select').selectOption('celadon')
    await page.waitForTimeout(150)
    await page.screenshot({ path: join(shotDir, '15-app-compact-light.png'), fullPage: true })
    await assertClockDate(page, '紧凑浅色时钟')
    await page.locator('.clock-panel').screenshot({ path: join(shotDir, '32-clock-compact-light.png') })
    await clickStatsPreset(statsPanel, '全部')
    await waitStatsBadge(
      page,
      statsPanel,
      `${shiftDateString(localDateString(new Date()), -1)} ~ ${localDateString(new Date())}`,
      '紧凑浅色全部',
    )
    await statsPanel.screenshot({ path: join(shotDir, '38-stats-all-compact-light.png') })
    await clickStatsPreset(statsPanel, '本周')
    await assertSlotRows(planPanel, '周计划（紧凑浅色）', 3, 'light')
    await assertSlotRows(recordPanel, '时间记录（紧凑浅色）', 4, 'light')
    await setSlotTint(page, false)
    await assertSlotRows(planPanel, '周计划（紧凑浅色·关闭底色）', 0, 'light', false)
    await assertSlotRows(recordPanel, '时间记录（紧凑浅色·关闭底色）', 0, 'light', false)
    await setSlotTint(page, true)
    await page.locator('.theme-picker select').selectOption('steam')
    await page.waitForTimeout(150)
    await page.screenshot({ path: join(shotDir, '16-app-compact-dark.png'), fullPage: true })
  })

  await check('导入后截取铃声（浅色/深色/紧凑）', async () => {
    // 先把密度与主题恢复到基准，避免沿用上一项的紧凑深色
    await page.locator('.app-header-right button').first().click()
    await page.locator('.settings-tab[data-tab="appearance"]').click()
    await page.locator('.settings-form select').selectOption('comfortable')
    await page.waitForFunction(
      () => document.documentElement.dataset.density !== 'compact',
      null,
      { timeout: 5_000 },
    )
    await page.keyboard.press('Escape')
    await page.locator('.theme-picker select').selectOption('celadon')
    await page.waitForTimeout(120)

    const lightTrim = await openRingtoneTrim(page)
    await assertTrimLight(page, lightTrim)
    await page.screenshot({ path: join(shotDir, '18-ringtone-trim-light.png') })
    await assertPreviewToggle(page, lightTrim)

    // 保存后从列表重新切片，验证加载已保存区间且不新增文件
    const committedRange = (await lightTrim.locator('.ringtone-trim-range').textContent()) ?? ''
    await lightTrim.locator('.ringtone-trim-actions .primary').click()
    await lightTrim.waitFor({ state: 'detached', timeout: 5_000 })
    const savedItem = page.locator('.ringtone-custom-item', { hasText: 'Focus Session' })
    await savedItem.getByRole('button', { name: '重新切片' }).click()
    const editTrim = page.locator('.ringtone-trim')
    await editTrim.waitFor({ timeout: 5_000 })
    await page.locator('.ringtone-waveform[data-ready="true"]').waitFor({ timeout: 5_000 })
    const editRange = (await editTrim.locator('.ringtone-trim-range').textContent()) ?? ''
    if (editRange !== committedRange) {
      throw new Error(`重新切片未加载已保存区间：${committedRange} → ${editRange}`)
    }
    await page.screenshot({ path: join(shotDir, '25-ringtone-reslice-light.png') })

    // 改区间后覆盖保存，再次进入应沿用最新区间且不新增记录
    const editHandle = page.locator('.ringtone-waveform [part~="region-handle-right"]').first()
    const editBox = await editHandle.boundingBox()
    if (editBox === null) {
      throw new Error('重新切片未找到选区终点手柄')
    }
    await page.mouse.move(editBox.x + editBox.width / 2, editBox.y + editBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(editBox.x + editBox.width / 2 - 100, editBox.y + editBox.height / 2, {
      steps: 8,
    })
    await page.mouse.up()
    await page.waitForTimeout(120)
    const editedRange = (await editTrim.locator('.ringtone-trim-range').textContent()) ?? ''
    if (editedRange === editRange) {
      throw new Error('重新切片时拖动未修改区间')
    }
    await editTrim.locator('.ringtone-trim-actions .primary').click()
    await editTrim.waitFor({ state: 'detached', timeout: 5_000 })

    const sameItem = page.locator('.ringtone-custom-item', { hasText: 'Focus Session' })
    if ((await sameItem.count()) !== 1) {
      throw new Error('重新切片不应产生第二份记录')
    }
    await sameItem.getByRole('button', { name: '重新切片' }).click()
    await page.locator('.ringtone-trim').waitFor({ timeout: 5_000 })
    await page.locator('.ringtone-waveform[data-ready="true"]').waitFor({ timeout: 5_000 })
    const reopened = (await page.locator('.ringtone-trim-range').textContent()) ?? ''
    if (reopened !== editedRange) {
      throw new Error(`覆盖保存后区间未保持：${editedRange} → ${reopened}`)
    }
    await page.locator('.ringtone-trim').getByRole('button', { name: '取消' }).click()
    await page.keyboard.press('Escape')

    await page.locator('.theme-picker select').selectOption('steam')
    await page.waitForTimeout(120)
    const darkTrim = await openRingtoneTrim(page)
    await assertTrimContrast(darkTrim)
    await page.screenshot({ path: join(shotDir, '19-ringtone-trim-dark.png') })

    // 紧凑密度下截取卡片不能被挤压出横向滚动
    await page.locator('.settings-tab[data-tab="appearance"]').click()
    await page.locator('.settings-form select').selectOption('compact')
    await page.waitForFunction(
      () => document.documentElement.dataset.density === 'compact',
      null,
      { timeout: 5_000 },
    )
    await page.locator('.settings-tab[data-tab="ringtones"]').click()
    // 切换 tab 会卸载铃声面板，重新导入以验证紧凑密度下的截取卡片
    await page.getByRole('button', { name: '导入本地铃声' }).click()
    const compactTrim = page.locator('.ringtone-trim')
    await compactTrim.waitFor({ timeout: 5_000 })
    await page.locator('.ringtone-waveform[data-ready="true"]').waitFor({ timeout: 5_000 })
    const overflow = await compactTrim.evaluate((element) => element.scrollWidth - element.clientWidth)
    if (overflow > 1) {
      throw new Error(`紧凑密度下截取卡片横向溢出 ${overflow}px`)
    }
    await assertTrimContrast(compactTrim)
    await page.screenshot({ path: join(shotDir, '20-ringtone-trim-compact-dark.png') })

    await page.locator('.settings-tab[data-tab="appearance"]').click()
    await page.locator('.settings-form select').selectOption('comfortable')
    await page.keyboard.press('Escape')
    await page.locator('.theme-picker select').selectOption('celadon')
    await page.waitForTimeout(120)

    // 铃声设置页整体截图（浅色/深色），不展开截取卡片
    await page.locator('.app-header-right button').first().click()
    await page.locator('.settings-modal').waitFor({ timeout: 5_000 })
    await page.locator('.settings-tab[data-tab="ringtones"]').click()
    await page.screenshot({ path: join(shotDir, '23-ringtone-settings-light.png') })
    await page.locator('.theme-picker select').selectOption('steam')
    await page.waitForTimeout(150)
    await page.screenshot({ path: join(shotDir, '24-ringtone-settings-dark.png') })
    await page.locator('.theme-picker select').selectOption('celadon')
    await page.keyboard.press('Escape')
  })

  await check('选区内部拖动整段平移', async () => {
    const trim = await openRingtoneTrim(page)
    const initial = await readTrimRange(trim)
    assertNear(initial.start, 0, 0.05, '平移用例初始起点')
    assertNear(initial.end, 60, 0.05, '平移用例初始终点')

    // 向左撞到 0：起点停在 0，长度不能被压缩
    await dragRegionBody(page, -600)
    const atStart = await readTrimRange(trim)
    assertNear(atStart.start, 0, 0.05, '平移到 0 边界')
    assertNear(atStart.end, 60, 0.05, '平移到 0 时长度不变')

    // 向右分段推到文件末尾：终点停在 186，长度仍是 60
    for (let index = 0; index < 6; index += 1) {
      await dragRegionBody(page, 400)
    }
    const atEnd = await readTrimRange(trim)
    assertNear(atEnd.start, 126, 0.05, '平移到文件末尾时起点')
    assertNear(atEnd.end, 186, 0.05, '平移到文件末尾时终点')
    assertNear(atEnd.end - atEnd.start, 60, 0.1, '平移后长度保持 60')

    // 越过末尾继续推：两端都停住，不出现回弹或挤变形
    await dragRegionBody(page, 400)
    const pinned = await readTrimRange(trim)
    assertNear(pinned.start, 126, 0.05, '越过末尾后起点不变')
    assertNear(pinned.end, 186, 0.05, '越过末尾后终点不变')

    // 平移后手柄仍只改单端，证明正文拖动没有接管手柄
    await dragRegionHandle(page, 'left', 120)
    const resized = await readTrimRange(trim)
    if (resized.start <= atEnd.start + 0.5) {
      throw new Error(`平移后起点手柄未响应：${resized.text}`)
    }
    assertNear(resized.end, 186, 0.05, '拖动起点时终点不应跳变')

    if ((await trim.locator('.message').count()) !== 0) {
      throw new Error('平移选区不应产生提示')
    }
    if ((await trim.getAttribute('data-playing')) === 'true') {
      throw new Error('暂停态平移不应自动播放')
    }

    await trim.getByRole('button', { name: '取消' }).click()
    await page.keyboard.press('Escape')
  })

  await check('短音频选区不越过文件末尾', async () => {
    await page.locator('.app-header-right button').first().click()
    await page.locator('.settings-modal').waitFor({ timeout: 5_000 })
    await page.locator('.settings-tab[data-tab="ringtones"]').click()
    // 预置旧铃声只有 12 秒，短于 60 秒上限
    const oldItem = page.locator('.ringtone-custom-item', { hasText: '旧铃声' })
    await oldItem.getByRole('button', { name: '重新切片' }).click()
    const trim = page.locator('.ringtone-trim')
    await trim.waitFor({ timeout: 5_000 })
    await page.locator('.ringtone-waveform[data-ready="true"]').waitFor({ timeout: 5_000 })

    const initial = await readTrimRange(trim)
    assertNear(initial.start, 0, 0.05, '短音频起点')
    assertNear(initial.end, 12, 0.05, '短音频终点应为文件末尾')

    await dragRegionHandle(page, 'right', 300)
    const clampedEnd = await readTrimRange(trim)
    assertNear(clampedEnd.end, 12, 0.05, '终点不应越过文件末尾')
    assertNear(clampedEnd.start, initial.start, 0.05, '拖动终点不应移动起点')

    await dragRegionHandle(page, 'left', -300)
    const clampedStart = await readTrimRange(trim)
    assertNear(clampedStart.start, 0, 0.05, '起点不应越过 0')
    assertNear(clampedStart.end, 12, 0.05, '拖动起点不应移动终点')

    await dragRegionHandle(page, 'left', 300)
    const shifted = await readTrimRange(trim)
    assertNear(shifted.end, 12, 0.05, '短音频拖动起点时终点不应回弹')
    if (shifted.start <= clampedStart.start + 0.5) {
      throw new Error(`短音频起点拖动没有响应：${shifted.text}`)
    }
    if ((await trim.locator('.message').count()) !== 0) {
      throw new Error('短音频选区不应产生提示')
    }

    // 短音频内的整段平移：两端各自停住，长度始终不变
    const beforeMove = await readTrimRange(trim)
    const moveLength = beforeMove.end - beforeMove.start
    await dragRegionBody(page, -600)
    const movedToStart = await readTrimRange(trim)
    assertNear(movedToStart.start, 0, 0.05, '短音频平移到 0 边界')
    assertNear(
      movedToStart.end - movedToStart.start,
      moveLength,
      0.1,
      '短音频平移到 0 后长度不变',
    )

    for (let index = 0; index < 4; index += 1) {
      await dragRegionBody(page, 400)
    }
    const movedToEnd = await readTrimRange(trim)
    assertNear(movedToEnd.end, 12, 0.05, '短音频平移到文件末尾')
    assertNear(
      movedToEnd.end - movedToEnd.start,
      moveLength,
      0.1,
      '短音频平移到末尾后长度不变',
    )
    if ((await trim.locator('.message').count()) !== 0) {
      throw new Error('短音频平移不应产生提示')
    }

    await trim.getByRole('button', { name: '取消' }).click()
    await page.keyboard.press('Escape')
  })

  return failures
}

async function openRingtoneTrim(page) {
  await page.locator('.app-header-right button').first().click()
  await page.locator('.settings-modal').waitFor({ timeout: 5_000 })
  await page.locator('.settings-tab[data-tab="ringtones"]').click()
  await page.getByRole('button', { name: '导入本地铃声' }).click()
  const trim = page.locator('.ringtone-trim')
  try {
    await trim.waitFor({ timeout: 5_000 })
    // 波形要等 fetch + decode 完成才算可用
    await page.locator('.ringtone-waveform[data-ready="true"]').waitFor({ timeout: 5_000 })
  } catch (error) {
    const panel = await page.locator('.settings-panel').innerText().catch(() => '<no panel>')
    throw new Error(`截取卡片未就绪：${error.message}\n--- panel ---\n${panel}`)
  }
  return trim
}

async function assertTrimLight(page, trim) {
  const summary = (await trim.locator('.ringtone-trim-summary').textContent()) ?? ''
  if (!summary.includes('1:00.0')) {
    throw new Error(`默认选区应为前 60 秒：${summary}`)
  }
  const source = (await trim.locator('.ringtone-trim-head .badge').textContent()) ?? ''
  if (!source.includes('3:06.0')) {
    throw new Error(`源文件时长显示异常：${source}`)
  }
  const rangeText = (await trim.locator('.ringtone-trim-range').textContent()) ?? ''
  if (!rangeText.includes('0:00.0') || !rangeText.includes('1:00.0')) {
    throw new Error(`起止时间显示异常：${rangeText}`)
  }
  if ((await trim.locator('.ringtone-trim-field').count()) !== 0) {
    throw new Error('起点/终点滑块应已移除')
  }
  if ((await trim.getAttribute('data-playing')) !== 'false') {
    throw new Error('截取卡片初始应为暂停态')
  }

  // 暂停态拖动：选区更新但不自动出声
  const handle = page.locator('.ringtone-waveform [part~="region-handle-right"]').first()
  const box = await handle.boundingBox()
  if (box === null) {
    throw new Error('未找到选区终点手柄')
  }
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 120, y, { steps: 8 })
  await page.waitForTimeout(120)
  if ((await trim.getAttribute('data-playing')) === 'true') {
    throw new Error('暂停态拖动不应自动播放')
  }
  const narrowed = (await trim.locator('.ringtone-trim-range').textContent()) ?? ''
  await page.mouse.up()
  if (narrowed === rangeText) {
    throw new Error('拖动终点后区间未变化')
  }

  // 聚焦波形后用方向键微调 0.1 秒
  await trim.locator('.ringtone-waveform').focus()
  const beforeNudge = (await trim.locator('.ringtone-trim-range').textContent()) ?? ''
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(80)
  const afterNudge = (await trim.locator('.ringtone-trim-range').textContent()) ?? ''
  if (afterNudge === beforeNudge) {
    throw new Error(`方向键未微调区间：${afterNudge}`)
  }

  // 向右拖到头只停在 60 秒，且不出现超限提示
  const maxHandle = page.locator('.ringtone-waveform [part~="region-handle-right"]').first()
  const maxBox = await maxHandle.boundingBox()
  if (maxBox === null) {
    throw new Error('未找到选区终点手柄')
  }
  const maxY = maxBox.y + maxBox.height / 2
  await page.mouse.move(maxBox.x + maxBox.width / 2, maxY)
  await page.mouse.down()
  await page.mouse.move(maxBox.x + 350, maxY, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(120)
  const clamped = (await trim.locator('.ringtone-trim-length').textContent()) ?? ''
  if (!clamped.includes('1:00.0')) {
    throw new Error(`选区未钳制在 60 秒：${clamped}`)
  }
  if ((await trim.locator('.message').count()) !== 0) {
    throw new Error('不应出现超限提示')
  }
  if ((await trim.getAttribute('data-playing')) === 'true') {
    throw new Error('拖动选区不应自动播放')
  }
  await assertSelectionDragStability(page, trim)
  await assertTrimContrast(trim)
}

function parseClockText(text) {
  const [minutes, seconds] = text.split(':')
  return Number(minutes) * 60 + Number(seconds)
}

async function readTrimRange(trim) {
  const text = (await trim.locator('.ringtone-trim-range').textContent()) ?? ''
  const [startText, endText] = text.split('→').map((part) => part.trim())
  return { text, start: parseClockText(startText), end: parseClockText(endText) }
}

function assertNear(actual, expected, tolerance, label) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}：期望 ${expected}（±${tolerance}），实际 ${actual}`)
  }
}

function localDateString(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function shiftDateString(value, days) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  return localDateString(date)
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

async function clickStatsPreset(statsPanel, label) {
  await statsPanel.locator('.stats-preset', { hasText: label }).click()
}

async function waitStatsBadge(page, statsPanel, expected, label) {
  try {
    await page.waitForFunction(
      (text) => {
        const badge = document.querySelector('.stats-panel .panel-head .badge')
        return (badge?.textContent ?? '').trim() === text
      },
      expected,
      { timeout: 5_000 },
    )
  } catch {
    const actual = (await statsPanel.locator('.panel-head .badge').textContent())?.trim()
    throw new Error(`${label} 统计范围不正确：${actual} ≠ ${expected}`)
  }
}

// 时钟旁的日期附注：格式、弱色、小字号，且明显小于主时钟
async function assertClockDate(page, label) {
  const clockPanel = page.locator('.clock-panel')
  const dateEl = clockPanel.locator('.clock-date')
  const text = (await dateEl.textContent())?.trim() ?? ''
  const now = new Date()
  const expected = `${localDateString(now)} ${WEEKDAY_LABELS[now.getDay()]}`
  if (text !== expected) {
    throw new Error(`${label} 日期附注不正确：${text} ≠ ${expected}`)
  }
  const style = await dateEl.evaluate((element) => {
    const own = getComputedStyle(element)
    const clock = element.closest('.clock-panel')?.querySelector('.clock-time')
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-text-weak)'
    document.body.appendChild(probe)
    const weak = getComputedStyle(probe).color
    probe.remove()
    return {
      color: own.color,
      size: Number.parseFloat(own.fontSize),
      clockSize: clock === null || clock === undefined ? 0 : Number.parseFloat(getComputedStyle(clock).fontSize),
      weak,
    }
  })
  if (style.color !== style.weak) {
    throw new Error(`${label} 日期附注未使用弱文字色：${style.color} ≠ ${style.weak}`)
  }
  if (style.size > 11 || style.size * 2 > style.clockSize) {
    throw new Error(`${label} 日期附注字号层级异常：${style.size}px / 时钟 ${style.clockSize}px`)
  }
}

// 按住选区正文拖动，与按在手柄上的单端拖动区分开
async function dragRegionBody(page, deltaX, steps = 8) {
  const region = page.locator('.ringtone-waveform [part~="region"]').first()
  const box = await region.boundingBox()
  if (box === null) {
    throw new Error('未找到可平移的选区主体')
  }
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + deltaX, y, { steps })
  await page.mouse.up()
  await page.waitForTimeout(80)
}

async function dragRegionHandle(page, side, deltaX, steps = 6) {
  const label = side === 'left' ? '起点' : '终点'
  const handle = page.locator(`.ringtone-waveform [part~="region-handle-${side}"]`).first()
  const box = await handle.boundingBox()
  if (box === null) {
    throw new Error(`未找到选区${label}手柄`)
  }
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + deltaX, y, { steps })
  await page.mouse.up()
  await page.waitForTimeout(80)
}

// 键盘微调只作用于最近拖动的一端，正好用来把窗口推到绝对边界
async function nudgeActiveEdge(page, direction) {
  await page.locator('.ringtone-waveform').focus()
  for (let index = 0; index < 60; index += 1) {
    await page.keyboard.press(`Shift+Arrow${direction}`)
  }
  await page.waitForTimeout(60)
}

// 回归：拖动一端时另一端不能跳变，越界只能停在绝对边界上
async function assertSelectionDragStability(page, trim) {
  const base = await readTrimRange(trim)
  assertNear(base.start, 0, 0.05, '稳定性用例起点')
  assertNear(base.end, 60, 0.05, '稳定性用例终点')

  // 起点右移：终点原地不动
  await dragRegionHandle(page, 'left', 120)
  const startMoved = await readTrimRange(trim)
  if (startMoved.start <= base.start + 0.5) {
    throw new Error(`起点拖动没有响应：${startMoved.text}`)
  }
  assertNear(startMoved.end, base.end, 0.05, '拖动起点时终点不应跳变')

  // 终点右移：起点原地不动，窗口封顶 60 秒
  await dragRegionHandle(page, 'right', 260)
  const widened = await readTrimRange(trim)
  assertNear(widened.start, startMoved.start, 0.05, '拖动终点时起点不应跳变')
  assertNear(widened.end - widened.start, 60, 0.15, '窗口拉满时应正好 60 秒')

  // 窗口已满 60 秒时把起点往回拖：停在左边界，终点不能回弹
  await dragRegionHandle(page, 'left', -260)
  const pinned = await readTrimRange(trim)
  assertNear(pinned.start, widened.start, 0.05, '起点越界时应停在窗口左边界')
  assertNear(pinned.end, widened.end, 0.05, '起点越界时终点不应回弹')

  // 终点拖到起点：长度收窄到最小值，起点不动
  // 用 1px 步进贴近最小边界，避免测试脚本自己跨过对面端点
  for (let index = 0; index < 6; index += 1) {
    await dragRegionHandle(page, 'right', -60, 60)
  }
  const minimal = await readTrimRange(trim)
  assertNear(minimal.start, pinned.start, 0.05, '收窄选区时起点不应跳变')
  if (minimal.end - minimal.start > 0.6) {
    throw new Error(`选区未收窄到最小值：${minimal.text}`)
  }

  // 起点拖到 0：终点不动
  for (let index = 0; index < 4; index += 1) {
    await dragRegionHandle(page, 'left', -260)
  }
  const zeroed = await readTrimRange(trim)
  assertNear(zeroed.start, 0, 0.05, '起点应拖到 0')
  assertNear(zeroed.end, minimal.end, 0.05, '拖起点到 0 时终点不应跳变')

  // 终点拉满 60 秒
  for (let index = 0; index < 3; index += 1) {
    await dragRegionHandle(page, 'right', 260)
  }
  const full = await readTrimRange(trim)
  assertNear(full.start, 0, 0.05, '拉满时起点不应移动')
  assertNear(full.end, 60, 0.15, '拉满时应正好停在 60 秒')

  // 交替把两端推向文件末尾：终点停在 186 秒，不越界
  // （拖动本身已在上面验证，这里用键盘步进把窗口定位到末尾）
  for (let index = 0; index < 3; index += 1) {
    await dragRegionHandle(page, 'left', 12)
    await nudgeActiveEdge(page, 'Right')
    await dragRegionHandle(page, 'right', 12)
    await nudgeActiveEdge(page, 'Right')
  }
  const atEnd = await readTrimRange(trim)
  assertNear(atEnd.end, 186, 0.05, '终点应停在文件末尾')
  await dragRegionHandle(page, 'right', 260)
  const stillAtEnd = await readTrimRange(trim)
  assertNear(stillAtEnd.end, 186, 0.05, '文件末尾继续拖动不应越界')
  assertNear(stillAtEnd.start, atEnd.start, 0.05, '文件末尾拖动不应移动起点')

  // 末尾压到最窄时必须保留手柄：库会按像素摘掉“看不见”的选区
  await dragRegionHandle(page, 'left', 12)
  await nudgeActiveEdge(page, 'Right')
  const endTight = await readTrimRange(trim)
  assertNear(endTight.end, 186, 0.05, '末尾最窄选区终点')
  const handleCounts = await Promise.all([
    page.locator('.ringtone-waveform [part~="region-handle-left"]').count(),
    page.locator('.ringtone-waveform [part~="region-handle-right"]').count(),
  ])
  if (handleCounts[0] !== 1 || handleCounts[1] !== 1) {
    throw new Error(`末尾最窄选区的手柄丢失：${handleCounts.join('/')}`)
  }
  // 用键盘把起点拉回中间窗口（末尾窄选区的两个手柄会重叠，鼠标无法稳定区分）
  await nudgeActiveEdge(page, 'Left')
  const reset = await readTrimRange(trim)
  assertNear(reset.start, 126, 0.05, '起点应被键盘拉回窗口左边界')
  assertNear(reset.end, 186, 0.05, '拉回起点时终点不应跳变')

  // 回到中间窗口后连续快速交替拖动：不回弹、不漂移、不卡死
  await dragRegionHandle(page, 'right', -120)
  const beforeOsc = await readTrimRange(trim)
  let previousEnd = beforeOsc.end
  for (let index = 0; index < 6; index += 1) {
    const deltaX = index % 2 === 0 ? -90 : 90
    await dragRegionHandle(page, 'right', deltaX, 2)
    const now = await readTrimRange(trim)
    assertNear(now.start, beforeOsc.start, 0.05, '快速拖动时起点不应漂移')
    if (deltaX > 0 && now.end < previousEnd - 0.05) {
      throw new Error(`终点向右拖动出现回弹：${previousEnd} → ${now.end}`)
    }
    if (deltaX < 0 && now.end > previousEnd + 0.05) {
      throw new Error(`终点向左拖动出现回弹：${previousEnd} → ${now.end}`)
    }
    const length = now.end - now.start
    if (length < 0.05 || length > 60.05) {
      throw new Error(`快速拖动后选区长度异常：${now.text}`)
    }
    if (now.end > 186.05) {
      throw new Error(`快速拖动后终点越界：${now.text}`)
    }
    previousEnd = now.end
  }
  if ((await trim.locator('.message').count()) !== 0) {
    throw new Error('选区拖动不应产生提示')
  }
  if ((await trim.getAttribute('data-playing')) === 'true') {
    throw new Error('暂停态拖动不应自动播放')
  }
}

async function assertPreviewToggle(page, trim) {
  const preview = trim.locator('.ringtone-trim-actions button').first()
  await preview.click()
  await page.locator('.ringtone-trim[data-playing="true"]').waitFor({ timeout: 3_000 })
  if ((await preview.getAttribute('aria-pressed')) !== 'true') {
    throw new Error('试听按钮未进入开启态')
  }
  if (!((await preview.textContent()) ?? '').includes('停止试听')) {
    throw new Error('试听开启后按钮文案未切换')
  }
  await page.waitForTimeout(450)
  await page.screenshot({ path: join(shotDir, '21-ringtone-trim-playing-light.png') })
  await preview.click()
  await page.locator('.ringtone-trim[data-playing="false"]').waitFor({ timeout: 3_000 })
  if (!((await preview.textContent()) ?? '').includes('试听选区')) {
    throw new Error('再次点击试听后未回到关闭态')
  }
}

async function assertTrimContrast(trim) {
  const sample = await trim.evaluate((element) => {
    const name = element.querySelector('.ringtone-trim-name')
    const length = element.querySelector('.ringtone-trim-length')
    return {
      background: getComputedStyle(element).backgroundColor,
      name: name === null ? '' : getComputedStyle(name).color,
      length: length === null ? '' : getComputedStyle(length).color,
    }
  })
  const background = parseRgb(sample.background)
  const nameColor = parseRgb(sample.name)
  const lengthColor = parseRgb(sample.length)
  if (background === null || nameColor === null || lengthColor === null) {
    throw new Error(`无法解析截取卡片颜色：${JSON.stringify(sample)}`)
  }
  const nameRatio = contrastRatio(nameColor, background)
  const lengthRatio = contrastRatio(lengthColor, background)
  if (nameRatio < 4.5) {
    throw new Error(`截取卡片文件名对比不足：${nameRatio.toFixed(2)}`)
  }
  if (lengthRatio < 4) {
    throw new Error(`截取卡片选区长度对比不足：${lengthRatio.toFixed(2)}`)
  }
}

function parseRgb(value) {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value)
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
}

function brightness(rgb) {
  return (rgb[0] + rgb[1] + rgb[2]) / 3
}

const SLOT_BOUNDARIES = [
  [0, 'night'],
  [5 * 60 + 30, 'dawn'],
  [8 * 60, 'morning'],
  [12 * 60, 'noon'],
  [14 * 60, 'afternoon'],
  [18 * 60, 'evening'],
  [21 * 60 + 30, 'late-night'],
]

// 与渲染层 time-slot.ts 使用同一套左闭右开边界，用来反查归属是否正确
function slotOfClock(text) {
  const [hours, minutes] = text.split(':').map(Number)
  const total = hours * 60 + minutes
  let slot = 'night'
  for (const [start, id] of SLOT_BOUNDARIES) {
    if (total >= start) {
      slot = id
    }
  }
  return slot
}

function parseColor(value) {
  const match = /rgba?\(([^)]+)\)/.exec(value)
  if (match === null) {
    return null
  }
  const parts = match[1].split(',').map((part) => Number(part.trim()))
  if (parts.some((part) => !Number.isFinite(part))) {
    return null
  }
  return { rgb: [parts[0], parts[1], parts[2]], alpha: parts[3] ?? 1 }
}

function compositeOver(front, back) {
  return front.rgb.map((channel, index) =>
    Math.round(channel * front.alpha + back.rgb[index] * (1 - front.alpha)),
  )
}

// 校验时段底色只落在时间格：归属正确、同档一致、浅/深强度符合预期、
// 时间文字在真实合成底色上达到 AA；行动/时长/操作格必须保持透明中性。
// tintEnabled=false 时时间格必须完全中性（无底色），分隔线仍需可见。
async function assertSlotRows(panel, label, minSlots, mode, tintEnabled = true) {
  const rows = panel.locator('tbody tr[data-slot]')
  if ((await rows.count()) === 0) {
    throw new Error(`${label} 没有带时段标记的数据行`)
  }
  const rootState = await panel.page().evaluate(() => ({
    tint: document.documentElement.dataset.slotTint,
    theme: document.documentElement.dataset.theme,
  }))
  const samples = await rows.evaluateAll((items) =>
    items.map((row) => {
      const table = row.closest('table')
      const time = row.querySelector('td.time-cell')
      const neutralCells = Array.from(
        row.querySelectorAll('td.action-cell, td.duration-cell, td.actions-cell'),
      )
      const timeStyle = time === null ? null : getComputedStyle(time)
      return {
        slot: row.getAttribute('data-slot'),
        start: (time?.textContent ?? '').trim().split('-')[0],
        timeBackground: timeStyle?.backgroundColor ?? '',
        timeColor: timeStyle?.color ?? '',
        timeBorder: {
          width: timeStyle?.borderRightWidth ?? '0px',
          style: timeStyle?.borderRightStyle ?? 'none',
          color: timeStyle?.borderRightColor ?? '',
        },
        tableBackground: table === null ? '' : getComputedStyle(table).backgroundColor,
        neutralBackgrounds: neutralCells.map((cell) => getComputedStyle(cell).backgroundColor),
      }
    }),
  )

  const tintBySlot = new Map()
  for (const sample of samples) {
    const expected = slotOfClock(sample.start)
    if (sample.slot !== expected) {
      throw new Error(`${label} ${sample.start} 时段归属错误：${sample.slot} ≠ ${expected}`)
    }

    const timeTint = parseColor(sample.timeBackground)
    const tableColor = parseColor(sample.tableBackground)
    if (timeTint === null || tableColor === null) {
      throw new Error(
        `${label} 无法解析时间格底色：${sample.timeBackground} / ${sample.tableBackground}`,
      )
    }

    if (!tintEnabled) {
      // 关闭开关或主题未配置：不编造颜色，时间格保持透明
      if (timeTint.alpha > 0.001) {
        throw new Error(`${label} ${sample.start} 关闭底色后仍有偏置：${sample.timeBackground}`)
      }
      if (
        sample.timeBorder.style === 'none' ||
        Number.parseFloat(sample.timeBorder.width) < 1
      ) {
        throw new Error(`${label} ${sample.start} 时间列分隔线丢失`)
      }
      const borderColor = parseColor(sample.timeBorder.color)
      if (borderColor === null || borderColor.alpha < 0.01) {
        throw new Error(`${label} ${sample.start} 时间列分隔线不可见：${sample.timeBorder.color}`)
      }
    } else {
      if (timeTint.alpha < 0.01) {
        throw new Error(
          `${label} ${sample.start} 时间格没有底色偏置（tint=${rootState.tint} theme=${rootState.theme}）`,
        )
      }

      const background = compositeOver(timeTint, tableColor)
      const luminance = relativeLuminance(background)
      if (mode === 'light' && luminance < 0.8) {
        throw new Error(`${label} ${sample.start} 浅色偏置过重：亮度 ${luminance.toFixed(3)}`)
      }
      if (mode === 'dark' && luminance > 0.12) {
        throw new Error(`${label} ${sample.start} 深色偏置过亮：亮度 ${luminance.toFixed(3)}`)
      }

      const key = background.join(',')
      const existing = tintBySlot.get(sample.slot)
      if (existing !== undefined && existing !== key) {
        throw new Error(`${label} ${sample.slot} 同档底色不一致：${existing} / ${key}`)
      }
      tintBySlot.set(sample.slot, key)
    }

    const background = compositeOver(timeTint, tableColor)
    const timeColor = parseColor(sample.timeColor)
    if (timeColor === null) {
      throw new Error(`${label} 无法解析时间文字颜色：${sample.timeColor}`)
    }
    const ratio = contrastRatio(timeColor.rgb, background)
    if (ratio < 4.5) {
      throw new Error(`${label} ${sample.start} 时间文字对比不足：${ratio.toFixed(2)}`)
    }

    for (const neutral of sample.neutralBackgrounds) {
      const neutralColor = parseColor(neutral)
      if (neutralColor === null || neutralColor.alpha > 0.001) {
        throw new Error(`${label} ${sample.start} 非时间格不应有底色：${neutral}`)
      }
    }
  }

  if (tintEnabled && tintBySlot.size < minSlots) {
    throw new Error(`${label} 只覆盖 ${tintBySlot.size} 个时段，至少需要 ${minSlots}`)
  }
}

// 关闭底色后行悬停仍要生效：行拿到中性悬停底，时间格本身保持透明，
// 这样悬停时透出的是行底色，而不是一块空白。
async function assertSlotHoverNeutral(page, panel, label) {
  const row = panel.locator('tbody tr[data-slot]').first()
  // 先把指针移开，避免上一次操作残留的悬停影响基准值
  await page.mouse.move(0, 0)
  await page.waitForTimeout(120)
  const before = await row.evaluate((element) => getComputedStyle(element).backgroundColor)
  await row.hover()
  await page.waitForTimeout(120)
  const after = await row.evaluate((element) => getComputedStyle(element).backgroundColor)
  if (after === before) {
    throw new Error(`${label} 悬停时行底色没有变化：${before}`)
  }
  const timeBackground = await row
    .locator('td.time-cell')
    .evaluate((cell) => getComputedStyle(cell).backgroundColor)
  const timeTint = parseColor(timeBackground)
  if (timeTint === null || timeTint.alpha > 0.001) {
    throw new Error(`${label} 悬停时时间格不应叠色：${timeBackground}`)
  }
  await page.mouse.move(0, 0)
  await page.waitForTimeout(80)
}

// 通过设置面板切换「时段底色」，并等待 html 标记即时变化
async function setSlotTint(page, enabled) {
  await page.locator('.app-header-right button').first().click()
  await page.locator('.settings-modal').waitFor({ timeout: 5_000 })
  await page.locator('.settings-tab[data-tab="appearance"]').click()
  const toggle = page
    .locator('.settings-check', { hasText: '时段底色' })
    .locator('input[type="checkbox"]')
  await toggle.waitFor({ timeout: 5_000 })
  if ((await toggle.isChecked()) !== enabled) {
    await toggle.click()
  }
  await page.waitForFunction(
    (expected) => document.documentElement.dataset.slotTint === expected,
    enabled ? 'on' : 'off',
    { timeout: 5_000 },
  )
  await page.keyboard.press('Escape')
  await page.locator('.settings-modal').waitFor({ state: 'detached', timeout: 5_000 })
}

function relativeLuminance(rgb) {
  const channels = rgb.map((value) => {
    const channel = value / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(foreground, background) {
  const first = relativeLuminance(foreground)
  const second = relativeLuminance(background)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

async function main() {
  mkdirSync(shotDir, { recursive: true })
  await bundleHarness()
  console.log('harness 已打包到 out/harness')

  const { server, origin } = await startServer()
  let browser = null
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true })
  } catch (error) {
    console.error(`无法启动系统 Edge，跳过渲染 harness：${error.message}`)
    server.close()
    return 0
  }

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return
    }
    const text = message.text()
    // spendtime-audio 由 Electron 主进程注册，纯浏览器 harness 里加载必然失败
    if (text.includes('spendtime-audio') || text.includes('ERR_UNKNOWN_URL_SCHEME')) {
      return
    }
    pageErrors.push(text)
  })

  try {
    await page.goto(origin, { waitUntil: 'load' })
    const failures = await runFlows(page)

    // 零记录页面：验证「全部」不写死起点，并给出可解释的空状态
    const emptyPage = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await emptyPage.goto(`${origin}/?empty-records=1`, { waitUntil: 'load' })
      await emptyPage.waitForSelector('.app-title')
      const statsPanel = emptyPage.locator('.stats-panel')
      await clickStatsPreset(statsPanel, '全部')
      try {
        await emptyPage.waitForFunction(
          () =>
            (document.querySelector('.stats-panel .panel-head .badge')?.textContent ?? '').trim() ===
            '暂无记录',
          null,
          { timeout: 5_000 },
        )
      } catch {
        failures.push('全部空状态：范围徽标没有变成「暂无记录」')
      }
      const emptyText = (await statsPanel.locator('.empty').last().textContent())?.trim() ?? ''
      if (!emptyText.includes('还没有任何时间记录')) {
        failures.push(`全部空状态文案异常：${emptyText}`)
      }
      await statsPanel.screenshot({ path: join(shotDir, '39-stats-all-empty.png') })
    } finally {
      await emptyPage.close()
    }

    if (pageErrors.length > 0) {
      failures.push(`页面报错：${pageErrors.join(' | ')}`)
    }

    if (failures.length > 0) {
      console.error(`\n渲染 harness 失败 ${failures.length} 项：`)
      for (const failure of failures) {
        console.error(` - ${failure}`)
      }
      return 1
    }

    console.log(`\n渲染 harness 通过，截图在 out/harness/screenshots`)
    return 0
  } finally {
    await browser.close()
    server.close()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('渲染 harness 异常退出：', error)
    process.exit(1)
  })
