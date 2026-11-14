import { useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from 'react'
import type { ActionDto, CustomRingtoneDto, StagedRingtoneDto } from '@shared/contracts'
import {
  RINGTONE_IDS,
  isBuiltinRingtone,
  resolveRingtone,
  type BuiltinRingtoneId,
  type RingtoneChoice,
  type RingtoneId,
} from '../../state/ringtone-types'
import type { RingtonesState } from '../../state/use-ringtones'
import { t, type TranslationKey } from '../../translation'
import { playRingtone, stopRingtone } from './play-ringtone'
import { RingtoneTrimEditor } from './RingtoneTrimEditor'

type RingtonePanelProps = {
  readonly actions: readonly ActionDto[]
  readonly state: RingtonesState
}

type Kind = 'start' | 'end'

// 截取区间与主进程校验保持一致
const TRIM_MIN_SEC = 0.1
const TRIM_MAX_SEC = 60

const KIND_LABEL_KEYS: readonly { readonly kind: Kind; readonly labelKey: TranslationKey }[] = [
  { kind: 'start', labelKey: 'ringtone.start' },
  { kind: 'end', labelKey: 'ringtone.end' },
]

const BUILTIN_LABEL_KEYS: Readonly<Record<BuiltinRingtoneId, TranslationKey>> = {
  chime: 'ringtone.chime',
  bell: 'ringtone.bell',
  pulse: 'ringtone.pulse',
}

export function RingtonePanel(props: RingtonePanelProps) {
  const { actions, state } = props
  const [message, setMessage] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [staged, setStaged] = useState<StagedRingtoneDto | null>(null)
  const [editing, setEditing] = useState<CustomRingtoneDto | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  function handleDefaultChange(event: ChangeEvent<HTMLSelectElement>): void {
    const kind: Kind = event.currentTarget.dataset.kind === 'end' ? 'end' : 'start'
    void saveDefault(kind, event.currentTarget.value as RingtoneId)
  }

  async function saveDefault(kind: Kind, value: RingtoneId): Promise<void> {
    setMessage(await state.setDefault(kind, value))
  }

  function handleActionChange(event: ChangeEvent<HTMLSelectElement>): void {
    const actionId = Number(event.currentTarget.dataset.actionId)
    const kind: Kind = event.currentTarget.dataset.kind === 'end' ? 'end' : 'start'
    void saveAction(actionId, kind, event.currentTarget.value as RingtoneChoice)
  }

  async function saveAction(actionId: number, kind: Kind, value: RingtoneChoice): Promise<void> {
    setMessage(await state.setAction(actionId, kind, value))
  }

  function handlePreviewClick(event: MouseEvent<HTMLButtonElement>): void {
    const value = event.currentTarget.dataset.ringtone
    if (value !== undefined && value !== 'none') {
      playRingtone(value as RingtoneId, customFiles())
    }
  }

  async function handleImportClick(): Promise<void> {
    setEditing(null)
    setImporting(true)
    const result = await state.pickRingtone()
    setImporting(false)
    if (result.error !== null) {
      setMessage(result.error)
      return
    }
    if (result.staged === null) {
      return
    }
    setStaged(result.staged)
    setMessage(null)
  }

  async function handleTrimCancel(): Promise<void> {
    if (staged === null) {
      return
    }
    const token = staged.token
    setStaged(null)
    setMessage(null)
    await state.cancelRingtone(token)
  }

  async function handleTrimConfirm(startSec: number, endSec: number): Promise<void> {
    if (staged === null) {
      return
    }
    setSaving(true)
    const result = await state.commitRingtone(staged.token, startSec, endSec)
    setSaving(false)
    if (result.error !== null) {
      setMessage(result.error)
      return
    }
    setStaged(null)
    setMessage(t('ringtone.imported'))
  }

  function handleEditStart(event: MouseEvent<HTMLButtonElement>): void {
    const id = event.currentTarget.dataset.ringtoneId
    const ringtone = state.custom.find((item) => item.id === id)
    if (ringtone === undefined) {
      return
    }
    stopRingtone()
    setStaged(null)
    setEditing(ringtone)
    setMessage(null)
  }

  function handleEditCancel(): void {
    setEditing(null)
    setMessage(null)
  }

  async function handleEditConfirm(startSec: number, endSec: number): Promise<void> {
    if (editing === null) {
      return
    }
    setSaving(true)
    const error = await state.updateClip(editing.id, startSec, endSec)
    setSaving(false)
    if (error !== null) {
      setMessage(error)
      return
    }
    setEditing(null)
    setMessage(t('ringtone.updated'))
  }

  function handleRenameStart(event: MouseEvent<HTMLButtonElement>): void {
    const id = event.currentTarget.dataset.ringtoneId
    const ringtone = state.custom.find((item) => item.id === id)
    if (ringtone === undefined) {
      return
    }
    setEditingId(ringtone.id)
    setRenameDraft(ringtone.name)
    setMessage(null)
  }

  async function handleRenameSave(): Promise<void> {
    if (editingId === null) {
      return
    }
    const error = await state.renameRingtone(editingId, renameDraft)
    if (error !== null) {
      setMessage(error)
      return
    }
    setEditingId(null)
    setMessage(null)
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      void handleRenameSave()
    } else if (event.key === 'Escape') {
      setEditingId(null)
    }
  }

  async function handleRemoveClick(event: MouseEvent<HTMLButtonElement>): Promise<void> {
    const id = event.currentTarget.dataset.ringtoneId
    const ringtone = state.custom.find((item) => item.id === id)
    if (ringtone === undefined) {
      return
    }
    if (!window.confirm(t('ringtone.deleteConfirm', { name: ringtone.name, usage: usageText(ringtone) }))) {
      return
    }
    const result = await state.removeRingtone(ringtone.id)
    if (editing?.id === ringtone.id) {
      setEditing(null)
    }
    if (result.error !== null) {
      setMessage(result.error)
      return
    }
    const cleared = result.affectedActions + result.clearedDefaults
    setMessage(cleared > 0 ? t('ringtone.deletedWithRefs', { count: cleared }) : t('ringtone.deleted'))
  }

  function customFiles() {
    return state.custom.map((ringtone) => ({
      id: ringtone.id,
      fileName: ringtone.fileName,
      clipStartSec: ringtone.clipStartSec,
      clipEndSec: ringtone.clipEndSec,
    }))
  }

  function usageText(ringtone: CustomRingtoneDto): string {
    const parts: string[] = []
    for (const usage of ringtone.usedBy) {
      parts.push(`${usage.actionName}·${t(usage.kind === 'start' ? 'ringtone.start' : 'ringtone.end')}`)
    }
    for (const kind of ringtone.usedByDefault) {
      parts.push(`${t('ringtone.default')}·${t(kind === 'start' ? 'ringtone.start' : 'ringtone.end')}`)
    }
    return parts.length === 0 ? t('ringtone.unused') : parts.join(t('common.listSeparator'))
  }

  function renderDefaultOptions() {
    return (
      <>
        {RINGTONE_IDS.map(renderBuiltinOption)}
        {renderCustomOptions()}
        <option value="none">{t('ringtone.none')}</option>
      </>
    )
  }

  function defaultLabel(value: RingtoneId): string {
    if (isBuiltinRingtone(value)) {
      return t(BUILTIN_LABEL_KEYS[value])
    }
    if (value === 'none') {
      return t('ringtone.none')
    }
    const id = value.replace('custom:', '')
    return state.custom.find((item) => item.id === id)?.name ?? t('ringtone.customTitle')
  }

  function renderChoiceOptions(defaultId: RingtoneId) {
    return (
      <>
        <option value="inherit">{t('ringtone.inherit', { name: defaultLabel(defaultId) })}</option>
        {RINGTONE_IDS.map(renderBuiltinOption)}
        {renderCustomOptions()}
        <option value="none">{t('ringtone.none')}</option>
      </>
    )
  }

  function renderCustomOptions() {
    return state.custom.map((ringtone) => (
      <option key={ringtone.id} value={`custom:${ringtone.id}`}>
        {ringtone.name}
      </option>
    ))
  }

  function renderActionItem(action: ActionDto) {
    return (
      <li key={action.id} className="ringtone-item">
        <span className="ringtone-action">{action.name}</span>
        {KIND_LABEL_KEYS.map((entry) => renderActionControl(action, entry.kind))}
      </li>
    )
  }

  function renderActionControl(action: ActionDto, kind: Kind) {
    const value = kind === 'start' ? action.startRingtone : action.endRingtone
    const effective = resolveRingtone(
      value ?? null,
      kind === 'start' ? state.defaultStart : state.defaultEnd,
    )
    const ariaKey: TranslationKey =
      kind === 'start' ? 'ringtone.actionStartAria' : 'ringtone.actionEndAria'
    return (
      <span className="ringtone-control" key={kind}>
        <select
          className="ringtone-select"
          value={value ?? 'inherit'}
          data-action-id={action.id}
          data-kind={kind}
          aria-label={t(ariaKey, { name: action.name })}
          onChange={handleActionChange}
        >
          {renderChoiceOptions(kind === 'start' ? state.defaultStart : state.defaultEnd)}
        </select>
        {renderPreviewButton(effective, `${action.name}-${kind}`)}
      </span>
    )
  }

  function renderPreviewButton(value: RingtoneId | null, key: string) {
    return (
      <button
        key={key}
        type="button"
        className="icon"
        data-ringtone={value ?? ''}
        onClick={handlePreviewClick}
        disabled={value === null || value === 'none'}
      >
        {t('ringtone.preview')}
      </button>
    )
  }

  function renderCustomItem(ringtone: CustomRingtoneDto) {
    const used = ringtone.usedBy.length + ringtone.usedByDefault.length > 0
    const editing = editingId === ringtone.id
    return (
      <li key={ringtone.id} className="ringtone-custom-item">
        <span className="ringtone-custom-main">
          {editing ? (
            <input
              className="ringtone-rename"
              value={renameDraft}
              maxLength={40}
              autoFocus
              onChange={(event) => setRenameDraft(event.currentTarget.value)}
              onKeyDown={handleRenameKeyDown}
              aria-label={t('ringtone.rename')}
            />
          ) : (
            <span className="ringtone-custom-name">{ringtone.name}</span>
          )}
          <span className={used ? 'ringtone-usage used' : 'ringtone-usage'}>
            {usageText(ringtone)}
          </span>
        </span>
        <span className="ringtone-custom-meta mono">{formatSeconds(clipLength(ringtone))}</span>
        <span className="ringtone-control">
          {renderPreviewButton(`custom:${ringtone.id}`, `custom-${ringtone.id}`)}
          <button
            type="button"
            className="icon"
            data-ringtone-id={ringtone.id}
            onClick={handleEditStart}
            disabled={staged !== null || saving}
          >
            {t('ringtone.reslice')}
          </button>
          {editing ? (
            <button type="button" className="primary compact" onClick={() => void handleRenameSave()}>
              {t('ringtone.renameSave')}
            </button>
          ) : (
            <button
              type="button"
              className="icon"
              data-ringtone-id={ringtone.id}
              onClick={handleRenameStart}
            >
              {t('ringtone.rename')}
            </button>
          )}
          <button
            type="button"
            className="icon"
            data-ringtone-id={ringtone.id}
            onClick={(event) => void handleRemoveClick(event)}
          >
            {t('ringtone.delete')}
          </button>
        </span>
      </li>
    )
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('ringtone.title')}</h2>
        <span className="badge">{t('ringtone.default')}</span>
      </div>

      <div className="ringtone-defaults">
        {KIND_LABEL_KEYS.map((entry) => renderDefaultControl(entry.kind, entry.labelKey))}
      </div>

      <div className="ringtone-custom-head">
        <h3 className="ringtone-subhead">{t('ringtone.customTitle')}</h3>
        <button
          type="button"
          className="ghost compact"
          onClick={() => void handleImportClick()}
          disabled={importing || staged !== null || editing !== null}
        >
          {importing ? t('ringtone.importing') : t('ringtone.import')}
        </button>
      </div>

      {staged === null ? null : (
        <RingtoneTrimEditor
          key={staged.token}
          source={{
            fileName: staged.pendingFileName,
            name: staged.suggestedName,
            durationSec: staged.durationSec,
          }}
          initialRange={{
            start: 0,
            end: Math.min(TRIM_MAX_SEC, Math.max(TRIM_MIN_SEC, staged.durationSec)),
          }}
          busy={saving}
          onCancel={() => void handleTrimCancel()}
          onConfirm={(startSec, endSec) => void handleTrimConfirm(startSec, endSec)}
        />
      )}

      {editing === null ? null : (
        <RingtoneTrimEditor
          key={editing.id}
          source={{
            fileName: editing.fileName,
            name: editing.name,
            durationSec: editing.durationSec,
          }}
          initialRange={{
            start: editing.clipStartSec,
            end: Math.min(
              editing.clipEndSec ?? editing.durationSec,
              editing.clipStartSec + TRIM_MAX_SEC,
            ),
          }}
          busy={saving}
          onCancel={handleEditCancel}
          onConfirm={(startSec, endSec) => void handleEditConfirm(startSec, endSec)}
        />
      )}

      <p className="hint">{t('ringtone.customHint')}</p>
      {state.custom.length === 0 ? (
        <p className="hint">{t('ringtone.customEmpty')}</p>
      ) : (
        <ul className="ringtone-custom-list">{state.custom.map(renderCustomItem)}</ul>
      )}

      <h3 className="ringtone-subhead">{t('ringtone.perAction')}</h3>
      {actions.length === 0 ? (
        <p className="hint">{t('ringtone.empty')}</p>
      ) : (
        <ul className="ringtone-list">{actions.map(renderActionItem)}</ul>
      )}

      <p className="hint ringtone-hint">{t('ringtone.hint')}</p>

      {message === null ? null : <p className="message">{message}</p>}
    </section>
  )

  function renderDefaultControl(kind: Kind, labelKey: TranslationKey) {
    const value = kind === 'start' ? state.defaultStart : state.defaultEnd
    const ariaKey: TranslationKey = kind === 'start' ? 'ringtone.startAria' : 'ringtone.endAria'
    return (
      <label className="field" key={kind}>
        <span className="label">{t(labelKey)}</span>
        <span className="ringtone-control">
          <select
            value={value}
            data-kind={kind}
            aria-label={t(ariaKey)}
            onChange={handleDefaultChange}
          >
            {renderDefaultOptions()}
          </select>
          {renderPreviewButton(value, `${kind}-default`)}
        </span>
      </label>
    )
  }
}

function renderBuiltinOption(id: BuiltinRingtoneId) {
  return (
    <option key={id} value={id}>
      {t(BUILTIN_LABEL_KEYS[id])}
    </option>
  )
}

function formatSeconds(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

// 列表展示实际使用长度；旧数据没有区间，等价于整段
function clipLength(ringtone: CustomRingtoneDto): number {
  const end = ringtone.clipEndSec ?? ringtone.durationSec
  return Math.max(1, Math.round(end - ringtone.clipStartSec))
}
