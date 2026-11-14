import { formatDuration } from '@core/summary'
import type { ActionStatDto, StatsOverviewDto } from '@shared/contracts'
import type { ChangeEvent } from 'react'
import type { StatsPreset, StatsState } from '../../state/use-stats'
import { t } from '../../translation'

type StatsPanelProps = {
  readonly state: StatsState
}

const PRESETS: readonly {
  readonly id: StatsPreset
  readonly labelKey:
    | 'stats.presetWeek'
    | 'stats.presetLastWeek'
    | 'stats.presetMonth'
    | 'stats.presetQuarter'
    | 'stats.presetYear'
    | 'stats.presetAll'
    | 'stats.presetCustom'
}[] = [
  { id: 'week', labelKey: 'stats.presetWeek' },
  { id: 'lastWeek', labelKey: 'stats.presetLastWeek' },
  { id: 'month', labelKey: 'stats.presetMonth' },
  { id: 'quarter', labelKey: 'stats.presetQuarter' },
  { id: 'year', labelKey: 'stats.presetYear' },
  { id: 'all', labelKey: 'stats.presetAll' },
  { id: 'custom', labelKey: 'stats.presetCustom' },
]

export function StatsPanel(props: StatsPanelProps) {
  const { state } = props
  const overview = state.overview

  function handleFromChange(event: ChangeEvent<HTMLInputElement>): void {
    state.setFrom(event.target.value)
  }

  function handleToChange(event: ChangeEvent<HTMLInputElement>): void {
    state.setTo(event.target.value)
  }

  function renderPresetButton(preset: (typeof PRESETS)[number]) {
    const className = preset.id === state.preset ? 'stats-preset active' : 'stats-preset'
    return (
      <button
        key={preset.id}
        type="button"
        className={className}
        onClick={() => state.setPreset(preset.id)}
      >
        {t(preset.labelKey)}
      </button>
    )
  }

  function renderOverview(data: StatsOverviewDto) {
    const maxActionSec = data.byAction.reduce((max, item) => Math.max(max, item.durationSec), 0)

    function renderActionBar(item: ActionStatDto) {
      const width = `${maxActionSec === 0 ? 0 : Math.round((item.durationSec / maxActionSec) * 100)}%`
      return (
        <li key={item.actionId} className="stats-bar-row">
          <span className="stats-bar-label" title={item.actionName}>
            {item.actionName}
          </span>
          <span className="stats-bar-track">
            <span className="stats-bar-fill" style={{ width }} />
          </span>
          <span className="stats-bar-value mono">{formatDuration(item.durationSec)}</span>
        </li>
      )
    }

    return (
      <div className="stats-column">
        <h3>{t('stats.byAction')}</h3>
        {data.byAction.length === 0 ? (
          <p className="empty">{t('stats.empty')}</p>
        ) : (
          <ul className="stats-bars">{data.byAction.map(renderActionBar)}</ul>
        )}
      </div>
    )
  }

  return (
    <section className="panel stats-panel">
      <div className="panel-head">
        <h2>{t('stats.title')}</h2>
        <div className="panel-head-actions">
          <span className="badge">
            {state.emptyAll
              ? t('stats.allEmptyRange')
              : `${state.from} ${t('stats.rangeSeparator')} ${state.to}`}
          </span>
          <button type="button" className="ghost compact" onClick={() => void state.exportCsv()}>
            {t('stats.exportCsv')}
          </button>
        </div>
      </div>

      <div className="stats-presets">{PRESETS.map(renderPresetButton)}</div>

      <div className="stats-range">
        <input type="date" value={state.from} onChange={handleFromChange} aria-label={t('stats.fromAria')} />
        <span>{t('stats.rangeSeparator')}</span>
        <input type="date" value={state.to} onChange={handleToChange} aria-label={t('stats.toAria')} />
      </div>

      {state.exportMessage === null ? null : <p className="message">{state.exportMessage}</p>}

      {overview === null ? (
        <p className="empty">{t('stats.loading')}</p>
      ) : state.emptyAll ? (
        <p className="empty">{t('stats.allEmpty')}</p>
      ) : (
        renderOverview(overview)
      )}
    </section>
  )
}
