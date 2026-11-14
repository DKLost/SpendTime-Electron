import { DEFAULT_TIMER_POLICY, type TimerPolicy } from '@core/timer'

export const APP_NAME = 'SpendTime'
export const DEV_APP_NAME = 'SpendTime-Dev'
export const APP_USER_MODEL_ID = 'com.spendtime.app'

// 方案文档 §9 的 6 个待确认口径先按建议默认值落地，集中在此处便于后续单项修改
export type CloseBehavior = 'hide-to-tray' | 'quit'
export const CLOSE_BEHAVIOR: CloseBehavior = 'hide-to-tray' // 接托盘后按方案建议改为隐藏；退出统一走托盘菜单
export const START_AT_LOGIN = false // 方案建议首次询问，P4 补询问流程前保持关闭
export const TIMER_POLICY: TimerPolicy = DEFAULT_TIMER_POLICY // 不足 60 秒也落库 + 跨零点按自然日切分
export const DELETE_STRATEGY = 'archive' // 删除行动默认归档，保留历史记录
export const PACKAGING_TARGETS = ['nsis', 'portable'] // 安装版 + 免安装版
