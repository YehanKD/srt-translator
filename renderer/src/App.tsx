import { useState, useCallback, useRef } from 'react'
import { SettingsPanel } from './components/SettingsPanel'
import { StatusBar } from './components/StatusBar'
import { HomeView } from './components/HomeView'
import { TabBar, type TabInfo as TabBarTabInfo } from './components/TabBar'
import { TabView, type TabViewInfo } from './components/TabView'
import type { ApiSettings, SubtitleEntry } from '@shared/types'

interface TabState {
  id: string
  title: string
}

type View = 'home' | 'workspace'

export default function App() {
  const [settings, setSettings] = useState<ApiSettings>({ endpointUrl: '', apiKey: '', modelId: '' })
  const [tabs, setTabs] = useState<TabState[]>([{ id: 'tab-1', title: 'Untitled 1' }])
  const [activeTabId, setActiveTabId] = useState('tab-1')
  // Each tab carries its own home/workspace lifecycle: a new tab opens on the
  // home page so the user can start a fresh movie workflow (add → extract →
  // translate → export) without touching other tabs.
  const [tabView, setTabViewState] = useState<Record<string, View>>({ 'tab-1': 'home' })
  const [tabInfo, setTabInfo] = useState<Record<string, TabViewInfo>>({})
  // Per-tab preloaded subtitles (from MKV extraction or a home drag-and-drop).
  const [tabInitial, setTabInitial] = useState<Record<string, { entries: SubtitleEntry[]; fileName: string } | null>>({})
  // Per-tab pending MKV path handed from a workspace drop to that tab's home view.
  const [pendingMkvByTab, setPendingMkvByTab] = useState<Record<string, string>>({})
  const counterRef = useRef(1)

  const setTabView = useCallback((tabId: string, view: View) => {
    setTabViewState((prev) => ({ ...prev, [tabId]: view }))
  }, [])

  const handleTabInfoChange = useCallback((tabId: string, info: TabViewInfo) => {
    setTabInfo((prev) => ({ ...prev, [tabId]: info }))
  }, [])

  // New tab without content → starts on the home page (fresh movie workflow).
  // New tab WITH content (e.g. a second extraction while one is open) → goes
  // straight to the workspace so the loaded subtitles are visible immediately.
  const addTab = useCallback((initialImport?: { entries: SubtitleEntry[]; fileName: string }) => {
    counterRef.current += 1
    const id = `tab-${counterRef.current}`
    const title = initialImport ? initialImport.fileName || 'Untitled' : `Untitled ${counterRef.current}`
    setTabs((prev) => [...prev, { id, title }])
    setTabViewState((prev) => ({ ...prev, [id]: initialImport ? 'workspace' : 'home' }))
    if (initialImport) setTabInitial((prev) => ({ ...prev, [id]: initialImport }))
    setActiveTabId(id)
    return id
  }, [])

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev // never close the last tab
      const next = prev.filter((t) => t.id !== id)
      if (next.length === 0) return prev
      setActiveTabId((active) => (active === id ? next[next.length - 1].id : active))
      return next
    })
    setTabInfo((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    setTabInitial((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    setTabViewState((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    setPendingMkvByTab((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const selectTab = useCallback((id: string) => {
    setActiveTabId(id)
  }, [])

  // Load content into a SPECIFIC tab (the home tab that initiated the flow)
  // and flip it to the workspace — one tab = one movie pipeline.
  const loadIntoTab = useCallback((tabId: string, entries: SubtitleEntry[], fileName: string) => {
    setTabInitial((prev) => ({ ...prev, [tabId]: { entries, fileName } }))
    setTabViewState((prev) => ({ ...prev, [tabId]: 'workspace' }))
    setActiveTabId(tabId)
  }, [])

  // TabView consumed an initialImport — drop it so the same object can't be
  // re-consumed and future loads into the same tab still trigger the effect.
  const handleTabInitialConsumed = useCallback((tabId: string) => {
    setTabInitial((prev) => {
      if (!(tabId in prev)) return prev
      const next = { ...prev }
      delete next[tabId]
      return next
    })
  }, [])

  // A .mkv dropped in a translator tab routes to THAT tab's home extract flow.
  const handleMkvDropped = useCallback((tabId: string, path: string) => {
    setPendingMkvByTab((prev) => ({ ...prev, [tabId]: path }))
    setTabViewState((prev) => ({ ...prev, [tabId]: 'home' }))
    setActiveTabId(tabId)
  }, [])

  const clearMkvPath = useCallback((tabId: string) => {
    setPendingMkvByTab((prev) => {
      if (!(tabId in prev)) return prev
      const next = { ...prev }
      delete next[tabId]
      return next
    })
  }, [])

  const barTabs: TabBarTabInfo[] = tabs.map((t) => ({
    id: t.id,
    title: tabInfo[t.id]?.title ?? t.title,
    translating: tabInfo[t.id]?.translating ?? false,
    percent: tabInfo[t.id]?.percent ?? null
  }))

  const activeInfo = tabInfo[activeTabId]
  const activeTabHome = tabView[activeTabId] === 'home'

  return (
    <div className="h-screen flex flex-col bg-gray-950">
      <header className="flex items-center justify-between px-5 py-3 border-b border-gray-800 bg-gray-900/50">
        <button
          onClick={() => setTabView(activeTabId, 'home')}
          className="flex items-center gap-3 text-left group"
          title="Back to Home"
        >
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center group-hover:bg-blue-500 transition-colors">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-100">SRT Translator</h1>
            <p className="text-xs text-gray-500">English → Sinhala</p>
          </div>
        </button>

        <button
          onClick={() => setTabView(activeTabId, 'home')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
            activeTabHome
              ? 'bg-gray-800 text-blue-400 border-gray-700'
              : 'text-gray-300 border-gray-700 hover:bg-gray-800'
          }`}
        >
          Home
        </button>
      </header>

      <TabBar tabs={barTabs} activeTabId={activeTabId} onSelect={selectTab} onAdd={() => addTab()} onClose={closeTab} />

      <div className="flex-1 flex overflow-hidden">
        {/* Home page of the active tab (only rendered for the active tab). */}
        <div className={activeTabHome ? 'flex-1 flex flex-col overflow-hidden' : 'hidden'}>
          {activeTabHome && (
            <HomeView
              key={activeTabId}
              onOpenTranslator={() => setTabView(activeTabId, 'workspace')}
              onLoaded={(entries, fileName) => loadIntoTab(activeTabId, entries, fileName)}
              initialMkvPath={pendingMkvByTab[activeTabId] ?? null}
              onMkvPathConsumed={() => clearMkvPath(activeTabId)}
            />
          )}
        </div>

        {/* Workspace — kept mounted (hidden while the active tab shows home)
            so every tab keeps its loaded subtitles and progress. */}
        <div className={activeTabHome ? 'hidden' : 'flex-1 flex overflow-hidden'}>
          <aside className="w-80 border-r border-gray-800 p-4 overflow-y-auto flex-shrink-0">
            <SettingsPanel settings={settings} onChange={setSettings} />
          </aside>

          <main className="flex-1 p-5 overflow-y-auto space-y-4">
            {tabs.map((tab) => (
              <TabView
                key={tab.id}
                tabId={tab.id}
                defaultTitle={tab.title}
                settings={settings}
                isActive={tab.id === activeTabId}
                initialImport={tabInitial[tab.id]}
                onInitialConsumed={handleTabInitialConsumed}
                onMkvDropped={(path) => handleMkvDropped(tab.id, path)}
                onTabInfoChange={handleTabInfoChange}
              />
            ))}
          </main>
        </div>
      </div>

      {!activeTabHome && (
        <StatusBar
          settings={settings}
          subtitleCount={activeInfo?.subtitleCount ?? 0}
          translating={activeInfo?.translating ?? false}
        />
      )}
    </div>
  )
}
