# herdr-alp

A layout for the [Herdr](https://herdr.dev) desktop app, plus the Claude Code plugin that feeds it.

An *Alp* is the high summer pasture of the Swiss Alps: the herd roams the open slopes, unfenced, and the herdsman is up there with it, in charge. This layout is that for coding agents: a sidebar with your account's usage limits, spaces and agents, and a header on every pane with the agent's model, effort, context fill, worktree, branch and status. It comes in [Dracula](https://draculatheme.com) colors.

> [!NOTE]
> **Claude Code only, for now.** The usage limits and the model, effort and context chips come from the `alp` Claude Code plugin. Other agents and shells still get the pane header (name, folder, worktree, status) but no chips. The status files are agent-neutral, so other agents can be added later (see [Status files](#status-files)).

![Alp](preview.png)

What's inside:

| Path | What it is |
|---|---|
| `layouts/alp.json` | the Herdr layout |
| `themes/alp.json` | its built-in theme: Dracula |
| `mods/usage-limits/` | sidebar block: session (5h) and weekly (7d) usage, with time to reset |
| `mods/pane-agent/` | pane header: icon, name, folder, model/effort/context chips, worktree, branch, status, split/zoom/close |
| `mods/alp-agents/` | sidebar agents list: grouped or priority views, sub-agents under their parent, each Space shown by its avatar |
| `mods/alpmeister/` | a team lead's start-of-day tab: a Dashboard of all your repos or one workspace (bugs by priority, triage, customer issues, nightly, priorities, milestone, team in flight), Herds, Daypack (focus, reviews, your PRs, your issues) and Settings |
| `mods/daypack/` | Daypack: a right sidebar beside the terminals with today's trail, shown or hidden from the Daypack button in the tab bar |
| `mods/alp-tabs/` | the tab bar: Herdr's tabs with a sheep beside + that opens Alpmeister, and the Daypack button after Changes |
| `plugins/alp/` | Claude Code plugin that writes the status files the mods read |
| `RECIPE.md` | the brief to rebuild it from scratch (herdr.dev format) |
| `sync.sh` | copy the layout and mods into Herdr's home, or pull live edits back |
| `setup.sh` | one-step install: checks `gh`, syncs, installs the plugin and opens Alpmeister's Settings |

## Install

### Quick setup

```sh
git clone https://github.com/ido-galili/herdr-alp && cd herdr-alp
./setup.sh
```

It walks through the steps below, then opens Alpmeister on its [Settings](#settings) tab. To do
it by hand instead:

### 1. Herdr layout and mods

```sh
git clone https://github.com/ido-galili/herdr-alp && cd herdr-alp
./sync.sh install                                   # copies layout, theme and mods into ~/.config/herdr-app
herdr-app do layout.switch '{"name":"alp"}'
```

`ctrl-shift-l` switches back to your previous layout. Alp opens in its own Dracula theme (`alp` in the theme picker, offered only on this layout); picking another theme there overrides it.

Or ask your agent to add `herdr.dev/layouts/ido-galili/herdr-alp`: Herdr's `AGENTS.md` tells it how.

### 2. Claude Code plugin

Without it the layout works, but the usage limits show `–` and the pane headers show no chips. This repository is also a Claude Code plugin marketplace, so in a Claude Code session:

```
/plugin marketplace add ido-galili/herdr-alp
/plugin install alp@herdr-alp
```

Pick a scope when asked (user scope loads it in every session). Or from a shell:

```sh
claude plugin marketplace add ido-galili/herdr-alp
claude plugin install alp@herdr-alp
```

Update it later with `/plugin marketplace update herdr-alp`.

**While developing**, load it straight from this folder instead, in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/projects/herdr-alp/plugins/alp" } }
```

Restart running Claude sessions after installing or changing the plugin.

## Alpmeister

In an alp cooperative, the Alpmeister plans the season and oversees the alp, while the senn
works the herd. The `alpmeister` mod is that view for a team lead, opened as a tab: click the
sheep beside + in the tab bar (it goes to the space's Alpmeister tab when one is open), or

```sh
herdr-app do tab.new '{"mod":"alpmeister","name":"Alpmeister"}'
```

It has four tabs: Dashboard, Herds, Daypack and Settings. It works before you set anything:
the Dashboard starts on all your repositories.

- **Dashboard:** your GitHub as a whole, or one workspace, picked from a row of pills on top.
  - **All repos:** four tiles (review requests, your open PRs, your assigned issues, red
    checks), then every repository in scope with its open issues and PRs, the default branch's
    checks, and when it was last pushed.
  - **A workspace** is a repository, a project board, or both. With a repository: four tiles
    (open bugs by priority, triage bugs, open customer issues, the last nightly run), the
    spotlight on the next two milestones, and the next milestone (X of Y closed, due date,
    status strip, flags). With a board: the issues in flight, each flagged when it is outside
    the current iteration. A repository with no board lists its open PRs instead.
- **Daypack:** today's focus (pinned rows and typed todos, carried over the next day), your
  review requests with a Review button, your open PRs, and your issues with a Start button,
  from every repository in scope. Both buttons open a Claude Code tab running the prompt set in
  Settings, in that repository's local clone, and show only when the prompt is set.
- **Herds:** your Claude Code sessions and how they are linked. A session that messaged others
  (`SendMessage`) or made their worktrees is a herdsman: drawn on top, with a line down to each
  of its herd, labelled `msg 12:36` for its latest message or dotted `worktree`. Who and when
  only: no message text is shown. Sessions with no link graze: a card each, in space order, with a
  stripe in the space's color and its avatar in the corner. Every box and card ends with
  the session's git branch. A click opens
  a session's tab. A background session is shown in the tab titled with its name, or in the
  tab picked with Link a tab. It reads Claude Code's files (`~/.claude/sessions`, the
  sessions' transcripts) and redraws when a session starts, ends or changes status. Open it
  directly with `herdr-app do tab.new '{"mod":"alpmeister","props":{"tab":"herds"}}'`.
- **Settings:** everything below, as a form (see [Settings](#settings)).
- **Refresh:** Dashboard and Daypack fetch when the tab opens and from its Refresh button only. The "updated" time turns
  amber after 2 hours.
- **Today's focus** shows each pinned issue's board status and each pinned PR's review
  decision, as of the last refresh.
- **Open on a tab or workspace:** `props.tab` (`dashboard`, `herds`, `today`, `settings`) and
  `props.workspace` (a workspace's name, `""` for All repos):
  `herdr-app do tab.new '{"mod":"alpmeister","props":{"tab":"dashboard","workspace":"Team"}}'`.
- **State:** `~/.local/state/alp/focus.json` holds the focus list and
  `~/.local/state/alp/alpmeister-cache.json` the last result.

### Settings

The Settings tab edits `~/.config/alp/alpmeister.json`. Its choices come from GitHub through
the `gh` CLI (your repositories, your account's and organizations' project boards, a board's
statuses and fields, a repository's workflows) and from your disk (local clones). Alpmeister
only reads GitHub, never writes to it. Nothing is saved until Save, which keeps the previous
file as `alpmeister.json.bak`.

| Part | What you set |
|---|---|
| Repos in scope | all your repositories (new ones join on their own; archived ones optional), or only the ones you check |
| Local folders | each repository's clone, where its Claude buttons open; clones found under `~/projects`, `~/code` and the like are offered |
| Claude buttons | what they type into the new Claude tab. `{repo}` and `{number}` are filled in; a `/command` works too |
| Daypack searches | the review-request, your-PRs and your-issues searches |
| Workspaces | as many as you like, each with a name, a repository and/or a project board |
| A workspace's board | its status and iteration fields, and per status: not started, in flight or other; hidden from Your issues; on hold |
| A workspace's repository | the nightly workflow, its branch and the runs that count; the bugs, triage, spotlight and customer issue settings |

Nightly checks (one row per job or step) are edited in the file: see
`mods/alpmeister/alpmeister.example.json` for every key. A file in the earlier one-repo shape
(top-level `repo` and `project`) still works: it reads as one workspace, and Save writes it in
the new shape.

## Status files

The plugin and the mods talk through files in `~/.local/state/herdr-agents/`. They are written per agent, so other agents can report later without changing the mods:

- `<herdr terminal>.json`: `{ "agent": "claude", "model", "effort", "context_pct", "ts" }`. Empty when the agent has exited. The pane header shows the chips only when `agent` matches the program running in the pane.
- `limits.json`: `{ "<agent>": { "five_hour": { "used_percentage", "resets_at" }, "seven_day": {…}, "ts" } }`. Each agent replaces only its own key. `usage-limits` takes `props: { "agent": "…" }` (default `claude`).

To add another agent: make it write these files, then add its program key to `REPORTING` in `mods/pane-agent/main.js`.

## Working on it

Herdr hot-reloads its home, so the quickest loop is to edit there and pull back:

```sh
./sync.sh pull      # ~/.config/herdr-app -> repo
./sync.sh install   # repo -> ~/.config/herdr-app
herdr-app check ~/.config/herdr-app/mods/pane-agent
```

## Planned

- A browser tab.
- **senn**, the Alp's herdsman: a mod that steers the agents.

## License

[MIT](LICENSE)
