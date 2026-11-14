import { useEffect, useState, type ChangeEvent, type MouseEvent, type PointerEvent } from 'react'
import type { ActionDto, BackupEntryDto, ExportCountsDto } from '@shared/contracts'
import type { SettingsState } from '../../state/use-settings'
import type { RingtonesState } from '../../state/use-ringtones'
import { formatDateTimeWithSeconds } from '../../format-date'
import { apiErrorText, LOCALE_IDS, t, type LocaleId, type TranslationKey } from '../../translation'
import { RingtonePanel } from '../ringtones/RingtonePanel'

type TabId = 'general' | 'reminder' | 'ringtones' | 'data' | 'appearance'

type SettingsModalProps = {
  readonly open: boolean
  readonly onClose: () => void
  readonly settings: SettingsState
  readonly actions: readonly ActionDto[]
  readonly ringtones: RingtonesState
}

const TABS: readonly { readonly id: TabId; readonly labelKey: 'settings.tabGeneral' | 'settings.tabReminder' | 'settings.tabRingtones' | 'settings.tabData' | 'settings.tabAppearance' }[] = [
  { id: 'general', labelKey: 'settings.tabGeneral' },
  { id: 'reminder', labelKey: 'settings.tabReminder' },
  { id: 'ringtones', labelKey: 'settings.tabRingtones' },
  { id: 'data', labelKey: 'settings.tabData' },
  { id: 'appearance', labelKey: 'settings.tabAppearance' },
]

// 语言名用各自母语展示，切换时不需要先认识当前界面语言
const LOCALE_LABEL_KEYS: Readonly<Record<LocaleId, TranslationKey>> = {
  zh: 'locale.zh',
  en: 'locale.en',
  ja: 'locale.ja',
}

export function SettingsModal(props: SettingsModalProps) {
  const { open, onClose, settings, actions, ringtones } = props
  const [tab, setTab] = useState<TabId>('general')
  const [message, setMessage] = useState<string | null>(null)
  const [shortcutDraft, setShortcutDraft] = useState('')
  const [loopDraft, setLoopDraft] = useState('')
  const [retainDraft, setRetainDraft] = useState('')
  const [backups, setBackups] = useState<readonly BackupEntryDto[]>([])
  const [backupDir, setBackupDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [importPreview, setImportPreview] = useState<{
    readonly token: string
    readonly counts: ExportCountsDto
    readonly warnings: readonly string[]
  } | null>(null)
  const current = settings.snapshot?.settings

  useEffect(
    function syncDrafts() {
      setShortcutDraft(current?.shortcut ?? '')
      setLoopDraft(current === undefined ? '' : String(current.alarmLoopMaxSec))
      setRetainDraft(current === undefined ? '' : String(current.backupRetain))
    },
    [current?.shortcut, current?.alarmLoopMaxSec, current?.backupRetain, current === undefined],
  )

  useEffect(
    function loadBackupsOnDataTab() {
      if (!open || tab !== 'data') {
        return
      }
      void refreshBackups()
    },
    [open, tab],
  )

  useEffect(
    function closeOnEscape() {
      if (!open) {
        return
      }
      function handleKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
          onClose()
        }
      }
      window.addEventListener('keydown', handleKeyDown)
      return function removeListener(): void {
        window.removeEventListener('keydown', handleKeyDown)
      }
    },
    [open, onClose],
  )

  useEffect(
    function resetOnOpen() {
      if (open) {
        setMessage(null)
      }
    },
    [open],
  )

  if (!open) {
    return null
  }

  function handleBackdropPointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  function handleTabClick(event: MouseEvent<HTMLButtonElement>): void {
    const next = event.currentTarget.dataset.tab as TabId | undefined
    if (next !== undefined) {
      setTab(next)
      setMessage(null)
    }
  }

  async function save(patch: Parameters<SettingsState['update']>[0]): Promise<boolean> {
    const error = await settings.update(patch)
    setMessage(error)
    return error === null
  }

  function handleCloseBehaviorChange(event: ChangeEvent<HTMLSelectElement>): void {
    void save({ closeBehavior: event.currentTarget.value as 'hide-to-tray' | 'quit' })
  }

  function handleStartAtLoginChange(event: ChangeEvent<HTMLInputElement>): void {
    void save({ startAtLogin: event.currentTarget.checked })
  }

  function handleSoundChange(event: ChangeEvent<HTMLInputElement>): void {
    void save({ soundEnabled: event.currentTarget.checked })
  }

  function handleDensityChange(event: ChangeEvent<HTMLSelectElement>): void {
    void save({ density: event.currentTarget.value as 'compact' | 'comfortable' })
  }

  function handleLocaleChange(event: ChangeEvent<HTMLSelectElement>): void {
    void save({ locale: event.currentTarget.value as LocaleId })
  }

  function handleSlotTintChange(event: ChangeEvent<HTMLInputElement>): void {
    void save({ slotTintEnabled: event.currentTarget.checked })
  }

  async function saveShortcut(): Promise<void> {
    const value = shortcutDraft.trim()
    const ok = await save({ shortcut: value === '' ? null : value })
    if (ok) {
      setMessage(t('settings.saved'))
    }
  }

  async function saveLoopLimit(): Promise<void> {
    const value = Number(loopDraft)
    const ok = await save({ alarmLoopMaxSec: value })
    if (ok) {
      setMessage(t('settings.saved'))
    }
  }

  async function openDirectory(kind: 'data' | 'logs'): Promise<void> {
    const response = await window.spendTime.invoke(
      kind === 'data' ? 'app.openDataDir' : 'app.openLogDir',
      {},
    )
    if (!response.ok) {
      setMessage(apiErrorText(response.error))
      return
    }
    if (!response.value.opened) {
      setMessage(t('settings.openDirFailed'))
      return
    }
    setMessage(null)
  }

  async function saveRetainLimit(): Promise<void> {
    const value = Number(retainDraft)
    const ok = await save({ backupRetain: value })
    if (ok) {
      setMessage(t('settings.saved'))
      await refreshBackups()
    }
  }

  async function refreshBackups(): Promise<void> {
    const response = await window.spendTime.invoke('backup.list', {})
    if (!response.ok) {
      setMessage(apiErrorText(response.error))
      return
    }
    setBackups(response.value.backups)
    setBackupDir(response.value.dir)
  }

  async function createBackupNow(): Promise<void> {
    setBusy(true)
    const response = await window.spendTime.invoke('backup.create', {})
    setBusy(false)
    if (!response.ok) {
      setMessage(apiErrorText(response.error))
      return
    }
    setMessage(response.value.created ? t('settings.backupCreated') : t('settings.backupFailed'))
    await refreshBackups()
  }

  async function restoreBackup(name: string): Promise<void> {
    if (!window.confirm(t('settings.restoreConfirm', { name }))) {
      return
    }
    setBusy(true)
    const response = await window.spendTime.invoke('backup.restore', { name })
    setBusy(false)
    if (!response.ok) {
      setMessage(apiErrorText(response.error))
      return
    }
    setMessage(t('settings.restoring'))
  }

  async function exportJson(): Promise<void> {
    setBusy(true)
    const response = await window.spendTime.invoke('data.export', {})
    setBusy(false)
    if (!response.ok) {
      setMessage(apiErrorText(response.error))
      return
    }
    setMessage(
      response.value.saved
        ? t('settings.exported', { path: response.value.path ?? '' })
        : t('settings.exportCanceled'),
    )
  }

  async function pickImportFile(): Promise<void> {
    setBusy(true)
    const response = await window.spendTime.invoke('data.inspectImport', {})
    setBusy(false)
    if (!response.ok) {
      setMessage(apiErrorText(response.error))
      return
    }
    if (response.value.canceled || response.value.token === null || response.value.counts === null) {
      setImportPreview(null)
      setMessage(t('settings.importCanceled'))
      return
    }
    setImportPreview({
      token: response.value.token,
      counts: response.value.counts,
      warnings: response.value.warnings,
    })
    setMessage(null)
  }

  async function confirmImport(): Promise<void> {
    if (importPreview === null) {
      return
    }
    setBusy(true)
    const response = await window.spendTime.invoke('data.import', { token: importPreview.token })
    setBusy(false)
    if (!response.ok) {
      setMessage(apiErrorText(response.error))
      return
    }
    setImportPreview(null)
    setMessage(t('settings.importDone'))
    await refreshBackups()
  }

  function renderLocaleOption(locale: LocaleId) {
    return (
      <option key={locale} value={locale}>
        {t(LOCALE_LABEL_KEYS[locale])}
      </option>
    )
  }

  function renderGeneralTab() {
    if (current === undefined) {
      return <p className="hint">{t('settings.loading')}</p>
    }
    return (
      <div className="settings-form">
        <label className="field">
          <span className="label">{t('settings.locale')}</span>
          <select value={current.locale} onChange={handleLocaleChange}>
            {LOCALE_IDS.map(renderLocaleOption)}
          </select>
          <span className="hint">{t('settings.localeHint')}</span>
        </label>

        <label className="field">
          <span className="label">{t('settings.closeBehavior')}</span>
          <select value={current.closeBehavior} onChange={handleCloseBehaviorChange}>
            <option value="hide-to-tray">{t('settings.hideToTray')}</option>
            <option value="quit">{t('settings.quitApp')}</option>
          </select>
          <span className="hint">{t('settings.closeBehaviorHint')}</span>
        </label>

        <label className="settings-check">
          <input type="checkbox" checked={current.startAtLogin} onChange={handleStartAtLoginChange} />
          <span>{t('settings.startAtLogin')}</span>
        </label>

        <div className="settings-inline">
          <label className="field">
            <span className="label">{t('settings.shortcut')}</span>
            <input
              type="text"
              value={shortcutDraft}
              placeholder={t('settings.shortcutPlaceholder')}
              onChange={(event) => setShortcutDraft(event.currentTarget.value)}
            />
          </label>
          <button type="button" className="primary" onClick={() => void saveShortcut()}>
            {t('common.save')}
          </button>
        </div>
        <p className="hint">{t('settings.shortcutHint')}</p>

        <div className="settings-dirs">
          <button type="button" className="ghost compact" onClick={() => void openDirectory('data')}>
            {t('settings.openDataDir')}
          </button>
          <button type="button" className="ghost compact" onClick={() => void openDirectory('logs')}>
            {t('settings.openLogDir')}
          </button>
          <span className="settings-dir-text mono">{settings.snapshot?.dataDir}</span>
        </div>
      </div>
    )
  }

  function renderReminderTab() {
    if (current === undefined) {
      return <p className="hint">{t('settings.loading')}</p>
    }
    return (
      <div className="settings-form">
        <label className="settings-check">
          <input type="checkbox" checked={current.soundEnabled} onChange={handleSoundChange} />
          <span>{t('settings.soundEnabled')}</span>
        </label>
        <p className="hint">{t('settings.soundHint')}</p>

        <div className="settings-inline">
          <label className="field field-narrow">
            <span className="label">{t('settings.loopMax')}</span>
            <input
              type="number"
              min={30}
              max={120}
              step={5}
              value={loopDraft}
              onChange={(event) => setLoopDraft(event.currentTarget.value)}
            />
          </label>
          <button type="button" className="primary" onClick={() => void saveLoopLimit()}>
            {t('common.save')}
          </button>
        </div>
        <p className="hint">{t('settings.loopMaxHint')}</p>
      </div>
    )
  }

  function renderRingtonesTab() {
    return (
      <div className="settings-ringtones">
        <RingtonePanel actions={actions} state={ringtones} />
      </div>
    )
  }

  async function exportDiagnostics(): Promise<void> {
    setBusy(true)
    const response = await window.spendTime.invoke('app.exportDiagnostics', {})
    setBusy(false)
    if (!response.ok) {
      setMessage(apiErrorText(response.error))
      return
    }
    setMessage(
      response.value.exported
        ? t('settings.diagnosticsExported', { path: response.value.path ?? '' })
        : t('settings.diagnosticsFailed'),
    )
  }

  async function openCrashDir(): Promise<void> {
    const response = await window.spendTime.invoke('app.openCrashDir', {})
    if (!response.ok) {
      setMessage(apiErrorText(response.error))
      return
    }
    if (!response.value.opened) {
      setMessage(t('settings.openDirFailed'))
      return
    }
    setMessage(null)
  }

  function renderImportPreview() {
    if (importPreview === null) {
      return null
    }
    const { counts, warnings } = importPreview
    return (
      <div className="settings-import-preview">
        <p className="hint">
          {t('settings.importPreview', {
            actions: counts.actions,
            plans: counts.plans,
            records: counts.records,
            todos: counts.todos,
          })}
        </p>
        {warnings.length === 0 ? null : (
          <p className="message">
            {t('settings.importWarnings', { warnings: warnings.join(t('common.clauseSeparator')) })}
          </p>
        )}
        <button type="button" className="primary compact" disabled={busy} onClick={() => void confirmImport()}>
          {t('settings.importConfirm')}
        </button>
      </div>
    )
  }

  function renderBackupRow(entry: BackupEntryDto) {
    const created = formatDateTimeWithSeconds(entry.createdAt)
    const sizeKb = Math.max(1, Math.round(entry.sizeBytes / 1024))
    return (
      <li key={entry.name} className="settings-backup-row">
        <span className="mono settings-backup-name" title={entry.name}>
          {created}
        </span>
        <span className="mono settings-backup-size">{sizeKb} KB</span>
        <button
          type="button"
          className="ghost compact"
          disabled={busy}
          onClick={() => void restoreBackup(entry.name)}
        >
          {t('settings.restore')}
        </button>
      </li>
    )
  }

  function renderDataTab() {
    return (
      <div className="settings-form">
        <div className="settings-dirs">
          <button type="button" className="ghost compact" onClick={() => void openDirectory('data')}>
            {t('settings.openDataDir')}
          </button>
          <button type="button" className="ghost compact" onClick={() => void openDirectory('logs')}>
            {t('settings.openLogDir')}
          </button>
        </div>

        <h3 className="settings-section-title">{t('settings.dataBackupTitle')}</h3>
        <div className="settings-inline">
          <label className="field field-narrow">
            <span className="label">{t('settings.backupRetain')}</span>
            <input
              type="number"
              min={3}
              max={30}
              step={1}
              value={retainDraft}
              onChange={(event) => setRetainDraft(event.currentTarget.value)}
            />
          </label>
          <button type="button" className="primary" onClick={() => void saveRetainLimit()}>
            {t('common.save')}
          </button>
          <button type="button" className="ghost" disabled={busy} onClick={() => void createBackupNow()}>
            {t('settings.backupNow')}
          </button>
        </div>
        <p className="hint">{t('settings.backupRetainHint')}</p>

        <div className="settings-backups">
          <div className="settings-backups-head">
            <span className="label">{t('settings.backupListTitle')}</span>
            <span className="settings-dir-text mono" title={backupDir}>
              {backupDir}
            </span>
          </div>
          {backups.length === 0 ? (
            <p className="empty">{t('settings.backupEmpty')}</p>
          ) : (
            <ul className="settings-backup-list">{backups.map(renderBackupRow)}</ul>
          )}
        </div>

        <h3 className="settings-section-title">{t('settings.dataTransferTitle')}</h3>
        <div className="settings-inline">
          <button type="button" className="ghost compact" disabled={busy} onClick={() => void exportJson()}>
            {t('settings.exportJson')}
          </button>
          <button type="button" className="ghost compact" disabled={busy} onClick={() => void pickImportFile()}>
            {t('settings.importJson')}
          </button>
        </div>
        <p className="hint">{t('settings.dataTransferHint')}</p>
        {renderImportPreview()}

        <div className="settings-dirs">
          <button type="button" className="ghost compact" disabled={busy} onClick={() => void exportDiagnostics()}>
            {t('settings.exportDiagnostics')}
          </button>
          <button type="button" className="ghost compact" onClick={() => void openCrashDir()}>
            {t('settings.openCrashDir')}
          </button>
        </div>
        <p className="hint">{t('settings.diagnosticsHint')}</p>

        <label className="field">
          <span className="label">{t('settings.dataDir')}</span>
          <input type="text" value={settings.snapshot?.dataDir ?? ''} readOnly />
        </label>
        <label className="field">
          <span className="label">{t('settings.logDir')}</span>
          <input type="text" value={settings.snapshot?.logDir ?? ''} readOnly />
        </label>
      </div>
    )
  }

  function renderAppearanceTab() {
    if (current === undefined) {
      return <p className="hint">{t('settings.loading')}</p>
    }
    return (
      <div className="settings-form">
        <label className="settings-check">
          <input
            type="checkbox"
            checked={current.slotTintEnabled}
            onChange={handleSlotTintChange}
          />
          <span>{t('settings.slotTint')}</span>
        </label>
        <p className="hint">{t('settings.slotTintHint')}</p>

        <label className="field">
          <span className="label">{t('settings.density')}</span>
          <select value={current.density} onChange={handleDensityChange}>
            <option value="compact">{t('settings.densityCompact')}</option>
            <option value="comfortable">{t('settings.densityComfortable')}</option>
          </select>
        </label>
        <p className="hint">{t('settings.densityHint')}</p>
      </div>
    )
  }

  function renderTab() {
    switch (tab) {
      case 'general':
        return renderGeneralTab()
      case 'reminder':
        return renderReminderTab()
      case 'ringtones':
        return renderRingtonesTab()
      case 'data':
        return renderDataTab()
      case 'appearance':
        return renderAppearanceTab()
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={handleBackdropPointerDown}>
      <section
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="modal-head">
          <h2 id="settings-title">{t('settings.title')}</h2>
          <button type="button" className="icon" onClick={onClose} aria-label={t('settings.close')}>
            {t('settings.close')}
          </button>
        </header>

        <nav className="settings-tabs" role="tablist" aria-label={t('settings.title')}>
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={tab === entry.id ? 'settings-tab active' : 'settings-tab'}
              data-tab={entry.id}
              onClick={handleTabClick}
            >
              {t(entry.labelKey)}
            </button>
          ))}
        </nav>

        <div className="modal-body">
          {renderTab()}
          {message === null ? null : <p className="message">{message}</p>}
        </div>
      </section>
    </div>
  )
}
