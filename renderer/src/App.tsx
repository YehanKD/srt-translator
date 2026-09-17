import { useState, useCallback, useRef } from 'react'
import { AccountStatusBar } from './components/AccountStatusBar'
import { HomeView } from './components/HomeView'
import { QuotaModal } from './components/QuotaModal'
import { ThemeToggle } from './components/ThemeToggle'
import { AdvancedModal } from './components/AdvancedModal'
import { TabBar } from './components/TabBar'
import { TabView, type TabViewInfo } from './components/TabView'
import { useAntigravity } from './hooks/useAntigravity'
import {
  IconMessageSquareText,
  IconArrowRight,
  IconHome
} from './components/Icons'
import type { SubtitleEntry, ApiSettings } from '@shared/types'

interface TabState {
  id: string
  title: string
}

type View = 'home' | 'workspace'

export default function App() {
  const { status, progress, quota, models, selectedModelId, modelIsAutomatic, loading, error, canPersist, login, cancelLogin, logout, selectModel, resetToAutoModel, refreshQuota } = useAntigravity()

  const [tabs, setTabs] = useState<TabState[]>([{ id: 'tab-1', title: 'Home' }])
  const [activeTabId, setActiveTabId] = useState('tab-1')
  const [tabView, setTabViewState] = useState<Record<string, View>>({ 'tab-1': 'home' })
  const [tabInfo, setTabInfo] = useState<Record<string, TabViewInfo>>({})
  const [tabInitial, setTabInitial] = useState<Record<string, { entries: SubtitleEntry[]; fileName: string } | null>>({})
  const [pendingMkvByTab, setPendingMkvByTab] = useState<Record<string, string>>({})
  const [showQuotaModal, setShowQuotaModal] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const counterRef = useRef(1)

  const setTabView = useCallback((tabId: string, view: View) => {
    setTabViewState((prev) => ({ ...prev, [tabId]: view }))
  }, [])

  const handleTabInfoChange = useCallback((tabId: string, info: TabViewInfo) => {
    setTabInfo((prev) => ({ ...prev, [tabId]: info }))
  }, [])

  const addTab = useCallback((initialImport?: { entries: SubtitleEntry[]; fileName: string }) => {
    counterRef.current += 1
    const id = `tab-${counterRef.current}`
    // An empty tab IS the home screen, so it says so until a file is loaded.
    const title = initialImport ? initialImport.fileName || 'Home' : 'Home'
    setTabs((prev) => [...prev, { id, title }])
    setTabViewState((prev) => ({ ...prev, [id]: initialImport ? 'workspace' : 'home' }))
    if (initialImport) setTabInitial((prev) => ({ ...prev, [id]: initialImport }))
    setActiveTabId(id)
    return id
  }, [])

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev
      const next = prev.filter((t) => t.id !== id)
      if (next.length === 0) return prev
      setActiveTabId((active) => (active === id ? next[next.length - 1].id : active))
      return next
    })
    // One helper instead of four copies of the same delete dance.
    const drop = <T,>(prev: Record<string, T>) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    }
    setTabInfo(drop)
    setTabInitial(drop)
    setTabViewState(drop)
    setPendingMkvByTab(drop)
  }, [])

  const selectTab = useCallback((id: string) => setActiveTabId(id), [])

  const loadIntoTab = useCallback((tabId: string, entries: SubtitleEntry[], fileName: string) => {
    setTabInitial((prev) => ({ ...prev, [tabId]: { entries, fileName } }))
    setTabViewState((prev) => ({ ...prev, [tabId]: 'workspace' }))
    setActiveTabId(tabId)
  }, [])

  const handleTabInitialConsumed = useCallback((tabId: string) => {
    setTabInitial((prev) => {
      if (!(tabId in prev)) return prev
      const next = { ...prev }
      delete next[tabId]
      return next
    })
  }, [])

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

  const barTabs = tabs.map((t) => ({
    id: t.id,
    title: tabInfo[t.id]?.title ?? t.title,
    translating: tabInfo[t.id]?.translating ?? false,
    percent: tabInfo[t.id]?.percent ?? null
  }))

  const activeTabHome = tabView[activeTabId] === 'home'

  const settings: ApiSettings = { modelId: selectedModelId }

  return (
    <div className="flex h-screen flex-col bg-canvas">
      {/* ── Header (76px): identity left, active tab centred, nav right. ── */}
      <header className="flex h-[76px] shrink-0 items-center justify-between gap-6 border-b border-border bg-surface px-8">
        <div className="flex shrink-0 items-center gap-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-teal text-white">
            <IconMessageSquareText size={20} />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-lg font-bold leading-none tracking-[-0.01em] text-text">
              SRT Translator
            </span>
            {/* The source language is auto-detected by the model, so the header
                names the destination only rather than claiming "English". */}
            <span className="flex items-center gap-1.5">
              <span className="text-micro font-medium text-text-body">Any language</span>
              <IconArrowRight size={10} className="text-text-muted" />
              <span className="text-micro font-semibold text-teal-text">Sinhala</span>
            </span>
          </span>
        </div>

        <TabBar
          tabs={barTabs}
          activeTabId={activeTabId}
          onSelect={selectTab}
          onAdd={() => addTab()}
          onClose={closeTab}
        />

        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />

          <button onClick={() => setTabView(activeTabId, 'home')} className="btn btn-secondary">
            <IconHome size={16} />
            Home
          </button>
        </div>
      </header>

      {/* ── Account / model / quota strip (66px) ── */}
      <AccountStatusBar
        status={status}
        quota={quota}
        loading={loading}
        error={error}
        canPersist={canPersist}
        onLogin={login}
        onLogout={logout}
        onRefreshQuota={refreshQuota}
        onShowQuotaDetail={() => setShowQuotaModal(true)}
        onShowAdvanced={() => setShowAdvanced(true)}
      />

      {/* ── Body ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className={activeTabHome ? 'flex flex-1 flex-col overflow-hidden' : 'hidden'}>
          {activeTabHome && (
            <HomeView
              key={activeTabId}
              onLoaded={(entries, fileName) => loadIntoTab(activeTabId, entries, fileName)}
              initialMkvPath={pendingMkvByTab[activeTabId] ?? null}
              onMkvPathConsumed={() => clearMkvPath(activeTabId)}
            />
          )}
        </div>

        <div className={activeTabHome ? 'hidden' : 'flex flex-1 flex-col overflow-hidden'}>
          {progress && progress.phase !== 'complete' && progress.phase !== 'cancelled' && progress.phase !== 'error' && (
            <div className="flex items-center gap-2 border-b border-border bg-surface px-8 py-2 text-base text-text-body fade-in">
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.75px] border-teal border-t-transparent" />
              <span>{progress.message || 'Signing in…'}</span>
              {progress.phase === 'waiting-callback' && (
                <button onClick={cancelLogin} className="btn btn-ghost ml-auto !h-8">
                  Cancel
                </button>
              )}
            </div>
          )}

          <main className="flex-1 overflow-hidden">
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

      {showQuotaModal && quota && (
        <QuotaModal quota={quota} onClose={() => setShowQuotaModal(false)} onRefresh={refreshQuota} />
      )}

      {showAdvanced && (
        <AdvancedModal
          models={models}
          selectedModelId={selectedModelId}
          isAutomatic={modelIsAutomatic}
          onSelectModel={selectModel}
          onResetToAuto={resetToAutoModel}
          onClose={() => setShowAdvanced(false)}
        />
      )}
    </div>
  )
}
