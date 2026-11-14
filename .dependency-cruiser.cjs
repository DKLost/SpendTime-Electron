/** 用依赖方向代替自觉：越靠近核心，允许的依赖越少 */
const path = require('node:path')

module.exports = {
  forbidden: [
    {
      name: 'core-is-pure',
      severity: 'error',
      comment: 'core 只能依赖自身：不 import electron/node/fs/react/sqlite',
      from: { path: '^src/core' },
      to: { pathNot: '^src/core' },
    },
    {
      name: 'application-no-infrastructure',
      severity: 'error',
      comment: 'application 只依赖 core 与自身，不碰 Electron / SQLite / 视图',
      from: { path: '^src/application' },
      to: { path: '^(src/(main|preload|renderer)|electron|better-sqlite3)' },
    },
    {
      name: 'shared-is-leaf',
      severity: 'error',
      comment: 'shared 只依赖 zod，避免与 core 形成环',
      from: { path: '^src/shared' },
      to: { path: '^(src/(core|application|main|preload|renderer)|electron|better-sqlite3)' },
    },
    {
      name: 'renderer-no-backend',
      severity: 'error',
      comment: '渲染进程不得直接引用主进程或应用层',
      from: { path: '^src/renderer' },
      to: { path: '^(src/(main|application)|electron|better-sqlite3)' },
    },
    {
      name: 'preload-no-backend',
      severity: 'error',
      comment: 'preload 只做桥接，不引用主进程、应用层与视图',
      from: { path: '^src/preload' },
      to: { path: '^(src/(main|application|renderer)|better-sqlite3)' },
    },
    {
      name: 'main-no-renderer',
      severity: 'error',
      comment: '主进程不得调用视图代码',
      from: { path: '^src/main' },
      to: { path: '^src/renderer' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: 'node_modules|\\.test\\.ts$' },
    tsPreCompilationDeps: true,
    moduleSystems: ['es6', 'cjs', 'tsd'],
    // 读取 tsconfig 的 paths，否则 @core / @shared 这类别名导入会被当作外部模块跳过检查
    tsConfig: { fileName: 'tsconfig.node.json' },
  },
}
