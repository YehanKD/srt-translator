import { useCallback, useEffect, useRef, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { IconSun, IconMoon } from './Icons'

/**
 * Theme toggle.
 *
 * ── Alignment ──────────────────────────────────────────────────────────────
 * `.btn-icon` is `display: flex`, so the two icons cannot share a grid cell —
 * as flex children they laid out SIDE BY SIDE, which pushed the visible glyph
 * off centre and made it jump 16px sideways on every swap. They are now
 * absolutely positioned onto the same centre point, so the glyph sits in a
 * fixed spot and never moves.
 *
 * ── Animation (animate skill) ──────────────────────────────────────────────
 * Gate       — occasional, so an expressive animation is allowed.
 * Purpose    — "state indication": the control shows which mode is active, and
 *              the swap needs bridging so it doesn't read as two icons
 *              overlapping.
 * Tool       — CSS transitions. Rapid toggling is likely and keyframes would
 *              restart from zero each time; transitions retarget mid-flight.
 * Properties — clip-path (the sanctioned fourth), opacity, transform. No
 *              layout properties.
 * Duration   — icon wipe 180ms, riding the same beat as the theme reveal so the
 *              two read as one motion.
 * Easing     — strong --ease-out; fast where the system responds.
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const [wiping, setWiping] = useState(false)
  const timer = useRef<number | null>(null)

  const isDark = theme === 'dark'

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      // The reveal expands from this button's centre.
      const r = e.currentTarget.getBoundingClientRect()
      const origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 }

      // Restart the wipe even mid-flight: drop the flag, then re-add it on the
      // next frame so the transition retargets from the top instead of being
      // ignored as a no-op.
      setWiping(false)
      requestAnimationFrame(() => {
        setWiping(true)
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setWiping(false), 240)
      })

      toggle(origin)
    },
    [toggle]
  )

  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode'

  const iconCls =
    'pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[clip-path,opacity] duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)]'

  return (
    <button
      onClick={handleClick}
      className="btn-icon relative overflow-hidden"
      title={label}
      aria-label={label}
      aria-pressed={isDark}
    >
      {/* Outgoing icon: clipped away upward as the incoming one wipes in. */}
      <span
        className={`${iconCls} text-text-muted`}
        style={{
          clipPath: wiping ? 'inset(0 0 100% 0)' : 'inset(0 0 0 0)',
          opacity: wiping ? 0 : 1
        }}
        aria-hidden="true"
      >
        {isDark ? <IconMoon size={16} /> : <IconSun size={16} />}
      </span>

      <span
        className={`${iconCls} text-teal-text`}
        style={{
          clipPath: wiping ? 'inset(0 0 0 0)' : 'inset(100% 0 0 0)',
          opacity: wiping ? 1 : 0
        }}
        aria-hidden="true"
      >
        {isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
      </span>
    </button>
  )
}
