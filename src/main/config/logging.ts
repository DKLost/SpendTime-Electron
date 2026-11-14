// 日志保留与体积上限：文件日志每天一个，超过保留天数的旧文件在启动与跨天时清理
export const LOG_RETENTION_DAYS = 14
export const LOG_MAX_BYTES = 2 * 1024 * 1024
export const LOG_FILE_PREFIX = 'main'
