import { app } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * File logging for a packaged app.
 *
 * WHY THIS EXISTS: launched from the app menu, stdout/stderr are discarded
 * entirely — so `console.error` went nowhere and a failure left no trace. Every
 * bug report therefore arrived as a screenshot with no detail, and diagnosing
 * one meant reproducing it by hand. This writes to a file the user can actually
 * find and send.
 *
 * Design notes:
 * - Never throws. Logging must not be able to break the app, so every
 *   filesystem call is wrapped. A read-only or full disk degrades to no file
 *   logging rather than crashing the main process.
 * - Rotates at ~2 MB, keeping one previous file, so it cannot grow without
 *   bound on a long-lived install.
 * - Synchronous writes on purpose: a crash immediately after a log line still
 *   leaves that line on disk, which is the whole point.
 */

const MAX_LOG_BYTES = 2 * 1024 * 1024 // 2 MB
const LOG_NAME = 'app.log'

let logPath: string | null = null
let disabled = false

function resolveLogPath(): string | null {
  if (logPath) return logPath
  try {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    logPath = join(dir, LOG_NAME)
    return logPath
  } catch {
    // Cannot resolve a writable location — logging is off for this run.
    disabled = true
    return null
  }
}

function rotateIfNeeded(path: string): void {
  try {
    if (!existsSync(path)) return
    const { size } = statSync(path)
    if (size < MAX_LOG_BYTES) return
    renameSync(path, `${path}.1`)
  } catch {
    // Rotation is best-effort; a failure just means the file keeps growing.
  }
}

function formatArg(value: unknown): string {
  if (value instanceof Error) {
    // Stack is the useful part for a crash; message alone rarely explains it.
    return value.stack || `${value.name}: ${value.message}`
  }
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function logLine(level: string, parts: unknown[]): void {
  if (disabled) return
  const path = resolveLogPath()
  if (!path) return
  try {
    // Rotate BEFORE appending, so the file always exists after a write. Doing it
    // afterwards renamed the file out from under the caller, leaving no app.log
    // until the next line arrived.
    rotateIfNeeded(path)
    const stamp = new Date().toISOString()
    const body = parts.map(formatArg).join(' ')
    appendFileSync(path, `${stamp} [${level}] ${body}\n`)
  } catch {
    // A failed write must never surface to the user.
  }
}

export const log = {
  info: (...parts: unknown[]): void => logLine('info', parts),
  warn: (...parts: unknown[]): void => logLine('warn', parts),
  error: (...parts: unknown[]): void => logLine('error', parts)
}

/** Where the log lives, for showing the user. */
export function logFilePath(): string | null {
  return resolveLogPath()
}

/**
 * Route console output into the log file as well.
 *
 * The app already uses console.warn/error for the handful of conditions worth
 * recording, so this captures those without touching every call site.
 */
export function captureConsole(): void {
  const originalError = console.error.bind(console)
  const originalWarn = console.warn.bind(console)

  console.error = (...args: unknown[]): void => {
    logLine('error', args)
    originalError(...args)
  }
  console.warn = (...args: unknown[]): void => {
    logLine('warn', args)
    originalWarn(...args)
  }
}

/**
 * Record anything that would otherwise kill or silently break the app.
 *
 * Without these, an unhandled rejection in the main process simply vanishes —
 * the window keeps running in a broken state and the user sees nothing.
 */
export function installCrashHandlers(): void {
  process.on('uncaughtException', (err) => {
    logLine('fatal', ['uncaughtException', err])
  })

  process.on('unhandledRejection', (reason) => {
    logLine('fatal', ['unhandledRejection', reason])
  })
}
