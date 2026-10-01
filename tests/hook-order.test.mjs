import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { projectPath } from './helpers/load-module.mjs'

/**
 * React requires hooks to run in the SAME ORDER on every render. A hook placed
 * after an early `return` at the top level of a component is skipped on the
 * render that returns early, then called on the next one, which throws "Rendered
 * more hooks than during the previous render" and blanks the whole window.
 *
 * This shipped once: an auto-save effect sat below `if (!progress && !error &&
 * !hasEntries) return null` in JobStrip, so the window went black the moment a
 * translation started. It typechecked, and every other test passed — the failure
 * only appears at runtime, on the second render.
 *
 * The check below tracks brace depth so it only considers `return`s at the
 * component's own top level. A `return` inside a `try`, an `if` block, or a
 * callback is legal and must not be flagged — a naive line scan reports those and
 * is worse than useless, because a check that cries wolf stops being read.
 */

const HOOK_RE = /\buse(State|Effect|Ref|Memo|Callback|Reducer|Context|LayoutEffect|ImperativeHandle)\s*[(<]/
const EARLY_RETURN_RE = /^\s*(?:if\s*\(.*\)\s*)?return\b/

/** Strip strings and comments so braces inside them do not skew the depth count. */
function stripNoise(line) {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/\/\*.*?\*\//g, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

/**
 * Find hooks called after a top-level early return.
 *
 * Depth is measured from the component body: the opening `{` of the function is
 * depth 1, so a statement at depth 1 is a top-level statement.
 */
function findHookOrderViolations(source, label) {
  const lines = source.split('\n')
  const problems = []

  let depth = 0
  let insideComponent = false
  let earlyReturnAt = null
  let componentDepth = null

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = stripNoise(raw)

    // A component is a top-level `export function Name(` or `function Name(`.
    if (!insideComponent && /^(?:export\s+)?function\s+[A-Z]/.test(line.trim())) {
      insideComponent = true
      componentDepth = null
    }

    // Once inside, the body starts at the first `{` that ends the signature.
    if (insideComponent && componentDepth === null) {
      const opens = (line.match(/\{/g) ?? []).length
      if (opens > 0) componentDepth = depth + 1
    }

    const isTopLevel = insideComponent && componentDepth !== null && depth === componentDepth

    if (isTopLevel && earlyReturnAt === null && EARLY_RETURN_RE.test(line)) {
      earlyReturnAt = i + 1
    }

    if (isTopLevel && earlyReturnAt !== null && HOOK_RE.test(line)) {
      problems.push(`${label}:${i + 1} calls a hook after the top-level early return at line ${earlyReturnAt}`)
    }

    depth += (line.match(/\{/g) ?? []).length
    depth -= (line.match(/\}/g) ?? []).length

    if (insideComponent && componentDepth !== null && depth < componentDepth) {
      insideComponent = false
      componentDepth = null
      earlyReturnAt = null
    }
  }

  return problems
}

function componentFiles() {
  const dir = projectPath('renderer/src/components')
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => join(dir, f))
  files.push(projectPath('renderer/src/App.tsx'))
  return files
}

test('no hook is called after a top-level early return in any component', () => {
  const problems = []
  for (const file of componentFiles()) {
    const label = file.replace(projectPath('') + '/', '')
    problems.push(...findHookOrderViolations(readFileSync(file, 'utf8'), label))
  }
  assert.deepEqual(problems, [], `hooks must precede every early return:\n${problems.join('\n')}`)
})

test('the detector actually catches the bug it exists for', () => {
  // Guards against the check silently passing because it matches nothing. This
  // is the exact shape that shipped and blanked the window.
  const broken = `
export function Widget({ items }: Props) {
  const [n, setN] = useState(0)
  if (!items) return null
  const ref = useRef(null)
  useEffect(() => {}, [])
  return null
}
`
  const found = findHookOrderViolations(broken, 'broken.tsx')
  assert.equal(found.length, 2, `expected the detector to flag both hooks, got: ${JSON.stringify(found)}`)
})

test('the detector ignores returns nested inside blocks and callbacks', () => {
  // A return inside a try/if/callback is legal; flagging it would make the check
  // untrustworthy.
  const fine = `
export function Widget() {
  const [n, setN] = useState(0)
  const go = async () => {
    try {
      if (!n) return
      const x = 1
      if (!x) return
    } catch {}
  }
  useEffect(() => {}, [])
  return null
}
`
  assert.deepEqual(findHookOrderViolations(fine, 'fine.tsx'), [])
})

test('the auto-save effect in JobStrip precedes its early return', () => {
  // Named specifically because this is the case that regressed.
  const lines = readFileSync(projectPath('renderer/src/components/JobStrip.tsx'), 'utf8').split('\n')
  const hook = lines.findIndex((l) => l.includes('autoSavedFor') && HOOK_RE.test(l))
  const effect = lines.findIndex((l, i) => i > hook && /^\s{2}useEffect\(/.test(l))
  const earlyReturn = lines.findIndex((l) => /^\s{2}if \(!progress && !error && !hasEntries\) return null/.test(l))

  assert.ok(hook > -1, 'the auto-save ref should exist')
  assert.ok(effect > -1, 'the auto-save effect should exist')
  assert.ok(earlyReturn > -1, 'the early return should exist')
  assert.ok(
    hook < earlyReturn && effect < earlyReturn,
    `auto-save hooks must run before the early return (hook ${hook + 1}, effect ${effect + 1}, return ${earlyReturn + 1})`
  )
})
