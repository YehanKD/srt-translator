import { useState } from 'react'
import type { AntigravityModel, QuotaSummary } from '@shared/types'
import { Modal, ModalHeader } from './Modal'
import { IconChevronDown, IconRefresh } from './Icons'
import { pickAutoModel } from '../lib/models'
import { windowFor, meterColor } from '../lib/quota'

interface Props {
  models: AntigravityModel[]
  selectedModelId: string
  /** True when the current pick came from auto-selection, not the user. */
  isAutomatic: boolean
  onSelectModel: (id: string) => void
  onResetToAuto: () => void
  onClose: () => void
  /**
   * Full quota breakdown. Lives here because the dashboard shows only the
   * 5-hour window — the number that answers "can I translate now?" — while the
   * weekly allowance is reference material you check deliberately, not ambient
   * status. The dashboard used to show whichever window was tighter, which read
   * as "blocked for 3 days" while translation worked fine.
   */
  quota: QuotaSummary | null
  onRefreshQuota: () => void
}

/** One window's figures: percentage, precise meter, reset. */
function QuotaLine({
  label,
  percentage,
  resetAt,
  unlimited,
  hint
}: {
  label: string
  percentage: number
  resetAt: string | null
  unlimited?: boolean
  hint?: string
}) {
  const pct = unlimited ? 100 : Math.max(0, Math.min(100, percentage))
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-base text-text-body">{label}</span>
        <span className="nums shrink-0 text-micro text-text-muted">
          {unlimited ? 'Unlimited' : `${Math.round(percentage)}% left`}
        </span>
      </div>

      <div className="meter mt-2">
        <div
          className="meter-fill"
          style={{ width: `${pct}%`, background: unlimited ? 'var(--t-teal)' : meterColor(pct) }}
        />
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-3 text-micro text-text-muted">
        <span className="truncate">{hint}</span>
        <span className="nums shrink-0">{formatReset(resetAt)}</span>
      </div>
    </div>
  )
}

/** Relative reset — "in 4h 12m" reads faster than a wall-clock date. */
function formatReset(resetAt: string | null): string {
  if (!resetAt) return '—'
  const ms = new Date(resetAt).getTime() - Date.now()
  if (!Number.isFinite(ms)) return '—'
  if (ms <= 0) return 'now'
  const mins = Math.round(ms / 60000)
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `in ${d}d ${h}h`
  if (h > 0) return `in ${h}h ${m}m`
  return `in ${m}m`
}

/**
 * Advanced settings. Holds the model picker so it stops occupying the main UI —
 * choosing a model is a rare, power-user action, and a permanent dropdown on the
 * account strip asked everyone to make a decision most people should never make.
 *
 * The 5-hour quota stays on the strip: that's ambient status you check at a
 * glance, not configuration. The weekly allowance lives here with the rest of
 * the detail.
 */
export function AdvancedModal({
  models,
  selectedModelId,
  isAutomatic,
  onSelectModel,
  onResetToAuto,
  onClose,
  quota,
  onRefreshQuota
}: Props) {
  const [open, setOpen] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const autoId = pickAutoModel(models)
  const current = models.find((m) => m.id === selectedModelId)
  const currentName = current?.name ?? selectedModelId ?? 'None'

  // The window family follows the model in use: Claude and GPT models draw on a
  // separate pool, so showing a Gemini reset for one of them would report a
  // limit that model does not use.
  const fiveHour = windowFor(selectedModelId, quota?.weekly ?? [], '5h')
  const weekly = windowFor(selectedModelId, quota?.weekly ?? [], 'weekly')
  const hasWindows = Boolean(fiveHour || weekly)

  return (
    <Modal onClose={onClose} width={32}>
      <ModalHeader
        title="Advanced"
        subtitle="Options most people never need to change"
        onClose={onClose}
      />

      <div className="space-y-4 p-4">
        {/* ── Model ── */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="field-label">Translation model</span>
            {isAutomatic ? (
              <span className="chip chip-success">Automatic</span>
            ) : (
              <span className="chip chip-warning">Manual</span>
            )}
          </div>

          {/* Collapsed by default: the model is chosen for you, so the list is
              only shown when you deliberately go looking for it. */}
          <button
            onClick={() => setOpen((v) => !v)}
            disabled={models.length === 0}
            className="mt-2 flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50"
            aria-expanded={open}
          >
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold text-text">
                {currentName}
              </span>
              <span className="mt-0.5 block text-micro text-text-muted">
                {models.length === 0
                  ? 'No models reported by this account'
                  : isAutomatic
                    ? 'Chosen automatically — newest Pro available'
                    : 'Chosen manually'}
              </span>
            </span>
            <IconChevronDown
              size={16}
              className={`shrink-0 text-text-muted transition-transform duration-200 ${
                open ? 'rotate-180' : ''
              }`}
            />
          </button>

          {open && models.length > 0 && (
            <div className="mt-2 max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-border bg-surface p-1 fade-in">
              {models.map((m) => {
                const selected = m.id === selectedModelId
                return (
                  <button
                    key={m.id}
                    onClick={() => onSelectModel(m.id)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                      selected ? 'bg-teal-soft' : 'hover:bg-surface-alt'
                    }`}
                  >
                    <span
                      className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${
                        selected ? 'border-teal' : 'border-border-strong'
                      }`}
                    >
                      {selected && <span className="h-1.5 w-1.5 rounded-full bg-teal" />}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base text-text">{m.name}</span>
                      <span className="mt-0.5 block truncate font-mono text-micro text-text-muted">
                        {m.id}
                      </span>
                    </span>

                    {m.id === autoId && <span className="chip chip-accent shrink-0">Auto</span>}
                  </button>
                )
              })}
            </div>
          )}

          {!isAutomatic && (
            <button onClick={onResetToAuto} className="btn btn-secondary mt-2 w-full">
              Reset to automatic
            </button>
          )}

          <p className="mt-2 text-micro leading-relaxed text-text-muted">
            The model resets to automatic the next time you open the app, so a manual
            pick only applies to this session.
          </p>
        </div>

        {/* ── Reference ── */}
        <div className="rounded-lg border border-border bg-surface-alt px-3 py-2.5">
          <span className="field-label">Automatic selection</span>
          <p className="mt-1 text-micro leading-relaxed text-text-muted">
            The newest Gemini Pro your account offers is chosen each launch, so a newly
            released model is picked up without updating the app. If no Pro is available,
            the best remaining model is used so translation is never blocked.
          </p>
        </div>

        {/* ── Quota ── */}
        {hasWindows && (
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="field-label">Quota</span>
              <button
                onClick={async () => {
                  setRefreshing(true)
                  try {
                    await onRefreshQuota()
                  } finally {
                    setRefreshing(false)
                  }
                }}
                disabled={refreshing}
                className="btn btn-ghost !h-5 !px-1.5 !text-micro"
              >
                <IconRefresh size={11} className={refreshing ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>

            <div className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
              {fiveHour && (
                <QuotaLine
                  label="5-hour window"
                  percentage={fiveHour.remainingPercentage}
                  resetAt={fiveHour.resetAt}
                  unlimited={fiveHour.unlimited}
                  hint="Rolling — refills within hours"
                />
              )}
              {weekly && (
                <QuotaLine
                  label="Weekly window"
                  percentage={weekly.remainingPercentage}
                  resetAt={weekly.resetAt}
                  unlimited={weekly.unlimited}
                  hint="Shared across the account"
                />
              )}
            </div>

            <p className="mt-2 text-micro leading-relaxed text-text-muted">
              The dashboard shows the 5-hour window, because that is what decides
              whether you can translate right now. The weekly allowance is larger and
              slower to refill, so a low weekly figure does not mean you are blocked.
            </p>
          </div>
        )}

        {/* ── Diagnostics ── */}
        <div className="rounded-lg border border-border bg-surface-alt px-3 py-2.5">
          <span className="field-label">Diagnostics</span>
          <p className="mt-1 text-micro leading-relaxed text-text-muted">
            The app writes a log of sign-in, translation and error events. Opening it is
            the fastest way to report a problem — the log says what actually went wrong
            instead of leaving you to describe it from a screenshot.
          </p>
          <button
            onClick={async () => {
              const r = await window.electronAPI.openLog()
              setLogError(r.success ? null : (r.error ?? 'Could not open the log.'))
            }}
            className="btn btn-secondary mt-2 w-full"
          >
            Open log file
          </button>
          {logError && <p className="mt-1.5 text-micro text-danger">{logError}</p>}
        </div>
      </div>
    </Modal>
  )
}
