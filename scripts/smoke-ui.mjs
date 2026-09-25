// Headless-Chrome smoke test over CDP (no Playwright dependency).
// Drives the real UI and asserts what actually renders: the signed-out
// redirect, role-free nav, manager-only Setup, and the derived-status
// lifecycle copy.
//
// Signed-out checks always run. The authenticated checks need a real login:
//   pnpm dev
//   SMOKE_EMAIL=you@college.edu SMOKE_PASSWORD=… pnpm verify:ui
//
// Requires a local Chrome install; set CHROME_PATH to override detection.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!CHROME) {
  console.log('SKIP  no Chrome found — set CHROME_PATH to run the UI smoke test')
  process.exit(0)
}

const PORT = 9333
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:5173'
const EMAIL = process.env.SMOKE_EMAIL
const PASSWORD = process.env.SMOKE_PASSWORD

try {
  const probe = await fetch(BASE, { signal: AbortSignal.timeout(5000) })
  if (!probe.ok) throw new Error(`HTTP ${probe.status}`)
} catch (err) {
  console.log(`SKIP  dev server not reachable at ${BASE} (${err.message}) — run \`pnpm dev\` first`)
  process.exit(0)
}

const profileDir = mkdtempSync(join(tmpdir(), 'ea-chrome-'))

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--disable-gpu',
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      return (await res.json()).webSocketDebuggerUrl
    } catch {
      await sleep(250)
    }
  }
  throw new Error('Chrome did not expose a debugging endpoint')
}

const ws = new WebSocket(await wsUrl())
await new Promise((r) => ws.addEventListener('open', r, { once: true }))

let nextId = 1
const pending = new Map()
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(msg.error.message))
    else resolve(msg.result)
  }
})
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
// The sidebar is lg-only, so use a desktop viewport to exercise real chrome.
await send(
  'Emulation.setDeviceMetricsOverride',
  { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
  sessionId,
)

async function goto(url) {
  await send('Page.navigate', { url }, sessionId)
  await sleep(3000)
}

async function evaluate(expression) {
  const r = await send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  )
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expression)
  return r.result.value
}

const text = () => evaluate('document.body.innerText')

// Polls until the expected text appears, instead of guessing a fixed delay.
async function waitForText(needle, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await text()).includes(needle)) return true
    await sleep(400)
  }
  return false
}

// Fills a React-controlled input the way a user would, so onChange fires.
const setInput = (id, value) => evaluate(`(() => {
  const el = document.getElementById(${JSON.stringify(id)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`)

// Event cards only: inside <main>, and not the sidebar's "Create Event" link.
const CARD_SEL = 'main a[href^="/events/"]:not([href$="/create"])'

async function waitForCards(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await evaluate(`document.querySelectorAll('${CARD_SEL}').length`)) > 0) return true
    // Loading finished with no cards means the project genuinely has no events.
    if (
      (await evaluate('document.querySelectorAll("main .animate-pulse").length')) === 0 &&
      (await text()).includes('No events match')
    ) {
      return false
    }
    await sleep(500)
  }
  return false
}

let failed = 0
const check = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -> ${detail}`}`)
}
const skip = (name, why) => console.log(`SKIP  ${name} — ${why}`)

try {
  // ── 1. Signed out lands on the login screen (regression guard) ─────────
  // The auth listener used to set loading=true on a null user, which left
  // ProtectedRoute spinning forever instead of redirecting to /login.
  await goto(BASE + '/')
  await waitForText('Sign in to your account', 15000)
  let body = await text()
  check(
    'signed-out visitor is redirected to /login',
    (await evaluate('location.pathname')) === '/login' && body.includes('Sign in to your account'),
    `pathname=${await evaluate('location.pathname')} spinner=${await evaluate(`!!document.querySelector('.animate-spin')`)}`,
  )
  check('login page has no role picker', !body.includes('Head of Department'))
  check('login page has no test-mode backdoor', !body.includes('Test Mode') && !body.includes('TEST'))

  // ── 2. Everything below needs a signed-in teacher ──────────────────────
  if (!EMAIL || !PASSWORD) {
    skip(
      'authenticated suite (nav, Setup, create form, lifecycle, ownership)',
      'set SMOKE_EMAIL and SMOKE_PASSWORD to run it',
    )
    console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILURE(S)`)
    ws.close(); chrome.kill()
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 })
    process.exit(failed === 0 ? 0 : 1)
  }

  await evaluate(`document.getElementById('email').value = ''`)
  await setInput('email', EMAIL)
  await setInput('password', PASSWORD)
  await evaluate(`document.querySelector('form button[type=submit]').click()`)

  const signedIn = await waitForText('Dashboard', 20000)
  if (!signedIn) {
    const err = await evaluate(
      `document.querySelector('.bg-red-50, [role=alert]')?.innerText ?? '(no error shown)'`,
    )
    check('sign in succeeds', false, `still on ${await evaluate('location.pathname')} — ${err}`)
    throw new Error('sign-in failed')
  }
  check('sign in succeeds', true)
  body = await text()

  // ── 3. One user type: no role dashboards, manager-only Setup ───────────
  check('no "College Administrator" role label', !body.includes('College Administrator'))
  check('no "Head of Department" role label', !body.includes('Head of Department'))
  check('no separate Analytics page', !body.includes('Analytics'))
  const isManager = body.includes('Setup')
  console.log(`INFO  signed in as ${isManager ? 'a manager' : 'a non-manager'}`)

  // ── 4. Events page: sees all events, has a "only mine" scope ────────────
  await goto(BASE + '/events')
  body = await text()
  check('events page renders', body.includes('Events'), body.slice(0, 120))
  check('has Only mine filter', body.includes('Only mine'))
  check('can filter by department', body.includes('All Departments'))

  // ── 5. Create page: no status dropdown, status explained as derived ────
  await goto(BASE + '/events/create')
  body = await text()
  const selectCount = await evaluate('document.querySelectorAll("select").length')
  check(
    'status dropdown removed (only department remains)',
    selectCount === 1,
    `expected 1 select, found ${selectCount}`,
  )
  check('create form renders', body.includes('Create Event'), body.slice(0, 120))
  check(
    'status explained as derived from date',
    body.includes('worked out automatically') || body.includes('based on the date'),
  )
  check('guest speaker now settable', body.includes('Guest / Speaker'))
  check('participants now settable', body.includes('Participants'))

  // ── 6. Event detail + edit gating (needs at least one event) ───────────
  await goto(BASE + '/events')
  await waitForCards()
  const probe = await evaluate(
    `document.querySelector('${CARD_SEL}')?.getAttribute('href') ?? null`,
  )
  if (!probe) {
    skip('event detail, owner gating, cancel & report flows', 'no events in the project')
  } else {
    await goto(BASE + probe)
    await waitForText('Back to events')
    const detail = await text()
    check('event details renders', detail.includes('About this event') || detail.includes('Back to events'), detail.slice(0, 160))
    check('lifecycle explanation shown', detail.includes('worked out from the date'), detail.slice(0, 200))
    const hasEdit = detail.includes('Edit')
    const saysViewOnly = detail.includes('not edit')
    check('ownership gated correctly', hasEdit ? true : saysViewOnly, `edit=${hasEdit} viewOnly=${saysViewOnly}`)
    check('no dead "replace report via Edit" hint', !detail.includes('replace report via Edit'))

    await goto(BASE + probe + '/edit')
    await waitForText('Back to event')
    const editBody = await text()
    if (hasEdit) {
      check('owner gets the edit form', editBody.includes('Save Changes'), editBody.slice(0, 200))
    } else {
      check('edit route blocks a non-owner', editBody.includes('You cannot edit this event'), editBody.slice(0, 200))
      check('non-owner gets no save form', !editBody.includes('Save Changes'), 'form leaked')
    }
  }

  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILURE(S)`)
} catch (err) {
  console.error('harness error:', err.message)
  failed++
} finally {
  try { ws.close() } catch { /* already closed */ }
  chrome.kill()
  // Chrome can still be flushing its profile; cleanup failure must not mask results.
  try { rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 }) } catch { /* temp dir */ }
}

process.exit(failed === 0 ? 0 : 1)
