import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const sharedAlias = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        ...sharedAlias,
        '@core': resolve(__dirname, 'src/core'),
        '@application': resolve(__dirname, 'src/application'),
      },
    },
  },
  preload: {
    // preload 不开 externalize：sandbox 下只有 electron 可 require，其余依赖必须打进产物
    resolve: { alias: sharedAlias },
  },
  renderer: {
    resolve: {
      alias: {
        ...sharedAlias,
        '@core': resolve(__dirname, 'src/core'),
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    plugins: [react()],
  },
})
