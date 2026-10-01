import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  AccountStatus,
  AuthProgress,
  QuotaSummary,
  AntigravityModel
} from '@shared/types'

import { pickAutoModel } from '../lib/models'

export function useAntigravity() {
  const [status, setStatus] = useState<AccountStatus>({
    signedIn: false,
    account: null,
    needsReauth: false
  })
  const [canPersist, setCanPersist] = useState(true)
  const [progress, setProgress] = useState<AuthProgress | null>(null)
  const [quota, setQuota] = useState<QuotaSummary | null>(null)
  const [models, setModels] = useState<AntigravityModel[]>([])
  // Empty until the account's model list arrives, at which point
  // loadModels() auto-selects. Nothing is persisted: auto-selection wins on
  // every launch and a manual pick is deliberately session-only.
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  // false once the user picks a model by hand, so the UI can label it Manual.
  const [modelIsAutomatic, setModelIsAutomatic] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cleanupRefs = useRef<(() => void)[]>([])

  // Clean up listeners on unmount
  useEffect(() => {
    return () => {
      cleanupRefs.current.forEach(fn => fn())
    }
  }, [])

  // Load initial auth status
  const loadStatus = useCallback(async () => {
    try {
      const res = await window.electronAPI.getAuthStatus()
      if (res.success && res.data) {
        setStatus(res.data)
        if (res.data.signedIn && res.data.account) {
          // Fetch models and quota
          await Promise.all([loadModels(), loadQuota()])
        }
      }
    } catch (err) {
      console.error('Failed to load auth status:', err)
    }
  }, [])

  // Whether the OS keyring is available (if not, sign-in won't be remembered).
  useEffect(() => {
    window.electronAPI
      .canPersistSession()
      .then((r) => {
        if (r.success && typeof r.data === 'boolean') setCanPersist(r.data)
      })
      .catch(() => {
        /* leave the optimistic default */
      })
  }, [])

  // Load models
  const loadModels = useCallback(async () => {
    try {
      const res = await window.electronAPI.listModels()
      if (res.success && res.data) {
        setModels(res.data)
        // Always auto-select on load: prefer the newest Pro the account offers,
        // falling back to whatever exists so translating is never blocked.
        // (Previously this took res.data[0] — literally whatever the account
        // listed first, which could be a Flash model.)
        const auto = pickAutoModel(res.data)
        if (auto) {
          setSelectedModelId(auto)
          setModelIsAutomatic(true)
        }
      }
    } catch (err) {
      console.error('Failed to load models:', err)
    }
  }, [])

  // Load quota
  const loadQuota = useCallback(async () => {
    try {
      const res = await window.electronAPI.getQuota()
      if (res.success && res.data) {
        setQuota(res.data)
      }
    } catch (err) {
      console.error('Failed to load quota:', err)
    }
  }, [])

  // Refresh quota
  const refreshQuota = useCallback(async () => {
    try {
      const res = await window.electronAPI.refreshQuota()
      if (res.success && res.data) {
        setQuota(res.data)
        setError(null)
      } else {
        // Surface it: the button used to fail silently with only a console log.
        setError(res.error || 'Could not refresh quota')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh quota')
    }
  }, [])

  /**
   * Keep the quota indicator current without the user pressing Refresh.
   *
   * Polls on a timer using the CACHED path: the main process holds the quota
   * RPC result for 60s, so this costs one upstream round-trip per minute at
   * most, however often the timer fires. A forced refresh (the Refresh button)
   * takes ~5s and hits the upstream RPCs every time, so it is deliberately NOT
   * used on a timer.
   */
  const QUOTA_POLL_MS = 60_000

  useEffect(() => {
    if (!status.signedIn) return
    const timer = window.setInterval(() => {
      void loadQuota()
    }, QUOTA_POLL_MS)
    return () => window.clearInterval(timer)
  }, [status.signedIn, loadQuota])

  /**
   * Refresh right after a translation finishes.
   *
   * Translating is what consumes quota, so this is the moment the number
   * actually changes — waiting up to a minute for the poll would make the bar
   * look stale exactly when the user is watching it. A short delay lets the
   * upstream counters settle before we read them.
   */
  useEffect(() => {
    const off = window.electronAPI.onTranslationComplete(() => {
      window.setTimeout(() => {
        void refreshQuota()
      }, 3000)
    })
    return off
  }, [refreshQuota])

  // Listen for auth state changes
  useEffect(() => {
    const off = window.electronAPI.onAuthStateChanged((newStatus: AccountStatus) => {
      setStatus(newStatus)
      if (newStatus.signedIn && newStatus.account) {
        loadModels()
        loadQuota()
      } else {
        setModels([])
        setQuota(null)
      }
    })
    cleanupRefs.current.push(off)

    // Listen for auth progress
    const offProgress = window.electronAPI.onAuthProgress((p: AuthProgress) => {
      setProgress(p)
      if (p.phase === 'complete' || p.phase === 'cancelled' || p.phase === 'error') {
        // After completion, refresh status
        if (p.phase === 'complete') {
          loadStatus()
        }
        setTimeout(() => setProgress(null), 3000)
      }
    })
    cleanupRefs.current.push(offProgress)

    loadStatus()
  }, [loadStatus, loadModels, loadQuota])

  // Manual pick — session-only by design. Marked so the UI can say "Manual".
  const selectModel = useCallback((modelId: string) => {
    setSelectedModelId(modelId)
    setModelIsAutomatic(false)
  }, [])

  // Return to the auto-chosen model.
  const resetToAutoModel = useCallback(() => {
    const auto = pickAutoModel(models)
    if (auto) {
      setSelectedModelId(auto)
      setModelIsAutomatic(true)
    }
  }, [models])

  // Login
  const login = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.electronAPI.beginAuth()
      if (!res.success) {
        setError(res.error || 'Login failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  // Cancel login
  const cancelLogin = useCallback(async () => {
    await window.electronAPI.cancelAuth()
  }, [])

  // Logout
  const logout = useCallback(async () => {
    try {
      await window.electronAPI.logout()
      setStatus({ signedIn: false, account: null, needsReauth: false })
      setModels([])
      setQuota(null)
    } catch (err) {
      console.error('Logout failed:', err)
    }
  }, [])

  return {
    status,
    progress,
    quota,
    models,
    selectedModelId,
    modelIsAutomatic,
    loading,
    error,
    canPersist,
    login,
    cancelLogin,
    logout,
    selectModel,
    resetToAutoModel,
    refreshQuota
  }
}