import { useState } from 'react'
import type { QuotaSummary } from '@shared/types'
import { Modal, ModalHeader } from './Modal'
import { meterColor } from '../lib/quota'

interface Props {
  quota: QuotaSummary
  onClose: () => void
  onRefresh: () => void
}

/** Relative reset time — "in 4h 12m" reads faster than a wall-clock date. */
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

/** One quota row: name, percentage, precise meter, and reset time. */
function QuotaRow({
  label,
  percentage,
  unlimited,
  resetAt,
  meta
}: {
  label: string
  percentage: number
  unlimited: boolean
  resetAt: string | null
  meta?: string
}) {
  const pct = unlimited ? 100 : Math.max(0, Math.min(100, percentage))
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-base text-text-body">
          {label}
        </span>
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
        <span className="truncate">{meta}</span>
        <span className="nums shrink-0">{formatReset(resetAt)}</span>
      </div>
    </div>
  )
}

export function QuotaModal({ quota, onClose, onRefresh }: Props) {
  const [refreshing, setRefreshing] = useState(false)

  // Google returns both a rolling 5-hour window and a weekly one per model
  // group, but only the plan-appropriate one is meaningful: a paid plan's limit
  // resets every 5 hours, a free plan's resets weekly. Showing both (or always
  // picking weekly) made Pro accounts display a reset days away.
  const planLabel = (quota.plan || '').trim()
  // Unknown/empty plan counts as free, so we never imply a 5-hour reset the
  // account may not have.
  const isPaidPlan = planLabel.length > 0 && !/^free$/i.test(planLabel)
  const preferred = isPaidPlan ? '5h' : 'weekly'
  const allLimits = quota.weekly ?? []
  const picked = allLimits.filter((w) => w.window === preferred)
  const groupLimits = picked.length > 0 ? picked : allLimits

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Modal onClose={onClose} width={30}>
      <ModalHeader
        title="Quota"
        onClose={onClose}
        subtitle={
          <span className="flex items-center gap-2">
            <span className={`chip ${isPaidPlan ? 'chip-accent' : ''}`}>{planLabel || 'Free'}</span>
            <span className="text-text-muted">
              {isPaidPlan ? '5-hour window' : 'weekly window'}
            </span>
          </span>
        }
      />

      <div className="max-h-[65vh] overflow-y-auto">
        {/* Google One AI credits, when the account reports them */}
        {quota.credits !== null && quota.credits !== undefined && (
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
            <span className="text-base text-text-body">
              Google One AI credits
            </span>
            <span className="nums text-base font-[590] text-text">
              {quota.credits}
            </span>
          </div>
        )}

        {/* Per-model */}
        {quota.models.length > 0 && (
          <section>
            <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
              <h4 className="eyebrow">Per model</h4>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="btn btn-ghost !h-5 !px-1.5 !text-micro"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={refreshing ? 'animate-spin' : ''}
                >
                  <path d="M21 12a9 9 0 11-2.6-6.4M21 3v6h-6" />
                </svg>
                Refresh
              </button>
            </div>
            <div className="divide-y divide-border">
              {quota.models.map((m) => (
                <QuotaRow
                  key={m.id}
                  label={m.name}
                  percentage={m.remainingPercentage}
                  unlimited={m.unlimited}
                  resetAt={m.resetAt}
                  meta={`${m.used} / ${m.unlimited ? '∞' : m.total} used`}
                />
              ))}
            </div>
          </section>
        )}

        {/* Group rate limits */}
        {groupLimits.length > 0 && (
          <section className="border-t border-border">
            <div className="px-3 pt-3 pb-1.5">
              <h4 className="eyebrow">Shared limits</h4>
            </div>
            <div className="divide-y divide-border">
              {groupLimits.map((w) => (
                <QuotaRow
                  key={w.key}
                  label={w.displayName || w.key}
                  percentage={w.remainingPercentage}
                  unlimited={w.unlimited}
                  resetAt={w.resetAt}
                  meta={w.window === '5h' ? '5-hour limit' : 'weekly limit'}
                />
              ))}
            </div>
          </section>
        )}

        {quota.models.length === 0 && groupLimits.length === 0 && (
          <div className="px-3 py-8 text-center text-base text-text-muted">
            No quota reported for this account.
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-3 py-2 border-t border-border">
        <span className="nums text-micro text-text-muted">
          Updated {new Date(quota.fetchedAt).toLocaleTimeString()}
        </span>
        <button onClick={onClose} className="btn btn-secondary">
          Done
        </button>
      </div>
    </Modal>
  )
}
