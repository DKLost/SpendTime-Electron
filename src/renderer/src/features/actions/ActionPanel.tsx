import { useState, type ChangeEvent, type FormEvent, type MouseEvent } from 'react'
import { formatDuration } from '@core/summary'
import type { ActionDto } from '@shared/contracts'
import type { ActionsState } from '../../state/use-actions'
import { formatDateTime } from '../../format-date'
import { t } from '../../translation'

type ActionPanelProps = {
  readonly state: ActionsState
}

export function ActionPanel(props: ActionPanelProps) {
  const { state } = props
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [messageTone, setMessageTone] = useState<'error' | 'info'>('error')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  function handleDraftChange(event: ChangeEvent<HTMLInputElement>): void {
    setDraft(event.target.value)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void submitDraft()
  }

  async function submitDraft(): Promise<void> {
    const error = await state.createAction(draft)
    if (error !== null) {
      showMessage(error, 'error')
      return
    }
    setDraft('')
    setMessage(null)
  }

  function handleEditClick(event: MouseEvent<HTMLButtonElement>): void {
    const actionId = Number(event.currentTarget.dataset.actionId)
    const action = state.actions.find((item) => item.id === actionId)
    if (action === undefined) {
      return
    }
    setEditingId(action.id)
    setEditDraft(action.name)
    setMessage(null)
  }

  function handleEditDraftChange(event: ChangeEvent<HTMLInputElement>): void {
    setEditDraft(event.target.value)
  }

  function handleReorderClick(event: MouseEvent<HTMLButtonElement>): void {
    const actionId = Number(event.currentTarget.dataset.actionId)
    const direction = event.currentTarget.dataset.direction === 'down' ? 'down' : 'up'
    void reorderById(actionId, direction)
  }

  async function reorderById(actionId: number, direction: 'up' | 'down'): Promise<void> {
    const error = await state.reorderAction(actionId, direction)
    if (error !== null) {
      showMessage(error, 'error')
    }
  }

  function handleSaveRename(event: MouseEvent<HTMLButtonElement>): void {
    void saveRename(Number(event.currentTarget.dataset.actionId))
  }

  async function saveRename(actionId: number): Promise<void> {
    const error = await state.renameAction(actionId, editDraft)
    if (error !== null) {
      showMessage(error, 'error')
      return
    }
    setEditingId(null)
    setMessage(null)
  }

  function handleCancelRename(): void {
    setEditingId(null)
    setMessage(null)
  }

  function handleArchiveClick(event: MouseEvent<HTMLButtonElement>): void {
    void archiveById(Number(event.currentTarget.dataset.actionId))
  }

  async function archiveById(actionId: number): Promise<void> {
    const action = state.actions.find((item) => item.id === actionId)
    if (action === undefined) {
      return
    }
    // 归档前先说明对计划与历史记录的影响，避免误操作
    const confirmed = window.confirm(t('actions.confirmArchive', { name: action.name }))
    if (!confirmed) {
      return
    }

    const result = await state.archiveAction(actionId)
    if (!result.ok) {
      showMessage(result.message, 'error')
      return
    }
    setEditingId(null)
    showMessage(
      t('actions.archivedInfo', {
        name: action.name,
        planCount: result.planCount,
        recordCount: result.recordCount,
      }),
      'info',
    )
  }

  function handleRestoreClick(event: MouseEvent<HTMLButtonElement>): void {
    void restoreById(Number(event.currentTarget.dataset.actionId))
  }

  async function restoreById(actionId: number): Promise<void> {
    const action = state.archived.find((item) => item.id === actionId)
    const error = await state.restoreAction(actionId)
    if (error !== null) {
      showMessage(error, 'error')
      return
    }
    showMessage(t('actions.restored', { name: action?.name ?? '' }), 'info')
  }

  function handleDeleteClick(event: MouseEvent<HTMLButtonElement>): void {
    void deleteById(Number(event.currentTarget.dataset.actionId))
  }

  async function deleteById(actionId: number): Promise<void> {
    const action = [...state.actions, ...state.archived].find((item) => item.id === actionId)
    if (action === undefined) {
      return
    }
    if (!window.confirm(t('actions.confirmDelete', { name: action.name }))) {
      return
    }
    const result = await state.removeAction(actionId)
    if (!result.ok) {
      showMessage(result.message, 'error')
      return
    }
    setEditingId(null)
    showMessage(t('actions.deleted', { name: action.name }), 'info')
  }

  function showMessage(text: string, tone: 'error' | 'info'): void {
    setMessage(text)
    setMessageTone(tone)
  }

  function toggleArchivedView(): void {
    setEditingId(null)
    setMessage(null)
    setShowArchived((visible) => !visible)
  }

  function renderActionItem(action: ActionDto) {
    if (action.id === editingId) {
      return (
        <li key={action.id} className="action-item action-item-editing">
          <span className="action-id">#{action.id}</span>
          <input
            className="action-edit-input"
            type="text"
            value={editDraft}
            aria-label={t('actions.nameAria')}
            onChange={handleEditDraftChange}
          />
          <button type="button" className="primary" data-action-id={action.id} onClick={handleSaveRename}>
            {t('common.save')}
          </button>
          <button type="button" className="ghost" onClick={handleCancelRename}>
            {t('common.cancel')}
          </button>
        </li>
      )
    }

    return (
      <li key={action.id} className="action-item">
        <span className="action-id">#{action.id}</span>
        <span className="action-name">{action.name}</span>
        <span className="action-total mono" title={t('actions.totalAria')}>
          {formatDuration(state.totals[action.id] ?? 0)}
        </span>
        <button
          type="button"
          className="icon"
          data-action-id={action.id}
          data-direction="up"
          onClick={handleReorderClick}
          aria-label={t('actions.moveUp')}
        >
          ↑
        </button>
        <button
          type="button"
          className="icon"
          data-action-id={action.id}
          data-direction="down"
          onClick={handleReorderClick}
          aria-label={t('actions.moveDown')}
        >
          ↓
        </button>
        <button type="button" className="icon" data-action-id={action.id} onClick={handleEditClick}>
          {t('common.edit')}
        </button>
        <button type="button" className="icon" data-action-id={action.id} onClick={handleArchiveClick}>
          {t('common.archive')}
        </button>
        <button type="button" className="icon icon-danger" data-action-id={action.id} onClick={handleDeleteClick}>
          {t('common.delete')}
        </button>
      </li>
    )
  }

  function renderArchivedItem(action: ActionDto) {
    return (
      <li key={action.id} className="action-item action-item-archived">
        <span className="action-id">#{action.id}</span>
        <span className="action-name">{action.name}</span>
        <span className="action-total mono">{formatDuration(state.totals[action.id] ?? 0)}</span>
        <span className="action-archived-at">{formatDateTime(action.archivedAt)}</span>
        <button type="button" className="icon" data-action-id={action.id} onClick={handleRestoreClick}>
          {t('common.restore')}
        </button>
        <button type="button" className="icon icon-danger" data-action-id={action.id} onClick={handleDeleteClick}>
          {t('common.delete')}
        </button>
      </li>
    )
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('actions.title')}</h2>
        <div className="panel-head-actions">
          <span className="badge">
            {showArchived
              ? t('actions.archivedCount', { count: state.archived.length })
              : t('actions.count', { count: state.actions.length })}
          </span>
          <button type="button" className="icon" onClick={toggleArchivedView}>
            {showArchived ? t('common.back') : t('actions.viewArchived', { count: state.archived.length })}
          </button>
        </div>
      </div>

      {showArchived ? (
        <ul className="action-list">
          {state.archived.map(renderArchivedItem)}
          {state.archived.length === 0 ? <li className="empty">{t('actions.archivedEmpty')}</li> : null}
        </ul>
      ) : (
        <ul className="action-list">
          {state.actions.map(renderActionItem)}
          {state.actions.length === 0 ? <li className="empty">{t('actions.empty')}</li> : null}
        </ul>
      )}

      {showArchived ? null : (
        <form className="actions" onSubmit={handleSubmit}>
          <input type="text" placeholder={t('actions.placeholder')} value={draft} onChange={handleDraftChange} />
          <button type="submit" className="primary">
            {t('common.add')}
          </button>
        </form>
      )}

      {message === null ? null : (
        <p className={messageTone === 'error' ? 'message' : 'message message-info'}>{message}</p>
      )}
    </section>
  )
}
