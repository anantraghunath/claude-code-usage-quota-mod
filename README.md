# Claude Code Usage Quota Mod with Auto Compact

[![Version: v0.1.3](docs/badges/version-v0.1.3.svg)](https://github.com/anantraghunath/claude-code-usage-quota-mod/releases/latest) ![Auto compact: 30% default](docs/badges/auto-compact-v2.svg) ![Compact: one click](docs/badges/compact-v2.svg) ![5 Hour + Weekly: whole account](docs/badges/limits-v2.svg) ![Forecast: before reset](docs/badges/forecast-v2.svg) ![Works in: Desktop + Terminal](docs/badges/works-in-v2.svg) ![License: MIT](docs/badges/license-v2.svg)

**Know your Claude limits before they hit you.** A live band above the Claude Code prompt that shows your plan limits, forecasts whether you'll run out before they reset, and shows how full your context window is. **Compact in one click, or let it compact automatically.**

The 5 Hour and Weekly limits are **your whole Claude account's**, including what you use in Claude chat and Cowork. The band itself shows in **Claude Code**: the desktop app and the terminal.

Type **`/quota`** to turn the band off and on.

## Expanded

![The band, expanded, above the prompt in the Claude desktop app](docs/expanded-desktop.png)

## Collapsed

One row that still shows the time left until each limit resets:

![The band, collapsed, above the prompt in the Claude desktop app](docs/collapsed-desktop.png)

> [!TIP]
> **Never hit a full context again: Auto compact, on by one click.**
> With Auto compact on, the band compacts your session once the context reaches **30%** (the default; set **15 to 99**). A long context costs more on every reply, so compacting early keeps replies **cheaper** and your limits **lasting longer**. Auto compact never interrupts a reply. Want to compact right now? The **Compact** button runs `/compact` in one click.
>
> **Each session keeps its own Auto compact setting**, even after a restart, so you can run them differently side by side:
> - **Building something big?** Set Auto compact higher (say 70%) or turn it off, so Claude keeps the whole picture. Press **Compact** yourself at a good stopping point. (With it off, Claude Code's built-in compaction still steps in when the context is nearly full.)
> - **Everyday sessions?** One click turns Auto compact on at 30%. They stay lean, and your 5 Hour and Weekly limits last longer.

## What it shows

**5 Hour and Weekly limits**
- The **% used**, matching the app's own *Plan usage limits* panel.
- A **forecast** of where you'll be at reset: a grey tick on the bar and a note, e.g. *On pace for about 87% by reset – resets in 23m*.
- A **headline** at a glance: *On track. You should reach Wednesday's reset with room to spare.*
- The forecast starts from **your usual pace** (learned from your past windows) and shifts to your actual pace as the window goes on, so an early burst doesn't set it off.
- Bars turn **amber at 75%** and **red at 90%**, or sooner if you're on course to run out.

On course to run out, it warns you and says **when you'll hit the limit**:

![The band, expanded, on course to run out before the 5 hour reset](docs/run-out-expanded-v2.png)

![The band, collapsed, on course to run out](docs/run-out-collapsed-v2.png)

**Context window**
- The % used and space free, as `/context` counts it, split into Messages, Tools and Other.
- **Amber at 50%**, **red at 80%**: the point to compact.

**Compacting**
- **Compact** runs `/compact` in one click.
- **Auto compact** runs at your % (30% by default, 15 to 99), never mid-reply. Each session keeps its own setting; a new session starts with it off.

If the session is already past your % when you turn it on, it asks first:

![Auto compact asking what to do, with the context already at 72%](docs/auto-compact-ask.png)

![The same question with the band collapsed](docs/auto-compact-ask-collapsed.png)

- **Now** compacts straight away.
- **After my next compact** waits until the session is compacted some other way (Compact, `/compact`, or Claude Code's own), then takes over.
- **Only in new chats** leaves this session alone until it's next opened.

Works in **light and dark** themes and at **every width** down to the narrowest. Collapsed or expanded is shared across all sessions.

<details>
<summary><b>MORE SCREENSHOTS</b></summary>

Early in a 5 hour window:

![The band, expanded, early in a 5 hour window](docs/expanded-dark-early.png)

![The band, collapsed, early in a 5 hour window](docs/collapsed-dark-early.png)

Running out on the Weekly limit:

![The band, expanded, on course to run out before the weekly reset](docs/run-out-weekly-expanded.png)

![The band, collapsed, on course to run out before the weekly reset](docs/run-out-weekly-collapsed.png)

| Light theme | Narrowest window |
| --- | --- |
| ![Light, expanded](docs/expanded-light.png) | ![Narrow, expanded](docs/narrow-expanded.png) |
| ![Light, collapsed](docs/collapsed-light.png) | ![Narrow, collapsed](docs/narrow-collapsed.png) |

</details>

## Where it works

- **Claude desktop app**, Code tab
- **Claude Code in a terminal**

> [!NOTE]
> In the desktop app, the band appears once a session has started. The brand-new *Welcome back* screen has no session yet, so no mod can draw there. Send your first message and it appears.

In the terminal, **▲/▼** expands and collapses it. The `[-]` next to it is Claude Code's own control and hides the band; **ctrl+x ctrl+a** brings it back.

![The band in the terminal, expanded](docs/terminal-expanded.png)

<details>
<summary>Terminal, collapsed</summary>

![The band in the terminal, collapsed](docs/terminal-collapsed.png)

</details>

## Install

Needs a recent Claude Code, signed in with any Claude plan: **Pro, Max, Team or Enterprise**. On a login with no 5 hour or weekly limits (an API key, a gateway, a plan billed by usage) the band says so and still shows your context window and Compact.

**Desktop app:** in the **Code** tab, send this as a message, allow the `claude plugin` command if asked, then **quit and reopen** the app:

```text
Install the claude-code-usage-quota plugin from the GitHub marketplace anantraghunath/claude-code-usage-quota-mod
```

**Terminal:** inside `claude`, run:

```text
/plugin install claude-code-usage-quota --marketplace anantraghunath/claude-code-usage-quota-mod
```

Either way installs it for **both** the desktop app and the terminal.

**Update:** ask Claude, then restart:

```text
Update the claude-code-usage-quota plugin from its marketplace
```

**Uninstall:** in the desktop app, ask Claude:

```text
Remove the claude-code-usage-quota-mod plugin marketplace
```

or in the terminal:

```text
/plugin marketplace remove claude-code-usage-quota-mod
```

then restart. This removes it from both. Just want it out of sight? **`/quota`** hides it without uninstalling.

<details>
<summary>From your own shell instead</summary>

```bash
claude plugin marketplace add anantraghunath/claude-code-usage-quota-mod; claude plugin install claude-code-usage-quota@claude-code-usage-quota-mod
```

To update:

```bash
claude plugin marketplace update claude-code-usage-quota-mod; claude plugin update claude-code-usage-quota@claude-code-usage-quota-mod
```

To uninstall:

```bash
claude plugin marketplace remove claude-code-usage-quota-mod
```

</details>

## Privacy

**Everything runs on your machine.** It reads what Claude Code already has (your context and the limits each reply carries), and about every 2 minutes asks Anthropic's usage service for your limits through your existing Claude login. It **never sees your credentials** and sends nothing anywhere else. In the desktop app it reads the app's theme setting to match light or dark.

## Feedback and contributing

First release: I'd love to hear how it works for you. [Open an issue](https://github.com/anantraghunath/claude-code-usage-quota-mod/issues) for bugs or ideas. Pull requests welcome.

To work on it, clone the repo, then load it from the folder, or run its tests:

```bash
claude --plugin-dir ./claude-code-usage-quota-mod
```

```bash
claude plugin test ./claude-code-usage-quota-mod
```

**If you find it useful, a ⭐ helps others find it.**

## Credits

Inspired by [I'm liking the new mods feature](https://www.reddit.com/r/ClaudeCode/comments/1wwjman/im_liking_the_new_mods_feature/) on r/ClaudeCode. Thanks to [u/itsxzy](https://www.reddit.com/user/itsxzy/) for sharing the original prompt that started this project.

## License

[MIT](LICENSE) © 2026 Anant Raghunath
