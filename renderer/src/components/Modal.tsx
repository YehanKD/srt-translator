import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Base dialog. Renders a centred panel over a dimmed, blurred backdrop, closes
 * on Escape and on backdrop click, moves focus in on open and restores it on
 * close. Every modal in the app is built on this so they can't drift apart.
 *
 * Motion: scale(0.96) + opacity, never scale(0) — nothing appears from nothing.
 * ease-out on entry (the user is watching), and the backdrop fades with it.
 * Modals stay transform-origin: center because they aren't anchored to a
 * trigger (popovers/menus are the ones that must scale from their trigger).
 */
export function Modal({
  onClose,
  children,
  width = 26
}: {
  onClose: () => void
  children: ReactNode
  /** Panel width in rem. */
  width?: number
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)

    // Move focus into the dialog so keyboard users land in the right place.
    const first = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    first?.focus()

    return () => {
      document.removeEventListener('keydown', onKey)
      restoreRef.current?.focus?.()
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 modal-backdrop"
      onMouseDown={(e) => {
        // Only dismiss on a click that both starts and ends on the backdrop.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="w-full overflow-hidden modal-panel"
        style={{
          maxWidth: `${width}rem`,
          background: 'var(--t-surface)',
          border: '1px solid var(--t-border)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: '0 16px 48px -12px rgba(0,0,0,0.7), inset 0 1px 0 0 rgba(255,255,255,0.04)'
        }}
      >
        {children}
      </div>
    </div>
  )
}

/** Dialog header: title, optional subtitle, close affordance. */
export function ModalHeader({
  title,
  subtitle,
  onClose
}: {
  title: string
  subtitle?: ReactNode
  onClose: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-border">
      <div className="min-w-0">
        <h3 className="text-base font-[590] text-text">{title}</h3>
        {subtitle && (
          <div className="mt-0.5 text-micro text-text-muted">{subtitle}</div>
        )}
      </div>
      <button onClick={onClose} className="btn-icon -mr-1 -mt-0.5" aria-label="Close">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" />
        </svg>
      </button>
    </div>
  )
}

/** Right-aligned action row. */
export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
      {children}
    </div>
  )
}
