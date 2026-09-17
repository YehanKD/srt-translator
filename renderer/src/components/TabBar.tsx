export interface TabInfo {
  id: string
  title: string
  translating: boolean
  percent: number | null
}

interface Props {
  tabs: TabInfo[]
  activeTabId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onClose: (id: string) => void
}

/**
 * The active document, shown as a centred filename field rather than a browser
 * tab strip — this is a single-document tool, so a strip of tabs overstated how
 * many documents you'd have open. Extra documents collapse to small chips on
 * the right; `+` adds another, the × closes one.
 */
export function TabBar({ tabs, activeTabId, onSelect, onAdd, onClose }: Props) {
  const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0]
  if (!active) return null

  const others = tabs.filter((t) => t.id !== active.id)
  const canClose = tabs.length > 1

  return (
    <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
      <div
        className="group relative flex h-8 min-w-0 max-w-[513px] flex-1 items-center justify-center rounded-md border border-border bg-surface-alt px-10"
        title={active.title}
      >
        {/* Centred: icon + title. Kept in normal flow so truncation still works,
            while the trailing status/close are absolute (below) so their
            appearing or not never shifts the centre. */}
        <span className="flex min-w-0 items-center gap-2">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-teal-text"
            aria-hidden="true"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>

          <span className="min-w-0 truncate font-mono text-sm font-medium text-text">
            {active.title}
          </span>
        </span>

        {/* Trailing status + close, pinned right so the centre stays put. */}
        <span className="absolute right-3 flex items-center gap-1.5">
          {active.translating ? (
            <span
              className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-teal border-t-transparent"
              title="Translating"
            />
          ) : active.percent !== null ? (
            <span className="nums shrink-0 text-micro text-text-muted">{active.percent}%</span>
          ) : null}

          {canClose && (
            <button
              onClick={() => onClose(active.id)}
              disabled={active.translating}
              title={active.translating ? 'Close disabled while translating' : 'Close this document'}
              className="shrink-0 rounded-xs p-0.5 text-text-muted opacity-0 transition-opacity hover:text-text group-hover:opacity-100 disabled:opacity-30"
            >
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
              </svg>
            </button>
          )}
        </span>
      </div>

      {/* Other open documents — quiet chips, not full tabs. */}
      {others.length > 0 && (
        <div className="flex shrink-0 items-center gap-1">
          {others.slice(0, 4).map((t) => (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              title={t.title}
              className="flex h-8 max-w-[9rem] items-center gap-1.5 rounded-md px-2 text-micro text-text-muted transition-colors hover:bg-surface-alt hover:text-text"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted" aria-hidden="true" />
              <span className="truncate font-mono">{t.title}</span>
            </button>
          ))}
        </div>
      )}

      <button onClick={onAdd} className="btn-icon shrink-0" title="New document" aria-label="New document">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          <path d="M7 2.5v9M2.5 7h9" />
        </svg>
      </button>
    </div>
  )
}
