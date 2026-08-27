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

export function TabBar({ tabs, activeTabId, onSelect, onAdd, onClose }: Props) {
  // Browser-like tab strip: tabs grow up to a 220px cap (a single tab never
  // stretches huge) and SHRINK as more are added so they all fit — no horizontal
  // scrollbar. Each title truncates as its tab narrows.
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-950 border-b border-gray-800 shrink-0">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.id)}
            className={`group flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-lg text-sm cursor-pointer select-none whitespace-nowrap border transition-colors flex-1 min-w-0 max-w-[220px] ${
              isActive
                ? 'bg-gray-800 text-gray-100 border-gray-700'
                : 'bg-gray-900/40 text-gray-400 border-transparent hover:text-gray-200 hover:bg-gray-900'
            }`}
          >
            {tab.translating ? (
              <span
                className="w-3 h-3 shrink-0 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"
                title="Translating"
              />
            ) : tab.percent !== null ? (
              <span className="text-[11px] font-semibold text-blue-400 shrink-0">{tab.percent}%</span>
            ) : null}
            <span className="min-w-0 flex-1 truncate font-medium">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (!tab.translating) onClose(tab.id)
              }}
              disabled={tab.translating}
              title={tab.translating ? 'Close disabled while translating' : 'Close tab'}
              className="shrink-0 text-gray-500 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed rounded p-0.5 hover:bg-gray-700/60 leading-none text-base"
            >
              ×
            </button>
          </div>
        )
      })}
      <button
        onClick={onAdd}
        title="New tab"
        className="flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-gray-800 text-xl leading-none shrink-0"
      >
        +
      </button>
    </div>
  )
}
