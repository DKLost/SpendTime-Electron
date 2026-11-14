import { describe, expect, it } from 'vitest'
import { computeGaps } from '@core/summary'

describe('computeGaps', () => {
  it('没有记录时返回整天空档', () => {
    expect(computeGaps([])).toEqual([{ startMin: 0, endMin: 1440 }])
  })

  it('按时间顺序返回记录之间的缝隙', () => {
    expect(
      computeGaps([
        { startMin: 130, endMin: 180 },
        { startMin: 750, endMin: 795 },
      ]),
    ).toEqual([
      { startMin: 0, endMin: 130 },
      { startMin: 180, endMin: 750 },
      { startMin: 795, endMin: 1440 },
    ])
  })

  it('重叠或相接的记录合并后再算空档', () => {
    expect(
      computeGaps([
        { startMin: 600, endMin: 700 },
        { startMin: 650, endMin: 720 },
        { startMin: 720, endMin: 800 },
      ]),
    ).toEqual([
      { startMin: 0, endMin: 600 },
      { startMin: 800, endMin: 1440 },
    ])
  })

  it('跨零点末段按 24:00 传入时不会再补出尾部空档', () => {
    expect(computeGaps([{ startMin: 1410, endMin: 1440 }])).toEqual([
      { startMin: 0, endMin: 1410 },
    ])
  })

  it('忽略越界与零长度区间', () => {
    expect(
      computeGaps([
        { startMin: -20, endMin: 30 },
        { startMin: 60, endMin: 60 },
        { startMin: 1430, endMin: 1500 },
      ]),
    ).toEqual([{ startMin: 30, endMin: 1430 }])
  })

  it('全天被覆盖时没有空档', () => {
    expect(computeGaps([{ startMin: 0, endMin: 1440 }])).toEqual([])
  })
})
