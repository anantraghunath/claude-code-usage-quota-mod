import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionRateLimit, SessionUsage } from 'claude-code'

const NOW = Date.parse('2026-10-04T06:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const SURFACES = ['terminal', 'desktop'] as const

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

const CATEGORIES = [
  { name: 'System prompt', tokens: 4_000, kind: 'used' },
  { name: 'System tools', tokens: 34_000, kind: 'used' },
  { name: 'MCP tools', tokens: 17_000, kind: 'used' },
  { name: 'Skills', tokens: 6_000, kind: 'used' },
  { name: 'Messages', tokens: 97_000, kind: 'used' },
  { name: 'Memory files', tokens: 1_000, kind: 'used' }, // 0.1%: hidden from the legend
  { name: 'Deferred tools', tokens: 50_000, kind: 'deferred', isDeferred: true },
  { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
  { name: 'Free space', tokens: 808_000, kind: 'free' },
].map(c => ({ color: 'text', isDeferred: false, ...c }))

function usage(rateLimits: SessionRateLimit[]): SessionUsage {
  return {
    startedAt: NOW - HOUR,
    context: {
      window: 1_000_000,
      tokens: 158_000,
      percent: 16,
      breakdown: {
        categories: CATEGORIES,
        totalTokens: 159_000,
        maxTokens: 1_000_000,
        rawMaxTokens: 1_000_000,
        percentage: 16,
      } as never,
    },
    rateLimits,
  }
}

const iso = (ms: number) => new Date(NOW + ms).toISOString()

function world(on: On, rateLimits: SessionRateLimit[], status: (string | undefined)[] = []) {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.usage', () => ({ value: usage(rateLimits) }))
  answerRest(on, status)
}

// what the engine answers beneath the plugin, the plan's own hooks left to the test
function answerRestNoPlan(on: On) {
  on('session.measure', () => ({ changed: [] }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
}

// no first-party login: the plan's usage endpoint is not asked
function noPlan(on: On) {
  on('session.authorize', () => ({ value: null }))
}

// what the engine answers beneath the plugin: its own (empty) band, the status line
function answerRest(on: On, status: (string | undefined)[]) {
  noPlan(on)
  on('session.measure', () => ({ changed: [] }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('ui.status', (_$, e) => {
    status.push(e.text)
    return { value: undefined }
  })
}

const MEASURE = { context: { window: 1_000_000, tokens: 158_000, percent: 16 }, rateLimits: [] }

// the % field is drawn afresh after every set, under a new key
async function fieldKey(ui: { find: (q: { type: 'Input' }) => Promise<{ props: { key?: string } } | undefined> }): Promise<string> {
  return String((await ui.find({ type: 'Input' }))?.props.key)
}

test('draws the band on track', async ($, on) => {
  world(on, [
    { kind: 'five_hour', percentUsed: 8, resetsAt: iso(3 * HOUR + 24 * MIN) },
    { kind: 'seven_day', percentUsed: 46, resetsAt: iso(3 * 24 * HOUR + 7 * HOUR) },
  ])
  await $.session.measure(MEASURE)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-quota', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ text: /^On track\. You should reach Wednesday's reset with room to spare\.$/ })).toBeDefined()
    expect(await ui.find({ text: '16% used' })).toBeDefined()
    expect(await ui.find({ text: '809k free of 1M' })).toBeDefined()
    expect(await ui.find({ text: 'Messages' })).toBeDefined()
    expect(await ui.find({ text: '96k' })).toBeDefined()
    // three groups: Messages, Tools (34k + 17k), Other (4k + 6k + 1k), Other in grey
    expect(await ui.find({ type: 'Text', text: 'Tools' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '51k' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: 'Other' }))?.props.color).toBe('#8b90a0')
    expect(await ui.find({ type: 'Text', text: '11k' })).toBeDefined()
    expect(await ui.find({ text: 'Memory files' })).toBeUndefined()
    // only the top three categories are listed
    expect(await ui.find({ text: 'Skills' })).toBeUndefined()
    expect(await ui.find({ text: 'System prompt' })).toBeUndefined()
    expect(await ui.find({ text: 'Deferred tools' })).toBeUndefined()
    expect(await ui.find({ text: '5 Hour' })).toBeDefined()
    expect(await ui.find({ text: 'Weekly' })).toBeDefined()
    expect(await ui.find({ text: 'On pace for about 81% by reset – resets in 3d 7h' })).toBeDefined()
    expect(await ui.find({ text: 'On pace for about 32% by reset – resets in 3h 24m' })).toBeDefined()
    expect(await ui.find({ text: /·/ })).toBeUndefined()
    // legend runs highest first
    const names = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    const order = ['Messages', 'Tools', 'Other'].map(n => names.indexOf(n))
    expect(order).toEqual([...order].sort((a, b) => a - b))

    // every flexGrow is finite, within the engine's limit, and never a raw token count
    const boxes = await ui.findAll({ type: 'Box' })
    for (const box of boxes) {
      const grow = box.props.flexGrow
      if (grow === undefined) continue
      expect(Number.isFinite(grow)).toBe(true)
      expect(grow as number).toBeLessThanOrEqual(10000)
      expect(grow as number).toBeGreaterThanOrEqual(1)
    }
    if (surface === 'desktop') {
      // thin Svg bars: the context bar and the two rate bars, no flexGrow segments
      // (the auto compact switch is an Svg too: left out here)
      const svgs = (await ui.findAll({ type: 'Svg' })).filter(svg => !/^Auto compact/.test(String(svg.props.alt)))
      // the two rate bars (left, each with a forecast tick), then the context bar (right)
      expect(svgs).toHaveLength(3)
      expect(svgs[0]?.props.alt).toMatch(/^5 Hour/)
      expect(svgs[1]?.props.alt).toMatch(/^Weekly/)
      expect(svgs[2]?.props.alt).toMatch(/^Context/)
      expect(svgs[2]?.props.height).toBe(7.5)
      expect(String(svgs[0]?.props.source)).toContain('fill="#8b90a0"')
      expect(String(svgs[1]?.props.source)).toContain('fill="#8b90a0"')
      expect(boxes.filter(b => typeof b.props.flexGrow === 'number')).toHaveLength(0)
    } else {
      // 5 hour at 8% (1 cell) with its tick near 32% (cell 5), on the terminal
      const cells = boxes.filter(b => b.props.backgroundColor === '#8b90a0')
      expect(cells.length).toBeGreaterThanOrEqual(2)
      // 4 bar segments: Messages, Tools, Other with the buffer as one grey run, free
      expect(boxes.filter(b => typeof b.props.flexGrow === 'number')).toHaveLength(4)
    }
    await ui.unmount()
  }
})

test('leads with a window that will run out', async ($, on) => {
  world(on, [
    { kind: 'five_hour', percentUsed: 60, resetsAt: iso(4 * HOUR) },
    { kind: 'seven_day', percentUsed: 10, resetsAt: iso(5 * 24 * HOUR) },
  ])
  await $.session.measure(MEASURE)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-quota', surface, component: 'AbovePrompt', props: PROPS })
    const head = await ui.find({ type: 'Text', text: /^At this pace you'll run out before the .* reset\.$/ })
    expect(head?.props.color).toBe('#f87171')
    // 60% in 1h, blended with the usual pace (50% a window): 40% more takes 74m,
    // 2h 46m before the reset
    expect(await ui.find({ text: 'Limit will hit in 1h 14m – resets in 4h' })).toBeDefined()
    await ui.unmount()
  }
})

test('says when a limit is reached', async ($, on) => {
  world(on, [{ kind: 'seven_day', percentUsed: 100, resetsAt: iso(2 * 24 * HOUR) }])
  await $.session.measure(MEASURE)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-quota', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ text: /^Limit reached\. Usage resumes at Tuesday \d+:\d\d [AP]M\.$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('treats the first 3% of a window as on track', async ($, on) => {
  world(on, [{ kind: 'five_hour', percentUsed: 5, resetsAt: iso(5 * HOUR - 5 * MIN) }])
  await $.session.measure(MEASURE)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-quota', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ text: /^On track\./ })).toBeDefined()
    await ui.unmount()
  }
})

test('shows a refresh failure in the status line', async ($, on) => {
  const status: (string | undefined)[] = []
  mock.clock(on, { now: NOW })
  on('session.usage', () => ({ deny: 'no session' }))
  answerRest(on, status)
  await $.session.measure(MEASURE)
  expect(status).toContainEqual(expect.stringMatching(/^usage-quota: (?!usage-quota).*no session/))
})

test('the Compact button runs /compact', async ($, on) => {
  const ran: string[] = []
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.usage', () => ({ value: usage([{ kind: 'seven_day', percentUsed: 10, resetsAt: iso(5 * 24 * HOUR) }]) }))
  answerRest(on, [])
  on('command.run', (_$, e) => {
    ran.push(e.command)
    return { text: '' }
  })
  await $.session.measure(MEASURE)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-quota', surface, component: 'AbovePrompt', props: PROPS })
    await ui.press({ key: 'compact' })
    await clock.advance(1)
    await ui.unmount()
  }
  expect(ran).toEqual(['compact', 'compact'])
})

test('a fresh session shows the last saved limits until its first reply', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, {
    limits: {
      at: NOW - HOUR,
      limits: [
        { kind: 'five_hour', percentUsed: 13, resetsAt: iso(-MIN) }, // already reset: back to 0
        { kind: 'seven_day', percentUsed: 6, resetsAt: iso(3 * 24 * HOUR) },
      ],
    },
  })
  on('session.usage', () => ({ value: usage([]) }))
  answerRest(on, [])
  await $.session.measure(MEASURE)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-quota', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ text: 'Weekly' })).toBeDefined()
    // a window that has reset still shows, at 0%, never vanishes
    expect(await ui.find({ text: '5 Hour' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '0%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'starts with your next message' })).toBeDefined()
    expect(await ui.find({ text: /^On track\./ })).toBeDefined()
    await ui.unmount()
  }
})

test('with no reading anywhere, the left side says so', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.usage', () => ({ value: usage([]) }))
  answerRest(on, [])
  await $.session.measure(MEASURE)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-quota', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ text: 'Usage limits show after the first reply.' })).toBeDefined()
    await ui.unmount()
  }
})

test('the plan endpoint gives the limits before any reply, and wins', async ($, on) => {
  const asked: string[] = []
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.usage', () => ({ value: usage([]) }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('http.fetch', (_$, e) => {
    asked.push(e.url)
    return {
      value: {
        status: 200,
        ok: true,
        headers: {},
        text: JSON.stringify({
          five_hour: { utilization: 16, resets_at: iso(2 * HOUR + 41 * MIN) },
          seven_day: { utilization: 7, resets_at: iso(3 * 24 * HOUR + 3 * HOUR) },
        }),
      },
    } as never
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'quota' } }))
  on('session.measure', () => ({ changed: [] }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  // opening the chat asks; a measure (the 3s tick's kind of read) never does
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await $.session.measure(MEASURE)

  expect(asked).toEqual([expect.stringMatching(/\/api\/oauth\/usage$/)])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-quota', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ type: 'Text', text: '16%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '7%' })).toBeDefined()
    await ui.unmount()
  }
})

test('the exact /context count corrects the estimate, and Messages with it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  // the exact count: System tools 20k (estimate 34k), MCP tools 13k (estimate 17k)
  const exact = CATEGORIES.map(c =>
    c.name === 'System tools' ? { ...c, tokens: 20_000 } : c.name === 'MCP tools' ? { ...c, tokens: 13_000 } : c,
  )
  on('session.usage', (_$, e) => {
    const u = usage([])
    if (e.breakdown === 'full') (u.context.breakdown as { categories: unknown }).categories = exact
    return { value: u }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'quota' } }))
  answerRest(on, [])
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await clock.advance(2_000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-quota', surface, component: 'AbovePrompt', props: PROPS })
    // Tools 20k + 13k, exact; Other 11k; Messages 158k - 33k - 11k = 114k
    expect(await ui.find({ type: 'Text', text: '33k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '11k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '114k' })).toBeDefined()
    await ui.unmount()
  }
})

test('the plan limits are asked again every 2 minutes, with the exact count', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  let used = 22
  on('session.usage', () => ({ value: usage([]) }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('http.fetch', () => ({
    value: {
      status: 200,
      ok: true,
      headers: {},
      text: JSON.stringify({
        five_hour: { utilization: used, resets_at: iso(2 * HOUR) },
        seven_day: { utilization: 7, resets_at: iso(3 * 24 * HOUR) },
      }),
    },
  }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'quota' } }))
  on('session.measure', () => ({ changed: [] }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: '22%' })).toBeDefined()
  used = 23
  await clock.advance(60_000)
  expect(await ui.find({ type: 'Text', text: '22%' })).toBeDefined()
  await clock.advance(60_000)
  expect(await ui.find({ type: 'Text', text: '23%' })).toBeDefined()
  await ui.unmount()
})

test('a failed usage check says why, backs off, and the newest reply figures show', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  let asks = 0
  let reply: SessionRateLimit[] = []
  on('session.usage', () => ({ value: usage(reply) }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('http.fetch', () => {
    asks += 1
    return { value: { status: 429, ok: false, headers: {}, text: '' } } as never
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'quota' } }))
  on('session.measure', () => ({ changed: [] }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  expect(asks).toBe(1)

  const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // nothing to show yet: the refusal is the line
  expect(await ui.find({ type: 'Text', text: 'usage check refused (429)' })).toBeDefined()

  // a reply arrives carrying the figures: they show, beside the note
  reply = [
    { kind: 'five_hour', percentUsed: 25, resetsAt: iso(2 * HOUR) },
    { kind: 'seven_day', percentUsed: 8, resetsAt: iso(3 * 24 * HOUR) },
  ]
  await clock.advance(3_000)
  expect(await ui.find({ type: 'Text', text: '25%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '8%' })).toBeDefined()

  // fresh reply figures: no warning
  expect(await ui.find({ type: 'Text', text: /usage check/ })).toBeUndefined()

  // the 2-minute ask comes round once the 2-minute back-off is over, and is refused
  // again; the reply figures, now 3 minutes old, say how old they are
  // (the band redraws once a minute, so the line can be up to a minute late)
  await clock.advance(180_000)
  expect(asks).toBe(2)
  expect(await ui.find({ type: 'Text', text: 'usage check refused (429) – figures from 3m ago' })).toBeDefined()
  await ui.unmount()
})

test('the back-off is shared: a refusal in one chat holds the others, and Retry-After is kept', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { planBackoff: { until: NOW + 10 * 60_000, failures: 3, error: 'refused (429)' } })
  let asks = 0
  on('session.usage', () => ({ value: usage([]) }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('http.fetch', () => {
    asks += 1
    return { value: { status: 429, ok: false, headers: { 'Retry-After': '600' }, text: '' } } as never
  })
  answerRestNoPlan(on)
  await $.session.measure(MEASURE)
  expect(asks).toBe(0)
})

test('after /compact, before any reply, the exact count is shown', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  // compacted: no reply yet, so no real total; the estimate says Messages 97k
  const exact = CATEGORIES.map(c => (c.name === 'Messages' ? { ...c, tokens: 23_000 } : c))
  on('session.usage', (_$, e) => {
    const u = usage([])
    delete (u.context as { tokens?: number }).tokens
    if (e.breakdown === 'full') (u.context.breakdown as { categories: unknown }).categories = exact
    return { value: u }
  })
  answerRest(on, [])
  await $.session.measure(MEASURE)
  await clock.advance(1)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-quota', surface, component: 'AbovePrompt', props: PROPS })
    // Messages 23k exact; used 23k + 51k + 11k = 85k; free 1M - 85k - 33k buffer
    expect(await ui.find({ type: 'Text', text: '23k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '882k free of 1M' })).toBeDefined()
    await ui.unmount()
  }
})

test('one ask for the whole app: a chat opening just after another does not ask again', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { planAskedAt: NOW - 30_000 })
  let asks = 0
  on('session.usage', () => ({ value: usage([]) }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('http.fetch', () => {
    asks += 1
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } } as never
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'quota' } }))
  answerRestNoPlan(on)
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  expect(asks).toBe(0)
})

test('a 5 hour window the service has no reset for (not started) shows 0%', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.usage', () => ({ value: usage([]) }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('http.fetch', () => ({
    value: {
      status: 200,
      ok: true,
      headers: {},
      text: JSON.stringify({
        five_hour: { utilization: 0, resets_at: null },
        seven_day: { utilization: 9, resets_at: iso(3 * 24 * HOUR) },
      }),
    },
  }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'quota' } }))
  answerRestNoPlan(on)
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-quota', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ text: '5 Hour' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '0%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '9%' })).toBeDefined()
    await ui.unmount()
  }
})

const TURN = { answer: 'done', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' } as never

function startWorld(on: On, percentRef: { value: number; isCompacted?: boolean }, ran: string[], asked: string[] = [], answer = 'Compact now', seed: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, seed)
  on('session.usage', () => {
    const u = usage([{ kind: 'seven_day', percentUsed: 10, resetsAt: iso(3 * 24 * HOUR) }])
    // just compacted: no reply yet, so no real total
    const tokens = percentRef.isCompacted ? undefined : percentRef.value * 10_000
    return { value: { ...u, context: { ...u.context, tokens, percent: percentRef.value } } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'quota' } }))
  on('command.run', (_$, e) => {
    ran.push(e.command)
    return { text: '' }
  })
  // auto compact compacts through the session, not by typing /compact
  on('session.compact', () => {
    ran.push('compact')
    return { skip: 'answered by the test' } as never
  })
  // $.ui.ask is a call of the AskUserQuestion tool: answered here as the dialog would
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = (e as unknown as { questions: { question: string }[] }).questions[0]!.question
    asked.push(question)
    return { result: { questions: [], answers: { [question]: answer } } } as never
  })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', () => ({ turnId: 't1' }))
  answerRest(on, [])
  return clock
}

test('the arrow collapses the band to one row of three bars, and back', async ($, on) => {
  const percent = { value: 16 }
  startWorld(on, percent, [])
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-quota', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ type: 'Button', label: '▼' })).toBeDefined()
    await ui.press({ key: 'collapse' })
    // the headline and Compact stay; the notes and categories go
    expect(await ui.find({ text: /^On track\./ })).toBeDefined()
    expect(await ui.find({ type: 'Button', label: 'Compact' })).toBeDefined()
    expect(await ui.find({ type: 'Button', label: '▲' })).toBeDefined()
    // the limits by short name, each with the time to its reset, in grey
    expect(await ui.find({ text: '5H' })).toBeDefined()
    expect(await ui.find({ text: 'W' })).toBeDefined()
    expect(await ui.find({ text: '5 Hour' })).toBeUndefined()
    const times = (await ui.findAll({ type: 'Text' })).filter(t => /^(\d+d )?(\d+h )?\d+[dhm]$/.test(String(t.text)))
    // the 5 hour window is not running: its whole length; Weekly resets in 3 days
    expect(times.map(t => t.text)).toEqual(['5h', '3d'])
    for (const t of times) expect(t.props.color).toBe('#8b90a0')
    expect(await ui.find({ text: 'Context' })).toBeDefined()
    // and Context with its whole window
    expect(await ui.find({ type: 'Text', text: '1M' })).toBeDefined()
    expect(await ui.find({ text: '16%' })).toBeDefined()
    expect(await ui.find({ text: 'Messages' })).toBeUndefined()
    expect(await ui.find({ text: /by reset/ })).toBeUndefined()
    // the forecast tick stays on the limit bars
    if (surface === 'desktop') {
      const weekly = (await ui.findAll({ type: 'Svg' })).find(svg => /^Weekly/.test(String(svg.props.alt)))
      expect(String(weekly?.props.source)).toContain('fill="#8b90a0"')
    }
    await ui.press({ key: 'collapse' })
    expect(await ui.find({ text: 'Messages' })).toBeDefined()
    await ui.unmount()
  }
})

test('collapsed is one setting for every chat: another chat collapsing shows here within half a second', async ($, on) => {
  const shared: Record<string, unknown> = {}
  const clock = startWorld(on, { value: 16 }, [], [], 'Compact now', shared)
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Button', label: '▼' })).toBeDefined()
  // the other chat's press, in the store all chats share
  shared.collapsed = true
  await clock.advance(500)
  expect(await ui.find({ type: 'Button', label: '▲' })).toBeDefined()
  shared.collapsed = false
  await clock.advance(500)
  expect(await ui.find({ type: 'Button', label: '▼' })).toBeDefined()
  await ui.unmount()
})

test('auto compact: the switch shows the field, and it compacts between turns once the context reaches the %', async ($, on) => {
  const percent = { value: 16 }
  const ran: string[] = []
  const clock = startWorld(on, percent, ran)
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  await ui.press({ key: 'auto' })
  expect((await ui.find({ type: 'Svg', alt: 'Auto compact on' }))).toBeDefined()
  // the field takes digits; the % sits beside it
  expect((await ui.find({ type: 'Input' }))?.props.submitLabel).not.toBe('set')
  // 100 becomes 99 with a note
  await ui.input({ key: await fieldKey(ui), text: '100' })
  expect(ran).toEqual([])
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('99')
  // below 15 becomes 15, each time; over 99 is 99 each time; blank is 30
  for (const [typed, shown] of [['5', '15'], ['0', '15'], ['14', '15'], ['100', '99'], ['250', '99'], ['', '30'], ['20', '20']]) {
    await ui.input({ key: await fieldKey(ui), text: typed })
    expect((await ui.find({ type: 'Input' }))?.props.value).toBe(shown)
  }
  // digits only, 3 at most: letters, signs and pasted text are dropped as they arrive
  await ui.input({ key: await fieldKey(ui), text: '2a', kind: 'change' })
  expect(String((await ui.find({ type: 'Input' }))?.props.value).replace(/​/g, '')).toBe('2')
  await ui.input({ key: await fieldKey(ui), text: '2', kind: 'change' })
  await ui.input({ key: await fieldKey(ui), text: '2+', kind: 'change' })
  expect(String((await ui.find({ type: 'Input' }))?.props.value).replace(/​/g, '')).toBe('2')
  await ui.input({ key: await fieldKey(ui), text: 'fix the bug -25 now', kind: 'change' })
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('25')
  await ui.input({ key: await fieldKey(ui), text: '123456', kind: 'change' })
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('123')
  await ui.input({ key: await fieldKey(ui), text: '-25' })
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('25')
  await ui.input({ key: await fieldKey(ui), text: '20' })
  // typing sets nothing while it goes on; resting 2s counts as clicking away, once
  await ui.input({ key: await fieldKey(ui), text: '4', kind: 'change' })
  await clock.advance(1_500)
  await ui.input({ key: await fieldKey(ui), text: '45', kind: 'change' })
  await clock.advance(1_500)
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('20')
  await clock.advance(600)
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('45')
  // a press elsewhere in the band sets a draft at once
  await ui.input({ key: await fieldKey(ui), text: '7', kind: 'change' })
  await ui.press({ key: 'collapse' })
  await ui.press({ key: 'collapse' })
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('15')
  await ui.input({ key: await fieldKey(ui), text: '40' })
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('40')

  // past it mid-turn: nothing until the turn ends, then at once
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  percent.value = 45
  await clock.advance(3_000)
  expect(ran).toEqual([])
  await $.turn.complete(TURN)
  await clock.advance(1_100)
  expect(ran).toEqual(['compact'])

  // the compaction left it still past the %: it does not loop on it
  await $.turn.complete(TURN)
  await clock.advance(3_600)
  expect(ran).toEqual(['compact'])

  // once under the % and past it again, it fires again
  percent.value = 20
  await clock.advance(3_000)
  percent.value = 41
  await $.turn.complete(TURN)
  await clock.advance(1_100)
  expect(ran).toEqual(['compact', 'compact'])
  await ui.unmount()
})

test('auto compact set below the context asks in the band, and "Now" compacts', async ($, on) => {
  const percent = { value: 50 }
  const ran: string[] = []
  const asked: string[] = []
  const clock = startWorld(on, percent, ran, asked, 'Compact now')
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'auto' })
  await ui.input({ key: await fieldKey(ui), text: '40' })
  await clock.advance(1_100)
  // asked in the band, never through the chat's question dialog
  expect(asked).toEqual([])
  expect(await ui.find({ type: 'Text', text: 'Context is already at 50%, past 40%. Auto compact:' })).toBeDefined()
  expect(ran).toEqual([])
  await ui.press({ key: 'askNow' })
  await clock.advance(1_100)
  expect(ran).toEqual(['compact'])
  expect(await ui.find({ type: 'Text', text: /already at/ })).toBeUndefined()
  await ui.unmount()
})

test('"After my next compact" holds through a % flickering below, until a real compaction', async ($, on) => {
  const percent: { value: number; isCompacted?: boolean } = { value: 17 }
  const ran: string[] = []
  const clock = startWorld(on, percent, ran)
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'auto' })
  await ui.input({ key: await fieldKey(ui), text: '19' })
  expect(await ui.find({ type: 'Text', text: /already at/ })).toBeUndefined()
  await ui.input({ key: await fieldKey(ui), text: '17' })
  expect(await ui.find({ type: 'Text', text: /already at 17%, past 17%/ })).toBeDefined()
  // still asking: a dip below and back, then a turn's end, compacts nothing
  percent.value = 16.4
  await clock.advance(3_000)
  percent.value = 18
  await $.turn.complete(TURN)
  await clock.advance(1_100)
  expect(ran).toEqual([])
  await ui.press({ key: 'askNext' })
  percent.value = 16.4
  await clock.advance(3_000)
  percent.value = 18
  await $.turn.complete(TURN)
  await clock.advance(1_100)
  expect(ran).toEqual([])
  // the person's own compact: from then on it watches again
  percent.value = 5
  percent.isCompacted = true
  await clock.advance(3_000)
  percent.isCompacted = false
  percent.value = 18
  await $.turn.complete(TURN)
  await clock.advance(1_100)
  expect(ran).toEqual(['compact'])
  await ui.unmount()
})

test('auto compact is per chat: another chat opens with it off, at 30%; turned on past it, it asks and waits', async ($, on) => {
  const percent: { value: number; isCompacted?: boolean } = { value: 35 }
  const ran: string[] = []
  // another chat has it on at 20%
  const clock = startWorld(on, percent, ran, [], 'Compact now', { 'autoCompact:other': { isOn: true, at: 20 } })
  on('session.id', () => ({ value: 'this' }) as never)
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await clock.advance(3_000)
  expect(ran).toEqual([])

  const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Svg', alt: 'Auto compact off' })).toBeDefined()
  await ui.press({ key: 'auto' })
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('30')
  expect(await ui.find({ type: 'Text', text: /already at 35%, past 30%/ })).toBeDefined()
  // left unanswered: as "after my next compact"
  await $.turn.complete(TURN)
  await clock.advance(3_000)
  expect(ran).toEqual([])
  percent.value = 5
  percent.isCompacted = true
  await clock.advance(3_000)
  expect(await ui.find({ type: 'Text', text: /already at/ })).toBeUndefined()
  percent.isCompacted = false
  percent.value = 31
  await $.turn.complete(TURN)
  await clock.advance(1_100)
  expect(ran).toEqual(['compact'])
  await ui.unmount()
})

test('auto compact tries again while the turn is still winding down', async ($, on) => {
  const percent = { value: 16 }
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, { 'autoCompact:chat': { isOn: true, at: 40 } })
  let tries = 0
  on('session.usage', () => {
    const u = usage([{ kind: 'seven_day', percentUsed: 10, resetsAt: iso(3 * 24 * HOUR) }])
    return { value: { ...u, context: { ...u.context, tokens: percent.value * 10_000, percent: percent.value } } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'quota' } }))
  // the direct way refused once: /compact from then on, refused while the turn winds down, then run
  on('session.compact', () => {
    throw new Error('a turn is running')
  })
  on('command.run', () => {
    tries += 1
    if (tries < 3) throw new Error('a turn is running')
    return { text: '' }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  answerRest(on, [])
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  percent.value = 45
  await $.turn.complete(TURN)
  await clock.advance(1_100)
  await clock.advance(2_000)
  await clock.advance(2_000)
  await clock.advance(2_000)
  expect(tries).toBe(3)
})

test('a chat opened past the auto compact % compacts at once, as after an app restart', async ($, on) => {
  const percent = { value: 32 }
  const ran: string[] = []
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, { 'autoCompact:chat': { isOn: true, at: 30 } })
  on('session.usage', () => {
    const u = usage([{ kind: 'seven_day', percentUsed: 10, resetsAt: iso(3 * 24 * HOUR) }])
    return { value: { ...u, context: { ...u.context, tokens: percent.value * 10_000, percent: percent.value } } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'quota' } }))
  on('session.compact', () => {
    ran.push('compact')
    percent.value = 8
    return { skip: 'answered by the test' } as never
  })
  on('ui.toast', () => ({ value: undefined }))
  answerRest(on, [])
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await clock.advance(1_100)
  expect(ran).toEqual(['compact'])
})

test('where the session cannot compact directly (the desktop app), auto compact types /compact', async ($, on) => {
  const percent = { value: 32 }
  const ran: string[] = []
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, { 'autoCompact:chat': { isOn: true, at: 30 } })
  on('session.usage', () => {
    const u = usage([{ kind: 'seven_day', percentUsed: 10, resetsAt: iso(3 * 24 * HOUR) }])
    return { value: { ...u, context: { ...u.context, tokens: percent.value * 10_000, percent: percent.value } } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'quota' } }))
  on('session.compact', () => {
    throw new Error('$.session.compact: not available in a headless (-p / SDK) session yet')
  })
  on('command.run', (_$, e) => {
    ran.push(e.command)
    percent.value = 8
    return { text: '' }
  })
  on('ui.toast', () => ({ value: undefined }))
  answerRest(on, [])
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await clock.advance(1_100)
  await clock.advance(2_000)
  expect(ran).toEqual(['compact'])
})

test('a narrow chat stacks the band and wraps its text, nothing cut off or dropped', async ($, on) => {
  startWorld(on, { value: 16 }, [])
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-quota', surface, component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 38 } })
    // the headline wraps, never truncated
    const head = await ui.find({ type: 'Text', text: /^On track\./ })
    expect(head?.props.wrap).toBe('wrap')
    for (const text of ['5 Hour', 'Weekly', 'Context', 'Messages', 'Tools', 'Other']) expect(await ui.find({ text })).toBeDefined()
    expect(await ui.find({ type: 'Button', label: 'Compact' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^On pace for about/ }))?.props.wrap).toBe('wrap')
    await ui.press({ key: 'collapse' })
    for (const text of ['5H', 'W', 'Context']) expect(await ui.find({ text })).toBeDefined()
    await ui.press({ key: 'collapse' })
    await ui.unmount()
  }
})

test('the desktop in light mode draws in the light palette', async ($, on) => {
  const clock = startWorld(on, { value: 16 }, [])
  on('env.get', (_$, e) => ({ value: (e as unknown as { name: string }).name === 'APPDATA' ? 'C:/AppData' : undefined }) as never)
  // the settings file is read only when its time changes
  let reads = 0
  let mtimeMs = 1
  on('fs.stat', () => ({ value: { kind: 'file', size: 100, mtimeMs, isLink: false } }) as never)
  on('fs.read', () => (reads++, { value: JSON.stringify({ userThemeMode: 'light' }) }) as never)
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await clock.advance(2_000)
  const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // green text a shade deeper than the green bars, to read on the pale band
  expect((await ui.find({ type: 'Text', text: /^On track\./ }))?.props.color).toBe('#16a34a')
  const weeklyBar = (await ui.findAll({ type: 'Svg' })).find(svg => /^Weekly/.test(String(svg.props.alt)))
  expect(String(weeklyBar?.props.source)).toContain('fill="#22b856"')
  const before = reads
  await clock.advance(10_000)
  expect(reads).toBe(before)
  mtimeMs = 2
  await clock.advance(2_000)
  expect(reads).toBe(before + 1)
  await ui.unmount()
})

test('the settings saved under the old plugin name are copied over once, never over newer ones', async ($, on) => {
  const clock = startWorld(on, { value: 10 }, [], [], 'Compact now', { collapsed: false })
  on('env.get', (_$, e) => ({ value: (e as unknown as { name: string }).name === 'HOME' ? '/home/me' : undefined }) as never)
  const listed: string[] = []
  on('fs.list', (_$, e) => {
    listed.push(String((e as unknown as { path: string }).path))
    return { value: [{ name: 'claude-code-usage-quota_claude-code-usage-quota-mod-abc123.json', kind: 'file', size: 10, mtimeMs: 1, isLink: false }] } as never
  })
  on('fs.read', () => ({ value: JSON.stringify({ 'autoCompact:chat': { isOn: true, at: 40 }, collapsed: true }) }) as never)
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await clock.advance(3_000)
  // the host gives the path in the platform's own form
  expect(listed).toEqual([expect.stringMatching(/home[\\/]me[\\/]\.claude[\\/]plugins[\\/]store$/)])
  const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Svg', alt: 'Auto compact on' })).toBeDefined()
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('40')
  // collapsed was already set here: kept as it is
  expect(await ui.find({ text: 'Weekly' })).toBeDefined()
  await ui.unmount()
})

test('early in a window the forecast starts from the usual pace: a quick 4% does not turn it red', async ($, on) => {
  // 4% in the first 10 minutes: alone that runs to 120%; with the usual pace, 60%
  world(on, [{ kind: 'five_hour', percentUsed: 4, resetsAt: iso(5 * HOUR - 10 * MIN) }])
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: /^On track\./ })).toBeDefined()
  expect(await ui.find({ text: 'On pace for about 60% by reset – resets in 4h 50m' })).toBeDefined()
  await ui.unmount()
})

test('the usual pace is learned from how far past windows got', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // the last window peaked at 20%, and two before it did too
  mock.store(on, { pace: { finals: { five_hour: [20, 20] }, windows: { five_hour: { resetsAt: NOW - HOUR, peak: 20, skip: 0 } } } })
  on('session.usage', () => ({ value: usage([{ kind: 'five_hour', percentUsed: 4, resetsAt: iso(5 * HOUR - 10 * MIN) }]) }))
  answerRest(on, [])
  await clock.advance(1)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // usual 20%: 4% + about 31% more
  expect(await ui.find({ text: 'On pace for about 35% by reset – resets in 4h 50m' })).toBeDefined()
  await ui.unmount()
})

test("a reopened chat's first reply, re-reading its history, is left out of the pace", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  // opened with 97k of history and no reply yet; an hour into the 5 hour window, at 10%
  const state = { tokens: undefined as number | undefined, percent: 10 }
  on('session.usage', () => {
    const u = usage([{ kind: 'five_hour', percentUsed: state.percent, resetsAt: iso(4 * HOUR) }])
    return { value: { ...u, context: { ...u.context, tokens: state.tokens } } }
  })
  answerRest(on, [])
  on('turn.start', () => ({ turnId: 't1' }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.measure(MEASURE)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await clock.advance(1_000)
  // the first reply re-reads it all: 10% to 30% at once
  state.tokens = 158_000
  state.percent = 30
  await $.session.measure(MEASURE)
  await $.turn.complete(TURN)
  const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // paced on the 10% of real use, not 30%: on track at about 70%, not running out
  expect(await ui.find({ text: /^On track\./ })).toBeDefined()
  expect(await ui.find({ text: '30%' })).toBeDefined()
  expect(await ui.find({ text: 'On pace for about 70% by reset – resets in 4h' })).toBeDefined()

  // later replies count in full
  await $.turn.start({ text: 'more', turnId: 't2' } as never)
  await clock.advance(1_000)
  state.percent = 50
  await $.session.measure(MEASURE)
  expect(await ui.find({ text: /^At this pace you'll run out/ })).toBeDefined()
  await ui.unmount()
})

test("a newer reply figure below the usage service's never pulls the band under it: 18.6% shows 19%, as the app does", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const state = { rateLimits: [] as SessionRateLimit[] }
  on('session.usage', () => ({ value: usage(state.rateLimits) }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('http.fetch', () => ({
    value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ seven_day: { utilization: 18.6, resets_at: iso(3 * 24 * HOUR) } }) },
  }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'quota' } }))
  on('session.measure', () => ({ changed: [] }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await clock.advance(1_000)
  // a reply then carries the same reading, cut to 18
  state.rateLimits = [{ kind: 'seven_day', percentUsed: 18, resetsAt: iso(3 * 24 * HOUR) }]
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: '19%' })).toBeDefined()
  // a reply past it is news: 20
  await clock.advance(1_000)
  state.rateLimits = [{ kind: 'seven_day', percentUsed: 20, resetsAt: iso(3 * 24 * HOUR) }]
  await $.session.measure(MEASURE)
  expect(await ui.find({ type: 'Text', text: '20%' })).toBeDefined()
  await ui.unmount()
})

test('a limit bar and its % turn amber from 75% used and red from 90%, even on track', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const state = { percent: 74 }
  // 2 hours before Weekly resets: on track at any of these
  on('session.usage', () => ({ value: usage([{ kind: 'seven_day', percentUsed: state.percent, resetsAt: iso(2 * HOUR) }]) }))
  answerRest(on, [])
  for (const [percent, color] of [[74, '#4ade80'], [75, '#fbbf24'], [89, '#fbbf24'], [90, '#f87171']] as const) {
    state.percent = percent
    await clock.advance(1_000)
    await $.session.measure(MEASURE)
    const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ text: /^On track\./ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: `${percent}%` }))?.props.color).toBe(color)
    await ui.unmount()
  }
})

test('Context turns amber from 50% and red from 80%', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const state = { percent: 49 }
  on('session.usage', () => {
    const u = usage([])
    return { value: { ...u, context: { ...u.context, percent: state.percent } } }
  })
  answerRest(on, [])
  for (const [percent, color] of [[49, '#4ade80'], [50, '#fbbf24'], [79, '#fbbf24'], [80, '#f87171']] as const) {
    state.percent = percent
    await clock.advance(1_000)
    await $.session.measure(MEASURE)
    const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect((await ui.find({ type: 'Text', text: `${percent}% used` }))?.props.color).toBe(color)
    await ui.unmount()
  }
})
