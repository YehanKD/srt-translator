import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  AccountStatus,
  AuthProgress,
  QuotaSummary,
  AntigravityModel
} from '@shared/types'

const MODEL_STORAGE_KEY = 'srt-translator-selected-model'

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
  const [selectedModelId, setSelectedModelId] = useState<string>(() => {
    try {
      return localStorage.getItem(MODEL_STORAGE_KEY) || 'gemini-3.1-pro-low'
    } catch {
      return 'gemini-3.1-pro-low'
    }
  })
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
        // If selected model is not in the list, default to first or fallback
        if (res.data.length > 0) {
          const exists = res.data.some(m => m.id === selectedModelId)
          if (!exists) {
            setSelectedModelId(res.data[0].id)
          }
        }
      }
    } catch (err) {
      console.error('Failed to load models:', err)
    }
  }, [selectedModelId])

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

  // Persist selected model
  const selectModel = useCallback((modelId: string) => {
    setSelectedModelId(modelId)
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, modelId)
    } catch {
      // ignore
    }
  }, [])

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
    loading,
    error,
    canPersist,
    login,
    cancelLogin,
    logout,
    selectModel,
    refreshQuota
  }
}