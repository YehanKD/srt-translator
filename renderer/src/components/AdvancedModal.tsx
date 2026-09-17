import { useState } from 'react'
import type { AntigravityModel } from '@shared/types'
import { Modal, ModalHeader } from './Modal'
import { IconChevronDown } from './Icons'
import { PREFERRED_MODEL_ID, pickAutoModel } from '../lib/models'

interface Props {
  models: AntigravityModel[]
  selectedModelId: string
  /** True when the current pick came from auto-selection, not the user. */
  isAutomatic: boolean
  onSelectModel: (id: string) => void
  onResetToAuto: () => void
  onClose: () => void
}

/**
 * Advanced settings. Holds the model picker so it stops occupying the main UI —
 * choosing a model is a rare, power-user action, and a permanent dropdown on the
 * account strip asked everyone to make a decision most people should never make.
 *
 * The quota deliberately stays on the strip: that's ambient status you check at
 * a glance, not configuration.
 */
export function AdvancedModal({
  models,
  selectedModelId,
  isAutomatic,
  onSelectModel,
  onResetToAuto,
  onClose
}: Props) {
  const [open, setOpen] = useState(false)

  const autoId = pickAutoModel(models)
  const current = models.find((m) => m.id === selectedModelId)
  const currentName = current?.name ?? selectedModelId ?? 'None'

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
          <span className="field-label">Preferred model</span>
          <p className="mt-1 font-mono text-micro text-text-body">
            {PREFERRED_MODEL_ID}
          </p>
          <p className="mt-1 text-micro leading-relaxed text-text-muted">
            Used whenever your account offers it. If it isn't available, the best Pro
            model is chosen instead, falling back to whatever the account does offer so
            translation is never blocked.
          </p>
        </div>
      </div>
    </Modal>
  )
}
