import { describe, expect, it } from 'vitest'
import { isManagedRingtoneFileName, parseRingtoneFileName } from '../../src/main/adapters/ringtone-names'

const UUID = '6f9619ff-8b86-4d01-b42d-00cf4fc964ff'

describe('铃声协议白名单', () => {
  it('允许内置与 uuid 文件名', () => {
    expect(parseRingtoneFileName('spendtime-audio://ringtone/builtin-chime.wav')).toBe(
      'builtin-chime.wav',
    )
    expect(parseRingtoneFileName(`spendtime-audio://ringtone/${UUID}.mp3`)).toBe(`${UUID}.mp3`)
    expect(isManagedRingtoneFileName(`${UUID}.flac`)).toBe(true)
  })

  it('拒绝任意路径、旧文件名与错误 host', () => {
    expect(parseRingtoneFileName(`spendtime-audio://ringtone/../${UUID}.mp3`)).toBeNull()
    expect(parseRingtoneFileName(`spendtime-audio://ringtone/${UUID}%2f..%2fevil.mp3`)).toBeNull()
    expect(parseRingtoneFileName(`spendtime-audio://ringtone/${UUID}.mp3%00.png`)).toBeNull()
    expect(parseRingtoneFileName('spendtime-audio://ringtone/chime.wav')).toBeNull()
    expect(parseRingtoneFileName(`spendtime-audio://other/${UUID}.mp3`)).toBeNull()
    expect(parseRingtoneFileName('file:///C:/secret.mp3')).toBeNull()
  })

  it('拒绝非法扩展名与非 v4 uuid', () => {
    expect(parseRingtoneFileName('spendtime-audio://ringtone/6f9619ff-8b86-1d01-b42d-00cf4fc964ff.mp3')).toBeNull()
    expect(parseRingtoneFileName(`spendtime-audio://ringtone/${UUID}.exe`)).toBeNull()
  })
})
