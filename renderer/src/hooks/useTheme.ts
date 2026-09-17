import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'srt-translator.theme'
/** Must match .theme-switching in globals.css (the non-View-Transition fallback). */
const FALLBACK_MS = 220

export interface RevealOrigin {
  x: number
  y: number
}

/**
 * Theme is a manual choice, not an OS mirror — explicit control, persisted
 * across launches, defaulting to light.
 *
 * ── Animation decision (animate skill) ──────────────────────────────────────
 * Gate       — occasional (a few times a day), so an expressive animation is
 *              allowed. This is not a 100+/day keyboard action.
 * Purpose    — "state indication" plus "preventing a jarring change": the flip
 *              repaints every surface at once, so it needs bridging, and the
 *              wipe should make the change legible rather than instantaneous.
 * Tool       — View Transitions API, for the circular reveal. It's the only way
 *              to clip an entire rendered snapshot, which is what "expand out
 *              from the button" requires; a hand-rolled overlay would mean
 *              duplicating the whole UI.
 * Properties — clip-path (the sanctioned fourth). No layout properties.
 * Duration   — 400ms. Deliberately above the usual 300ms ceiling: this is a
 *              rare, expressive moment, not a routine UI transition.
 * Easing     — strong --ease-out, so it leaves fast and settles.
 *
 * ── Progressive enhancement ────────────────────────────────────────────────
 *   1. View Transitions + motion allowed → circular reveal from the button.
 *   2. No View Transitions             → plain colour crossfade.
 *   3. prefers-reduced-motion          → instant swap, no animation.
 *
 * WHY THE ATTRIBUTE IS WRITTEN IMPERATIVELY:
 * View Transitions snapshot the DOM synchronously inside the callback. React
 * state updates are batched and land after that snapshot, so the theme has to
 * be applied to <html> directly for the transition to capture it. State is
 * updated alongside so React stays in sync.
 */
function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* localStorage can throw in a sandboxed renderer — fall through to default */
  }
  return 'light'
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function supportsViewTransitions(): boolean {
  return typeof document.startViewTransition === 'function'
}

function applyTheme(t: Theme): void {
  document.documentElement.setAttribute('data-theme', t)
  try {
    localStorage.setItem(STORAGE_KEY, t)
  } catch {
    /* non-fatal: the theme still applies for this session */
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readStored)

  // Paint the stored theme once on mount. Later changes are applied
  // imperatively by setTheme so View Transitions can capture them.
  useEffect(() => {
    applyTheme(theme)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setTheme = useCallback((next: Theme, origin?: RevealOrigin) => {
    const root = document.documentElement

    // 3. Reduced motion: swap with no animation.
    if (prefersReducedMotion()) {
      applyTheme(next)
      setThemeState(next)
      return
    }

    // 2. No View Transitions (or no origin): fall back to the colour crossfade.
    if (!supportsViewTransitions() || !origin) {
      root.classList.add('theme-switching')
      void root.offsetHeight // commit the transition before the colours change
      applyTheme(next)
      setThemeState(next)
      window.setTimeout(() => root.classList.remove('theme-switching'), FALLBACK_MS)
      return
    }

    // 1. Circular reveal expanding from the button.
    // Radius to the farthest viewport corner, so the circle always covers it.
    const r = Math.hypot(
      Math.max(origin.x, window.innerWidth - origin.x),
      Math.max(origin.y, window.innerHeight - origin.y)
    )
    root.style.setProperty('--vt-x', `${origin.x}px`)
    root.style.setProperty('--vt-y', `${origin.y}px`)
    root.style.setProperty('--vt-r', `${r}px`)
    root.classList.add('theme-reveal')

    const transition = document.startViewTransition(() => {
      applyTheme(next)
      setThemeState(next)
    })

    const cleanup = () => root.classList.remove('theme-reveal')
    transition.finished.then(cleanup, cleanup)
  }, [])

  const toggle = useCallback(
    (origin?: RevealOrigin) => {
      setTheme(theme === 'light' ? 'dark' : 'light', origin)
    },
    [theme, setTheme]
  )

  return { theme, setTheme, toggle }
}
