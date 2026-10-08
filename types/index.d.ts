export type Category = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' }
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type PaceOf = { typical: number; skip: number }
export type Snapshot = {
  window: number
  tokens: number
  percent: number
  total: number
  categories: Category[]
  limits: Limit[]
  /** when the limit figures were read */
  limitsAt?: number
  /** why the usage service last refused, while it is backed off */
  limitsError?: string
  /** the usage service answered, and this login (an API key, a gateway, a usage-billed plan) has no 5 hour or weekly windows */
  noLimits?: boolean
  /** per window kind: the usual final % and the one-off % left out of the pace */
  pace?: Record<string, PaceOf>
  /** the minute it was taken in: redraws countdowns at least once a minute */
  minute?: number
}

/** auto compact: on or off, and the context % that sets it off (kept for every chat) */
export type AutoCompact = { isOn: boolean; at: number | null }

declare module 'claude-code' {
  interface PluginState {
    'claude-code-usage-quota': {
      snapshot: Snapshot | null
      isOn: boolean
      isCollapsed: boolean
      autoCompact: AutoCompact
      /** the choice the band is asking for: the context was already past a new % */
      autoAsk: { at: number; percent: number } | null
      /** bumped on every % set: draws the field afresh even when the value is unchanged */
      fieldTick: number
      fieldText: string | null
      /** the desktop app's theme, as its settings (or the OS) have it */
      theme: 'dark' | 'light'
    }
  }
}
