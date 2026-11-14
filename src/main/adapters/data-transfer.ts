import { dialog } from 'electron'
import { readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DataTransferPort, Logger } from '@application/ports'

const MAX_IMPORT_BYTES = 50 * 1024 * 1024

export function createDataTransferPort(logger: Logger): DataTransferPort {
  // 渲染层只拿到 token，真实路径留在主进程，避免任意路径读取
  const tokens = new Map<string, string>()

  async function saveText(defaultName: string, content: string): Promise<string | null> {
    const extension = extname(defaultName).slice(1) || 'txt'
    const result = await dialog.showSaveDialog({
      title: '保存文件',
      defaultPath: defaultName,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    })
    if (result.canceled || result.filePath === undefined) {
      return null
    }
    try {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(result.filePath, content, 'utf8')
      return result.filePath
    } catch (error) {
      logger.error('保存文件失败', error)
      return null
    }
  }

  async function pickImportFile(): Promise<{ token: string } | null> {
    const result = await dialog.showOpenDialog({
      title: '选择 SpendTime 导出文件',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    const path = result.filePaths[0]
    if (result.canceled || path === undefined) {
      return null
    }
    try {
      if (statSync(path).size > MAX_IMPORT_BYTES) {
        logger.error('导入文件超过 50 MB 限制')
        return null
      }
    } catch (error) {
      logger.error('读取导入文件失败', error)
      return null
    }
    const token = randomUUID()
    tokens.set(token, path)
    return { token }
  }

  function readImportFile(token: string): string | null {
    const path = tokens.get(token)
    if (path === undefined) {
      return null
    }
    try {
      return readFileSync(path, 'utf8')
    } catch (error) {
      logger.error('读取导入文件失败', error)
      return null
    }
  }

  return { saveText, pickImportFile, readImportFile }
}
