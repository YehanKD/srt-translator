import {
  ANTIGRAVITY_ARCH,
  ANTIGRAVITY_IDE_VERSION,
  ANTIGRAVITY_OS_TYPE
} from './constants'

export function antigravityIdeUserAgent(version = ANTIGRAVITY_IDE_VERSION): string {
  return `antigravity/ide/${version} ${ANTIGRAVITY_OS_TYPE}/${ANTIGRAVITY_ARCH}`
}

export function antigravityIdeNodeUserAgent(version = ANTIGRAVITY_IDE_VERSION): string {
  return `antigravity/${version} ${ANTIGRAVITY_OS_TYPE}/${ANTIGRAVITY_ARCH} google-api-nodejs-client/10.3.0`
}

/**
 * Headers for Code Assist data-plane calls (loadCodeAssist, onboardUser,
 * fetchAvailableModels, retrieveUserQuota*, streamGenerateContent).
 */
export function getAntigravityContentHeaders(
  accessToken?: string | null
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': antigravityIdeUserAgent()
  }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  return headers
}

export function getAntigravityLoadCodeAssistMetadata(): Record<string, string> {
  return { ideType: 'ANTIGRAVITY' }
}
