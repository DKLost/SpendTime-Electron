// 时段行底色的归属规则：只看开始时刻，区间左闭右开。
// 起点正好落在分界线上时归入后一个时段，例如 18:00 属于傍晚而不是下午。
export type TimeSlotId =
  | 'night'
  | 'dawn'
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'evening'
  | 'late-night'

const SLOT_BOUNDARIES: readonly { readonly id: TimeSlotId; readonly startMin: number }[] = [
  { id: 'night', startMin: 0 },
  { id: 'dawn', startMin: 5 * 60 + 30 },
  { id: 'morning', startMin: 8 * 60 },
  { id: 'noon', startMin: 12 * 60 },
  { id: 'afternoon', startMin: 14 * 60 },
  { id: 'evening', startMin: 18 * 60 },
  { id: 'late-night', startMin: 21 * 60 + 30 },
]

export function timeSlotOf(startMin: number): TimeSlotId {
  let slot: TimeSlotId = 'night'
  for (const boundary of SLOT_BOUNDARIES) {
    if (startMin >= boundary.startMin) {
      slot = boundary.id
    }
  }
  return slot
}
