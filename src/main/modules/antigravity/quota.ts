import { getAntigravityContentHeaders } from './headers'
import { resolveAntigravityModelId, getAntigravityModelName, isDiscoverableAntigravityModelId } from './catalog'
import {
  ANTIGRAVITY_FETCH_AVAILABLE_MODELS_URLS,
  ANTIGRAVITY_RUNTIME_BASE_URLS,
  ANTIGRAVITY_QUOTA_CACHE_TTL_MS
} from './constants'
import type { ModelQuota, WeeklyQuota } from '@shared/types'

// ── Types ──────────────────────────────────────────────────────────────────────────────

interface UsageQuotaRaw {
  used: number
  total: number
  resetAt: string | null
  remainingPercentage: number
  unlimited: boolean
  fractionReported: boolean
  quotaSource: 'retrieveUserQuota' | 'fetchAvailableModels'
  displayName?: string
}

// ── Cache ──────────────────────────────────────────────────────────────────────────────

const quotaCache = new Map<string, { data: unknown; fetchedAt: number }>()
const inflight = new Map<string, Promise<unknown>>()

function cacheKey(accessToken: string, projectId: string | null): string {
  return `${accessToken.substring(0, 16)}:${projectId || 'default'}`
}

function isFresh(key: string): boolean {
  const entry = quotaCache.get(key)
  return !!entry && Date.now() - entry.fetchedAt < ANTIGRAVITY_QUOTA_CACHE_TTL_MS
}

async function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  forceRefresh = false
): Promise<T> {
  if (!forceRefresh && isFresh(key)) {
    return quotaCache.get(key)!.data as T
  }
  const inFlight = inflight.get(key)
  if (inFlight) return inFlight as Promise<T>

  const promise = fetcher()
    .then((data) => {
      quotaCache.set(key, { data, fetchedAt: Date.now() })
      return data
    })
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, promise)
  return promise
}

// ── Fetchers ────────────────────────────────────────────────────────────────────────────

export async function fetchAvailableModels(
  accessToken: string,
  projectId: string | null,
  forceRefresh = false
): Promise<Record<string, unknown>> {
  const key = `models:${cacheKey(accessToken, projectId)}`
  return withCache(key, async () => {
    const headers = getAntigravityContentHeaders(accessToken)
    const body = projectId ? { project: projectId } : {}

    for (const url of ANTIGRAVITY_FETCH_AVAILABLE_MODELS_URLS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000)
        })
        if (res.status === 403) {
          return { __forbidden: true }
        }
        if (!res.ok) continue
        return await res.json() as Record<string, unknown>
      } catch {
        // try next
      }
    }
    throw new Error('Failed to fetch available models from all endpoints')
  }, forceRefresh)
}

export async function retrieveUserQuota(
  accessToken: string,
  projectId: string,
  forceRefresh = false
): Promise<Record<string, unknown>> {
  if (!projectId) return {}
  const key = `quota:${cacheKey(accessToken, projectId)}`
  return withCache(key, async () => {
    const headers = getAntigravityContentHeaders(accessToken)
    const body = { project: projectId }

    for (const baseUrl of ANTIGRAVITY_RUNTIME_BASE_URLS) {
      try {
        const url = `${baseUrl}/v1internal:retrieveUserQuota`
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000)
        })
        if (!res.ok) continue
        return await res.json() as Record<string, unknown>
      } catch {
        // try next
      }
    }
    return {}
  }, forceRefresh)
}

export async function retrieveUserQuotaSummary(
  accessToken: string,
  projectId: string,
  forceRefresh = false
): Promise<Record<string, unknown>> {
  if (!projectId) return {}
  const key = `summary:${cacheKey(accessToken, projectId)}`
  return withCache(key, async () => {
    const headers = getAntigravityContentHeaders(accessToken)
    const body = { project: projectId }

    for (const baseUrl of ANTIGRAVITY_RUNTIME_BASE_URLS) {
      try {
        const url = `${baseUrl}/v1internal:retrieveUserQuotaSummary`
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000)
        })
        if (!res.ok) continue
        return await res.json() as Record<string, unknown>
      } catch {
        // try next
      }
    }
    return {}
  })
}

// ── Normalizers ────────────────────────────────────────────────────────────────────────

function parseResetTime(val: unknown): string | null {
  if (!val) return null
  if (typeof val === 'string') {
    const d = new Date(val)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (typeof val === 'number') {
    const d = new Date(val < 1e12 ? val * 1000 : val)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

function normalizeQuotaBucket(
  bucket: Record<string, unknown>,
  modelId: string,
  source: 'retrieveUserQuota' | 'fetchAvailableModels'
): ModelQuota | null {
  const rawFraction = typeof bucket.remainingFraction === 'number' ? bucket.remainingFraction : -1
  if (rawFraction < 0) {
    // No fraction reported – unknown quota
    return null
  }
  const fraction = Math.max(0, Math.min(1, rawFraction))
  const resetAt = parseResetTime(bucket.resetTime)
  const unlimited = !resetAt && fraction >= 1
  const total = 1000
  const remaining = Math.round(total * fraction)
  const used = unlimited ? 0 : Math.max(0, total - remaining)

  return {
    id: modelId,
    name: getAntigravityModelName(modelId),
    used,
    total: unlimited ? 0 : total,
    remainingPercentage: unlimited ? 100 : fraction * 100,
    resetAt,
    unlimited,
    fractionReported: true
  }
}

export function parseAvailableModels(
  data: Record<string, unknown>,
  userQuotaData: Record<string, unknown>
): ModelQuota[] {
  const models = data.models as Record<string, unknown> | undefined
  if (!models) return []

  const userQuotaMap = new Map<string, Record<string, unknown>>()
  const buckets = userQuotaData.buckets as Array<Record<string, unknown>> | undefined
  if (Array.isArray(buckets)) {
    for (const bucket of buckets) {
      const id = String(bucket.modelId || '').trim()
      if (id) userQuotaMap.set(id, bucket)
    }
  }

  const result: ModelQuota[] = []
  for (const [rawId, info] of Object.entries(models)) {
    const infoObj = info as Record<string, unknown>
    if (infoObj.isInternal === true) continue

    const modelId = resolveAntigravityModelId(rawId)
    if (!modelId || !isDiscoverableAntigravityModelId(modelId)) continue

    const quotaInfo = infoObj.quotaInfo as Record<string, unknown> | undefined
    if (!quotaInfo || Object.keys(quotaInfo).length === 0) continue

    // Prefer retrieveUserQuota if available
    const liveBucket = userQuotaMap.get(modelId)
    const source = liveBucket ? 'retrieveUserQuota' : 'fetchAvailableModels'
    const bucketData = liveBucket || quotaInfo

    const normalized = normalizeQuotaBucket(bucketData, modelId, source)
    if (normalized) result.push(normalized)
  }

  // Add any userQuota buckets not in the static catalog (new models)
  for (const [modelId, bucket] of userQuotaMap) {
    if (result.some((m) => m.id === modelId)) continue
    if (!isDiscoverableAntigravityModelId(modelId)) continue
    const normalized = normalizeQuotaBucket(bucket, modelId, 'retrieveUserQuota')
    if (normalized) result.push(normalized)
  }

  return result
}

export function parseWeeklyQuotas(data: Record<string, unknown>): WeeklyQuota[] {
  const result: WeeklyQuota[] = []
  const groups = Array.isArray(data.groups)
    ? data.groups
    : Array.isArray((data.quotaSummary as Record<string, unknown>)?.groups)
      ? ((data.quotaSummary as Record<string, unknown>).groups as unknown[])
      : []

  for (const groupRaw of groups) {
    const group = groupRaw as Record<string, unknown>
    const buckets = Array.isArray(group.buckets) ? group.buckets : []
    const weeklyBucket = buckets.find(
      (b) =>
        b && typeof b === 'object' && /weekly/i.test(String((b as Record<string, unknown>).bucketId || '') + String((b as Record<string, unknown>).displayName || ''))
    ) as Record<string, unknown> | undefined

    if (!weeklyBucket || weeklyBucket.disabled === true) continue

    const key = String(group.displayName || '')
      .toLowerCase()
      .replace(/\bmodels?\b/g, '')
      .replace(/\band\b/g, ' ')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
    if (!key) continue

    const rawFraction = typeof weeklyBucket.remainingFraction === 'number' ? weeklyBucket.remainingFraction : -1
    if (rawFraction < 0) continue

    const fraction = Math.max(0, Math.min(1, rawFraction))
    const resetAt = parseResetTime(weeklyBucket.resetTime)
    const unlimited = !resetAt && fraction >= 1
    const total = 1000
    const remaining = Math.round(total * fraction)
    const used = unlimited ? 0 : Math.max(0, total - remaining)

    result.push({
      key: `${key}_weekly`,
      displayName: String(group.displayName || '').trim() || key,
      used,
      total: unlimited ? 0 : total,
      remainingPercentage: unlimited ? 100 : fraction * 100,
      resetAt,
      unlimited
    })
  }

  return result
}

// ── Public entry ──────────────────────────────────────────────────────────────────────

export async function fetchQuota(
  accessToken: string,
  projectId: string | null,
  forceRefresh = false
): Promise<{ models: ModelQuota[]; weekly: WeeklyQuota[]; plan: string }> {
  if (!accessToken || !projectId) {
    return { models: [], weekly: [], plan: 'Free' }
  }

  const [modelsData, quotaData, summaryData] = await Promise.all([
    fetchAvailableModels(accessToken, projectId, forceRefresh).catch(() => ({})),
    retrieveUserQuota(accessToken, projectId, forceRefresh).catch(() => ({})),
    retrieveUserQuotaSummary(accessToken, projectId, forceRefresh).catch(() => ({}))
  ])

  const models = parseAvailableModels(modelsData, quotaData)
  const weekly = parseWeeklyQuotas(summaryData)

  // Extract plan from modelsData or quotaData
  let plan = 'Free'
  const modelsRecord = modelsData as Record<string, unknown>
  const quotaRecord = quotaData as Record<string, unknown>
  const tier = (modelsRecord.tier ?? quotaRecord.currentTier ?? modelsRecord.currentTier) as
    | Record<string, unknown>
    | undefined
  if (tier?.id && typeof tier.id === 'string') {
    const upper = tier.id.toUpperCase()
    if (upper.includes('ULTRA')) plan = 'Ultra'
    else if (upper.includes('PRO') || upper.includes('PREMIUM') || upper.includes('GOOGLE_ONE')) plan = 'Pro'
    else if (upper.includes('ENTERPRISE')) plan = 'Enterprise'
    else if (upper.includes('BUSINESS') || upper.includes('STANDARD')) plan = 'Business'
    else if (upper.includes('PLUS')) plan = 'Plus'
    else if (upper.includes('LITE')) plan = 'Lite'
  }

  return { models, weekly, plan }
}