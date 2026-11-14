import type { RingtoneValue } from './ringtone'
import type { ActionId, EpochMs } from './types'

export type { RingtoneValue }

export type Action = {
  readonly id: ActionId
  readonly name: string
  readonly archived: boolean
  readonly createdAt: EpochMs
  // 归档时间；旧数据归档时为未知，恢复后清空
  readonly archivedAt: EpochMs | null
  // 每个行动记住自己的倒计时目标；null 表示正计时
  readonly timerTargetSec: number | null
  // null 表示跟随全局默认铃声；'none' 表示该行动不播放
  readonly startRingtone: RingtoneValue | null
  readonly endRingtone: RingtoneValue | null
  // 行动在手写列表中的顺序，旧数据按创建顺序回填
  readonly sortOrder: number
}
