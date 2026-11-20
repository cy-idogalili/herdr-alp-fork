// The Settings tab: every setting in ~/.config/alp/alpmeister.json as a form, with the choices
// read from GitHub (your repositories, boards, a board's statuses and fields, a repository's
// workflows) and from your disk (local clones). Edits stay in a draft until Save.

import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { pickFolder, theme } from "herdr";
import { DEFAULT_ISSUE_PROMPT, DEFAULT_PR_PROMPT, inScope, normalizeConfig, normalizeWorkspace, tildePath } from "./config.js";
import { boardFields, discover, findClones, guessRoles, repoDetails, saveSettings } from "./settings-data.js";
import { Card, Chip, Note, TextButton, Toggle, statusColor } from "./ui.js";

/** A deep copy of plain JSON data. */
const copy = (value) => JSON.parse(JSON.stringify(value));

/** A comma-separated field's values. */
const splitList = (text) =>
  text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

/** How a list setting shows in its text field. */
const joinList = (values) => (values ?? []).join(", ");

/** The nightly run triggers a workflow can be counted from. */
const NIGHTLY_EVENTS = ["schedule", "workflow_dispatch", "push"];

/**
 * The text fields: which part of the settings each one edits. `account` fields edit the
 * account; `workspace` fields edit the workspace shown; `ui` fields are the form's own.
 */
const FIELDS = {
  issuePrompt: {
    scope: "account",
    placeholder: "Empty: no Claude button on issues",
    get: (account) => account.launch.issue,
    set: (account, value) => (account.launch.issue = value),
  },
  prPrompt: {
    scope: "account",
    placeholder: "Empty: no Claude button on PRs",
    get: (account) => account.launch.pr,
    set: (account, value) => (account.launch.pr = value),
  },
  reviewQuery: {
    scope: "account",
    get: (account) => account.queries.review,
    set: (account, value) => (account.queries.review = value),
  },
  myPrsQuery: {
    scope: "account",
    get: (account) => account.queries.myPrs,
    set: (account, value) => (account.queries.myPrs = value),
  },
  mineQuery: {
    scope: "account",
    get: (account) => account.queries.mine,
    set: (account, value) => (account.queries.mine = value),
  },
  name: {
    scope: "workspace",
    placeholder: "Shown on the Dashboard switch",
    get: (ws) => ws.name,
    set: (ws, value) => (ws.name = value),
  },
  triage: {
    scope: "workspace",
    get: (ws) => ws.queries.triage,
    set: (ws, value) => (ws.queries.triage = value),
  },
  bugsQuery: {
    scope: "workspace",
    get: (ws) => ws.bugs.query,
    set: (ws, value) => (ws.bugs.query = value),
  },
  priorityField: {
    scope: "workspace",
    get: (ws) => ws.bugs.priorityField,
    set: (ws, value) => (ws.bugs.priorityField = value),
  },
  priorities: {
    scope: "workspace",
    placeholder: "Most urgent first, comma-separated",
    get: (ws) => joinList(ws.bugs.priorities),
    set: (ws, value) => (ws.bugs.priorities = splitList(value)),
  },
  spotlightLabels: {
    scope: "workspace",
    placeholder: "Labels that put an issue in the spotlight",
    get: (ws) => joinList(ws.spotlight.labels),
    set: (ws, value) => (ws.spotlight.labels = splitList(value)),
  },
  featureTypes: {
    scope: "workspace",
    get: (ws) => joinList(ws.spotlight.featureTypes),
    set: (ws, value) => (ws.spotlight.featureTypes = splitList(value)),
  },
  customer: {
    scope: "workspace",
    get: (ws) => ws.customer.labelMatch,
    set: (ws, value) => (ws.customer.labelMatch = value),
  },
  excludeTypes: {
    scope: "workspace",
    placeholder: "Issue types left out of the team in flight",
    get: (ws) => joinList(ws.inFlight.excludeTypes),
    set: (ws, value) => (ws.inFlight.excludeTypes = splitList(value)),
  },
  nightlyBranch: {
    scope: "workspace",
    get: (ws) => ws.nightly?.branch ?? "",
    set: (ws, value) => ws.nightly && (ws.nightly.branch = value),
  },
  filter: { scope: "ui", placeholder: "Filter" },
};

/** A board's key in the caches: "owner#number". */
const boardKey = (board) => `${board.owner}#${board.number}`;

export class SettingsForm {
  /**
   * Creates the form's text fields. Call from `init`: text state needs a live host call.
   * @param {(cx: object) => void} onSaved Called after the file is written.
   */
  constructor(onSaved) {
    this.onSaved = onSaved;
    this.inputs = {};
    for (const [key, field] of Object.entries(FIELDS)) {
      const input = InputState.new({ placeholder: field.placeholder ?? "" });
      input.on("change", (_event, cx) => {
        this.fromInput(key);
        cx.notify();
      });
      this.inputs[key] = input;
    }
    this.draft = null;
    this.saved = null;
    this.snapshot = null;
    this.wsIndex = 0;
    this.open = null;
    this.discovery = null;
    this.discovering = false;
    this.discoverError = null;
    this.details = {};
    this.fields = {};
    this.clones = null;
    this.guessFor = null;
    this.saving = false;
    this.message = null;
    this.removeArmed = false;
    this.advancedAccount = false;
    this.advancedWorkspace = false;
  }

  /**
   * Starts editing a copy of the settings.
   * @param {object} config The settings as loaded.
   * @param {string | null} text The file's text as read, written back over on Save.
   */
  load(config, text) {
    this.draft = copy(config);
    this.saved = JSON.stringify(config);
    this.snapshot = text;
    this.wsIndex = Math.min(this.wsIndex, Math.max(0, config.workspaces.length - 1));
    this.removeArmed = false;
    this.syncInputs();
  }

  /** Whether there is a draft to edit. */
  ready() {
    return Boolean(this.draft);
  }

  /** Whether the draft differs from the file. */
  dirty() {
    return Boolean(this.draft) && JSON.stringify(this.draft) !== this.saved;
  }

  /** The workspace shown, or null. */
  workspace() {
    return this.draft?.workspaces[this.wsIndex] ?? null;
  }

  /** Puts the draft's values in the text fields. */
  syncInputs() {
    const ws = this.workspace();
    for (const [key, field] of Object.entries(FIELDS)) {
      if (field.scope === "account") this.inputs[key].set_value(field.get(this.draft.account) ?? "");
      if (field.scope === "workspace") this.inputs[key].set_value(ws ? (field.get(ws) ?? "") : "");
    }
  }

  /** Copies one text field into the draft. */
  fromInput(key) {
    const field = FIELDS[key];
    if (!this.draft || field.scope === "ui") return;
    const value = this.inputs[key].value();
    if (field.scope === "account") field.set(this.draft.account, value);
    const ws = this.workspace();
    if (field.scope === "workspace" && ws) field.set(ws, value);
  }

  /** Shows another workspace. */
  selectWorkspace(index, cx) {
    this.wsIndex = index;
    this.open = null;
    this.removeArmed = false;
    this.syncInputs();
    cx.notify();
  }

  /** Adds an empty workspace and shows it. */
  addWorkspace(cx) {
    this.draft.workspaces.push(normalizeWorkspace({ name: `Workspace ${this.draft.workspaces.length + 1}` }));
    this.selectWorkspace(this.draft.workspaces.length - 1, cx);
  }

  /** Removes the workspace shown, on the second click. */
  removeWorkspace(cx) {
    if (!this.removeArmed) {
      this.removeArmed = true;
      cx.notify();
      return;
    }
    this.draft.workspaces.splice(this.wsIndex, 1);
    this.selectWorkspace(Math.max(0, this.wsIndex - 1), cx);
  }

  /**
   * Starts the reads the form shows that have not run yet: your repositories and boards, your
   * clones, the shown workspace's repository details and board fields. Safe to call on every draw.
   */
  ensureLoaded(cx) {
    if (!this.discovery && !this.discovering && !this.discoverError) this.rediscover(cx);
    const ws = this.workspace();
    if (ws?.repo && !this.details[ws.repo]) {
      const repo = ws.repo;
      this.details[repo] = { loading: true };
      cx.spawn(async (cx) => {
        try {
          this.details[repo] = await repoDetails(repo);
        } catch (error) {
          this.details[repo] = { error: String(error?.message ?? error), boards: [], workflows: [] };
        }
        cx.notify();
      });
    }
    if (ws?.board && !this.fields[boardKey(ws.board)]) {
      const key = boardKey(ws.board);
      const { owner, number } = ws.board;
      this.fields[key] = { loading: true };
      cx.spawn(async (cx) => {
        try {
          this.fields[key] = await boardFields(owner, number);
          this.fitBoard(key);
        } catch (error) {
          this.fields[key] = { error: String(error?.message ?? error) };
        }
        cx.notify();
      });
    }
  }

  /** Reads your repositories, boards and clones again. */
  rediscover(cx) {
    this.discovering = true;
    this.discoverError = null;
    this.details = {};
    this.fields = {};
    cx.spawn(async (cx) => {
      const [discovery, clones] = await Promise.all([
        discover().catch((error) => {
          this.discoverError = String(error?.message ?? error);
          return null;
        }),
        findClones().catch(() => ({})),
      ]);
      this.discovery = discovery;
      this.clones = clones;
      this.discovering = false;
      cx.notify();
    });
  }

  /**
   * Fits the workspaces on a board to its fields once they are read: a status or iteration
   * field that is not on the board is replaced, and a board just picked takes its statuses.
   */
  fitBoard(key) {
    const fields = this.fields[key];
    for (const ws of this.draft?.workspaces ?? []) {
      if (!ws.board || boardKey(ws.board) !== key) continue;
      ws.board.title = fields.title;
      const selects = fields.selects.map((field) => field.name);
      if (!selects.includes(ws.board.statusField)) {
        ws.board.statusField = selects.includes("Status") ? "Status" : (selects[0] ?? "Status");
      }
      if (!fields.iterations.includes(ws.board.iterationField)) ws.board.iterationField = fields.iterations[0] ?? "";
      if (this.guessFor === key) this.useBoardStatuses(ws);
    }
    if (this.guessFor === key) this.guessFor = null;
  }

  /** The status options of a workspace's board, once read; null before. */
  boardStatuses(ws) {
    const fields = ws.board ? this.fields[boardKey(ws.board)] : null;
    return fields?.selects?.find((field) => field.name === ws.board.statusField)?.options ?? null;
  }

  /**
   * Takes the board's statuses, in board order. Roles already set keep where the names still
   * exist; a workspace with none of them gets them guessed from the names.
   */
  useBoardStatuses(ws) {
    const options = this.boardStatuses(ws);
    if (!options) return;
    const kept = (values) => values.filter((value) => options.includes(value));
    const guess = guessRoles(options);
    const known = kept(ws.notStarted).length || kept(ws.inFlight.statuses).length;
    ws.statuses = [...options];
    ws.notStarted = known ? kept(ws.notStarted) : guess.notStarted;
    ws.inFlight.statuses = known ? kept(ws.inFlight.statuses) : guess.inFlight;
    ws.mineHidden = known ? kept(ws.mineHidden) : guess.mineHidden;
    if (!options.includes(ws.spotlight.holdStatus)) ws.spotlight.holdStatus = guess.holdStatus;
  }

  /** Sets a status's role: "not-started", "in-flight" or "other". */
  setRole(ws, status, role) {
    const ordered = (values) => ws.statuses.filter((value) => values.includes(value));
    const notStarted = ws.notStarted.filter((value) => value !== status);
    const inFlight = ws.inFlight.statuses.filter((value) => value !== status);
    if (role === "not-started") notStarted.push(status);
    if (role === "in-flight") inFlight.push(status);
    ws.notStarted = ordered(notStarted);
    ws.inFlight.statuses = ordered(inFlight);
  }

  /** Writes the draft to the file. */
  save(cx) {
    const missing = this.draft.workspaces.find((ws) => !ws.repo && !ws.board);
    if (missing) {
      this.message = { text: `"${missing.name || "A workspace"}" needs a repository or a board.`, error: true };
      cx.notify();
      return;
    }
    this.saving = true;
    this.message = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const settings = normalizeConfig(this.draft);
        const text = await saveSettings(settings, this.snapshot);
        this.load(settings, text);
        this.message = { text: "Saved.", error: false };
        this.onSaved(cx);
      } catch (error) {
        this.message = { text: String(error?.message ?? error), error: true };
      }
      this.saving = false;
      cx.notify();
    });
  }

  /** Toggles a picker open or shut, clearing its filter. */
  togglePicker(key, cx) {
    this.open = this.open === key ? null : key;
    this.inputs.filter.set_value("");
    cx.notify();
  }

  // --- drawing ---------------------------------------------------------------------------------

  /**
   * The tab's content.
   * @param {object} cx The view's context, for starting reads.
   * @param {{ configError: string | null, onRevert(cx: object): void, onReset(cx: object): void }} options
   * @returns {object} The element.
   */
  render(cx, options) {
    const t = theme();
    if (!this.draft) {
      return v_flex()
        .gap(10)
        .child(Note(options.configError ?? "Loading the settings…", options.configError ? t.blocked : t.dim))
        .when(Boolean(options.configError), (el) =>
          el.child(
            h_flex().child(
              TextButton("st-reset", "Start from the defaults", (cx) => options.onReset(cx), {
                tooltip: "Edit fresh settings; Save keeps the broken file as alpmeister.json.bak",
              }),
            ),
          ),
        );
    }
    this.ensureLoaded(cx);
    return v_flex()
      .gap(14)
      .child(this.saveBar(t, options))
      .child(this.accountCard(t))
      .child(this.workspacesCard(t));
  }

  /** Unsaved changes, the last message, and Revert and Save. */
  saveBar(t, options) {
    const dirty = this.dirty();
    return h_flex()
      .items_center()
      .gap(10)
      .child(div().text_size(11).text_color(t.dim).child("~/.config/alp/alpmeister.json"))
      .when(Boolean(this.message), (el) =>
        el.child(Note(this.message.text, this.message.error ? t.blocked : t.done)),
      )
      .child(div().flex_1())
      .when(this.discovering, (el) => el.child(Note("Reading GitHub…")))
      .child(
        TextButton("st-rediscover", "Reload choices", (cx) => this.rediscover(cx), {
          tooltip: "Read your repositories, boards and local clones again",
        }),
      )
      .when(dirty, (el) => el.child(Chip("Unsaved changes", { color: t.working })))
      .when(dirty, (el) => el.child(TextButton("st-revert", "Revert", (cx) => options.onRevert(cx))))
      .child(this.primaryButton(t, "st-save", this.saving ? "Saving…" : "Save", dirty && !this.saving, (cx) => this.save(cx)));
  }

  /** A filled button, dimmed while `enabled` is false. */
  primaryButton(t, id, label, enabled, onClick) {
    return h_flex()
      .id(id)
      .flex_none()
      .px(12)
      .h(24)
      .items_center()
      .rounded(6)
      .text_size(11.5)
      .font_medium()
      .bg(enabled ? t.accent : t.hover)
      .text_color(enabled ? (t.accent_foreground ?? t.background) : t.dim)
      .when(enabled, (el) =>
        el.cursor_pointer().on_click((_event, cx) => {
          cx.stop_propagation();
          onClick(cx);
        }),
      )
      .child(label);
  }

  /** A labelled row of the form: the label on the left, the control filling the rest. */
  field(t, label, control, hint) {
    return h_flex()
      .w_full()
      .min_w(0)
      .gap(12)
      .items_start()
      .child(div().flex_none().w(150).pt(5).text_size(11.5).text_color(t.muted).child(label))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(4)
          .child(control)
          .when(Boolean(hint), (el) => el.child(div().text_size(10.5).text_color(t.dim).child(hint))),
      );
  }

  /** A text field. */
  text(t, key) {
    return Input.new(this.inputs[key])
      .h(28)
      .px(8)
      .rounded(6)
      .border_1()
      .border_color(t.input)
      .bg(t.background)
      .text_size(12)
      .text_color(t.foreground);
  }

  /** A section heading inside a card. */
  heading(t, text) {
    return div().pt(8).text_size(10.5).font_semibold().text_color(t.dim).child(text.toUpperCase());
  }

  /** A row of pills, one of them picked. `options`: `[{ value, label, tooltip? }]`. */
  pills(t, id, options, current, onPick) {
    return h_flex()
      .flex_wrap()
      .gap(4)
      .children(
        options.map((option, index) => {
          const picked = option.value === current;
          const pill = h_flex()
            .id(`${id}-${index}`)
            .px(8)
            .h(22)
            .items_center()
            .rounded(6)
            .border_1()
            .border_color(picked ? t.accent : t.border)
            .bg(picked ? t.selected : t.background)
            .text_size(11)
            .text_color(picked ? t.foreground : t.dim)
            .cursor_pointer()
            .hover((style) => style.text_color(t.foreground))
            .on_click((_event, cx) => {
              cx.stop_propagation();
              onPick(option.value, cx);
            })
            .child(option.label);
          return option.tooltip ? pill.tooltip(option.tooltip) : pill;
        }),
      );
  }

  /** A 14px checkbox. */
  check(t, id, checked, onToggle, { disabled = false, tooltip } = {}) {
    const box = h_flex()
      .id(id)
      .flex_none()
      .size(14)
      .items_center()
      .justify_center()
      .rounded(4)
      .border_1()
      .border_color(checked ? t.accent : t.input)
      .bg(checked ? t.accent : t.background)
      .when(!disabled, (el) =>
        el.cursor_pointer().on_click((_event, cx) => {
          cx.stop_propagation();
          onToggle(cx);
        }),
      )
      .when(checked, (el) => el.child(div().text_size(10).text_color(t.background).child("✓")));
    return tooltip ? box.tooltip(tooltip) : box;
  }

  /**
   * A dropdown: the current choice, and under it the options while open, with a filter when
   * there are many. `options`: `[{ value, label, sub? }]`; a null value is "none".
   */
  picker(t, key, current, options, onPick, { placeholder = "Choose…" } = {}) {
    const open = this.open === key;
    const chosen = options.find((option) => JSON.stringify(option.value) === JSON.stringify(current));
    const filter = this.inputs.filter.value().trim().toLowerCase();
    const filtering = options.length > 8;
    const shown = open
      ? options.filter((option) => !filter || `${option.label} ${option.sub ?? ""}`.toLowerCase().includes(filter))
      : [];
    const rowHeight = 26;
    return v_flex()
      .w_full()
      .gap(4)
      .child(
        h_flex()
          .id(`pk-${key}`)
          .w_full()
          .h(28)
          .px(8)
          .gap(6)
          .items_center()
          .rounded(6)
          .border_1()
          .border_color(open ? t.accent : t.input)
          .bg(t.background)
          .cursor_pointer()
          .on_click((_event, cx) => this.togglePicker(key, cx))
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .text_size(12)
              .text_color(chosen ? t.foreground : t.dim)
              .child(chosen?.label ?? placeholder),
          )
          .when(Boolean(chosen?.sub), (el) => el.child(div().text_size(10.5).text_color(t.dim).child(chosen.sub)))
          .child(div().text_size(10).text_color(t.dim).child(open ? "▲" : "▼")),
      )
      .when(open, (el) =>
        el.child(
          v_flex()
            .w_full()
            .p(4)
            .gap(4)
            .rounded(6)
            .border_1()
            .border_color(t.border)
            .bg(t.background)
            .when(filtering, (inner) => inner.child(this.text(t, "filter")))
            .child(
              v_flex()
                .id(`pk-list-${key}`)
                .w_full()
                .h(Math.max(rowHeight, Math.min(shown.length, 10) * rowHeight))
                .overflow_y_scrollbar()
                .when(!shown.length, (inner) => inner.child(Note("Nothing matches.")))
                .children(
                  shown.map((option, index) =>
                    h_flex()
                      .id(`pk-${key}-${index}`)
                      .w_full()
                      .flex_none()
                      .h(rowHeight)
                      .px(6)
                      .gap(8)
                      .items_center()
                      .rounded(5)
                      .text_size(12)
                      .cursor_pointer()
                      .text_color(option === chosen ? t.accent : t.foreground)
                      .hover((style) => style.bg(t.hover))
                      .on_click((_event, cx) => {
                        cx.stop_propagation();
                        this.open = null;
                        onPick(option.value, cx);
                        cx.notify();
                      })
                      .child(div().flex_1().min_w(0).truncate().child(option.label))
                      .when(Boolean(option.sub), (row) =>
                        row.child(div().flex_none().text_size(10.5).text_color(t.dim).child(option.sub)),
                      ),
                  ),
                ),
            ),
        ),
      );
  }

  // --- account ---------------------------------------------------------------------------------

  /** Your repositories as the form lists them: discovered ones, then any named only in the settings. */
  knownRepos() {
    const found = this.discovery?.repos ?? [];
    const names = new Set(found.map((repo) => repo.repo));
    const account = this.draft.account;
    const extra = [...(Array.isArray(account.repos) ? account.repos : []), ...Object.keys(account.folders)]
      .filter((repo) => !names.has(repo))
      .map((repo) => ({ repo, isArchived: false, isPrivate: false, isFork: false, unknown: true }));
    return [...found, ...[...new Set(extra.map((repo) => repo.repo))].map((repo) => extra.find((e) => e.repo === repo))];
  }

  /** Puts a repository in or out of scope. */
  toggleScope(repo) {
    const account = this.draft.account;
    if (Array.isArray(account.repos)) {
      account.repos = account.repos.includes(repo.repo)
        ? account.repos.filter((name) => name !== repo.repo)
        : [...account.repos, repo.repo];
    } else {
      account.exclude = account.exclude.includes(repo.repo)
        ? account.exclude.filter((name) => name !== repo.repo)
        : [...account.exclude, repo.repo];
    }
  }

  /** Switches between every repository and only the picked ones, keeping what is in scope now. */
  setScopeMode(mode) {
    const account = this.draft.account;
    if (mode === "picked" && !Array.isArray(account.repos)) {
      account.repos = this.knownRepos()
        .filter((repo) => inScope(account, { nameWithOwner: repo.repo, isArchived: repo.isArchived }))
        .map((repo) => repo.repo);
    }
    if (mode === "all" && Array.isArray(account.repos)) {
      const picked = new Set(account.repos);
      account.repos = "all";
      account.exclude = this.knownRepos()
        .filter((repo) => !picked.has(repo.repo) && (account.archived || !repo.isArchived))
        .map((repo) => repo.repo);
    }
  }

  /** Clones found on disk for repositories with no folder set. */
  suggestedFolders() {
    const folders = this.draft.account.folders;
    return Object.entries(this.clones ?? {}).filter(([repo]) => !folders[repo]);
  }

  /** One repository in the scope list: in scope, its name and badges, its local folder. */
  repoRow(t, repo) {
    const account = this.draft.account;
    const picked = Array.isArray(account.repos);
    const scoped = inScope(account, { nameWithOwner: repo.repo, isArchived: repo.isArchived });
    const blocked = !picked && repo.isArchived && !account.archived;
    const folder = account.folders[repo.repo];
    const found = !folder ? this.clones?.[repo.repo] : null;
    return h_flex()
      .id(`st-repo-${repo.repo}`)
      .w_full()
      .flex_none()
      .h(30)
      .gap(8)
      .px(6)
      .items_center()
      .rounded(6)
      .hover((style) => style.bg(t.hover))
      .child(
        this.check(
          t,
          `st-scope-${repo.repo}`,
          scoped,
          (cx) => {
            this.toggleScope(repo);
            cx.notify();
          },
          { disabled: blocked, tooltip: blocked ? "Archived: turn on Include archived first" : undefined },
        ),
      )
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_size(12)
          .text_color(scoped ? t.foreground : t.dim)
          .child(repo.repo),
      )
      .when(repo.isPrivate, (el) => el.child(Chip("private", { color: t.dim })))
      .when(repo.isArchived, (el) => el.child(Chip("archived", { color: t.dim })))
      .when(repo.isFork, (el) => el.child(Chip("fork", { color: t.dim })))
      .when(Boolean(folder), (el) =>
        el.child(div().flex_none().max_w(260).truncate().text_size(11).text_color(t.muted).child(folder)),
      )
      .when(Boolean(found), (el) =>
        el.child(
          TextButton(`st-use-${repo.repo}`, `Use ${found}`, (cx) => {
            account.folders[repo.repo] = found;
            cx.notify();
          }, { tooltip: "A local clone of this repository" }),
        ),
      )
      .child(
        TextButton(`st-folder-${repo.repo}`, folder ? "Change" : "Folder…", (cx) => {
          cx.spawn(async (cx) => {
            const chosen = await pickFolder({ prompt: "Use this folder" });
            if (chosen) {
              account.folders[repo.repo] = tildePath(chosen);
              cx.notify();
            }
          });
        }, { tooltip: "The local clone the Claude buttons open in" }),
      )
      .when(Boolean(folder), (el) =>
        el.child(
          TextButton(`st-unfolder-${repo.repo}`, "×", (cx) => {
            delete account.folders[repo.repo];
            cx.notify();
          }, { tooltip: "Forget this folder" }),
        ),
      );
  }

  /** The account card: repositories in scope, local folders, Claude prompts, the @me searches. */
  accountCard(t) {
    const account = this.draft.account;
    const picked = Array.isArray(account.repos);
    const repos = this.knownRepos();
    // Archived repositories are listed only when they can be in scope.
    const listed = repos.filter((repo) => picked || account.archived || !repo.isArchived);
    const hiddenArchived = repos.length - listed.length;
    const scopedCount = listed.filter((repo) => inScope(account, { nameWithOwner: repo.repo, isArchived: repo.isArchived })).length;
    const suggestions = this.suggestedFolders();
    const rowHeight = 30;
    return Card(
      "st-account",
      "Your GitHub",
      [Chip(this.discovery ? `signed in as ${this.discovery.login}` : "gh", { color: t.dim })],
      v_flex()
        .gap(10)
        .when(Boolean(this.discoverError), (el) => el.child(Note(`GitHub: ${this.discoverError}`, t.blocked)))
        .when(Boolean(this.discovery?.warning), (el) => el.child(Note(this.discovery.warning, t.working)))
        .child(
          this.field(
            t,
            "Repos in scope",
            h_flex()
              .gap(10)
              .items_center()
              .child(
                this.pills(
                  t,
                  "st-scope-mode",
                  [
                    {
                      value: "all",
                      label: "All my repos",
                      tooltip:
                        "Every repository you own, collaborate on or reach through an organization; new ones join on their own",
                    },
                    { value: "picked", label: "Only the ones I pick", tooltip: "Just the checked repositories" },
                  ],
                  picked ? "picked" : "all",
                  (mode, cx) => {
                    this.setScopeMode(mode);
                    cx.notify();
                  },
                ),
              )
              .when(!picked, (el) =>
                el.child(
                  Toggle("st-archived", "Include archived", account.archived, (cx) => {
                    account.archived = !account.archived;
                    cx.notify();
                  }),
                ),
              )
              .child(div().flex_1())
              .child(Chip(`${scopedCount} in scope`, { color: t.muted })),
            "The Dashboard's All repos view and the Daypack lists cover these. Uncheck one to leave it out.",
          ),
        )
        .when(suggestions.length > 0, (el) =>
          el.child(
            h_flex()
              .gap(8)
              .items_center()
              .child(Note(`Found ${suggestions.length} local clone${suggestions.length === 1 ? "" : "s"} with no folder set.`))
              .child(
                TextButton("st-use-all", "Use them all", (cx) => {
                  for (const [repo, folder] of suggestions) account.folders[repo] = folder;
                  cx.notify();
                }),
              ),
          ),
        )
        .child(
          v_flex()
            .id("st-repo-list")
            .w_full()
            .h(Math.max(rowHeight, Math.min(listed.length, 12) * rowHeight))
            .overflow_y_scrollbar()
            .when(!listed.length, (el) => el.child(Note(this.discovering ? "Reading your repositories…" : "No repositories found.")))
            .children(listed.map((repo) => this.repoRow(t, repo))),
        )
        .when(hiddenArchived > 0, (el) => el.child(Note(`${hiddenArchived} archived not listed.`)))
        .child(this.heading(t, "Claude buttons"))
        .child(
          this.field(
            t,
            "On an issue",
            this.text(t, "issuePrompt"),
            "Typed into a new Claude tab. {repo} and {number} are filled in; a /command works too.",
          ),
        )
        .child(this.field(t, "On a PR", this.text(t, "prPrompt")))
        .child(
          h_flex()
            .gap(8)
            .child(
              TextButton("st-default-prompts", "Use the default prompts", (cx) => {
                account.launch.issue = DEFAULT_ISSUE_PROMPT;
                account.launch.pr = DEFAULT_PR_PROMPT;
                this.inputs.issuePrompt.set_value(DEFAULT_ISSUE_PROMPT);
                this.inputs.prPrompt.set_value(DEFAULT_PR_PROMPT);
                cx.notify();
              }),
            )
            .child(
              TextButton("st-advanced-account", this.advancedAccount ? "Hide the searches" : "Daypack searches…", (cx) => {
                this.advancedAccount = !this.advancedAccount;
                cx.notify();
              }),
            ),
        )
        .when(this.advancedAccount, (el) =>
          el
            .child(this.field(t, "Review requests", this.text(t, "reviewQuery"), "GitHub issue searches, across everything you can see"))
            .child(this.field(t, "My PRs", this.text(t, "myPrsQuery")))
            .child(this.field(t, "My issues", this.text(t, "mineQuery"))),
        ),
    );
  }

  // --- workspaces ------------------------------------------------------------------------------

  /** The workspaces card: one switch per workspace, then the one shown. */
  workspacesCard(t) {
    const workspaces = this.draft.workspaces;
    const ws = this.workspace();
    return Card(
      "st-workspaces",
      "Workspaces",
      [
        ...workspaces.map((each, index) =>
          h_flex()
            .id(`st-ws-${index}`)
            .px(8)
            .h(22)
            .items_center()
            .rounded(6)
            .text_size(11)
            .cursor_pointer()
            .bg(index === this.wsIndex ? t.selected : t.background)
            .text_color(index === this.wsIndex ? t.foreground : t.dim)
            .hover((style) => style.text_color(t.foreground))
            .on_click((_event, cx) => this.selectWorkspace(index, cx))
            .child(each.name || "Unnamed"),
        ),
        TextButton("st-ws-add", "+ Add workspace", (cx) => this.addWorkspace(cx)),
      ],
      ws
        ? this.workspaceForm(t, ws)
        : Note(
            "No workspaces yet. A workspace is a repository, a project board, or both, with the team cards for it: " +
              "bugs, triage, nightly, milestone, spotlight and in flight. With workspaces, the Dashboard switches " +
              "between them and All repos.",
          ),
    );
  }

  /** The repository options: active ones first, archived last. */
  repoOptions() {
    const repos = this.knownRepos();
    return [
      { value: null, label: "None", sub: "a board only" },
      ...repos.filter((repo) => !repo.isArchived).map((repo) => ({ value: repo.repo, label: repo.repo, sub: repo.isPrivate ? "private" : "" })),
      ...repos.filter((repo) => repo.isArchived).map((repo) => ({ value: repo.repo, label: repo.repo, sub: "archived" })),
    ];
  }

  /** The board options: those linked to the workspace's repository first, then every other open one. */
  boardOptions(ws) {
    const linked = ws.repo ? (this.details[ws.repo]?.boards ?? []) : [];
    const linkedKeys = new Set(linked.map((board) => board.key));
    const rest = (this.discovery?.boards ?? []).filter((board) => !linkedKeys.has(board.key) && !board.closed);
    const options = [
      { value: null, label: "None", sub: "the repository only" },
      ...linked.map((board) => ({ value: board.key, label: `${board.title}`, sub: `${board.owner} #${board.number} · linked` })),
      ...rest.map((board) => ({ value: board.key, label: `${board.title}`, sub: `${board.owner} #${board.number}` })),
    ];
    if (ws.board && !options.some((option) => option.value === boardKey(ws.board))) {
      options.push({ value: boardKey(ws.board), label: ws.board.title ?? "Board", sub: `${ws.board.owner} #${ws.board.number}` });
    }
    return options;
  }

  /** Points the workspace at a board, or none, by its key. */
  pickBoard(ws, key) {
    if (!key) {
      ws.board = null;
      return;
    }
    const [owner, number] = key.split("#");
    const known = [...(this.details[ws.repo]?.boards ?? []), ...(this.discovery?.boards ?? [])].find((board) => board.key === key);
    ws.board = { owner, number: Number(number), title: known?.title ?? "", statusField: "Status", iterationField: "Iteration" };
    this.guessFor = key;
    if (this.fields[key] && !this.fields[key].loading && !this.fields[key].error) this.fitBoard(key);
  }

  /** The form for one workspace. */
  workspaceForm(t, ws) {
    const details = ws.repo ? this.details[ws.repo] : null;
    return v_flex()
      .gap(10)
      .child(this.field(t, "Name", this.text(t, "name")))
      .child(
        this.field(
          t,
          "Repository",
          this.picker(t, "ws-repo", ws.repo, this.repoOptions(), (repo) => {
            const autoName = !ws.name || ws.name === ws.repo?.split("/")[1] || /^Workspace \d+$/.test(ws.name);
            ws.repo = repo;
            if (autoName && repo) {
              ws.name = repo.split("/")[1];
              this.inputs.name.set_value(ws.name);
            }
            if (ws.nightly && !repo) ws.nightly = null;
          }),
          "Milestones, spotlight, bugs, triage, customer issues and nightly come from it.",
        ),
      )
      .child(
        this.field(
          t,
          "Project board",
          this.picker(t, "ws-board", ws.board ? boardKey(ws.board) : null, this.boardOptions(ws), (key) => this.pickBoard(ws, key)),
          ws.repo
            ? "Statuses, iterations and the team in flight come from it. Without one, the Dashboard lists the open PRs instead."
            : "Statuses, iterations and the team in flight come from it.",
        ),
      )
      .when(Boolean(ws.board), (el) => el.child(this.boardSection(t, ws)))
      .when(Boolean(ws.repo), (el) => el.child(this.repoSection(t, ws, details)))
      .child(
        h_flex()
          .pt(6)
          .gap(8)
          .child(div().flex_1())
          .child(
            TextButton("st-ws-remove", this.removeArmed ? "Click again to remove" : "Remove workspace", (cx) =>
              this.removeWorkspace(cx),
            ),
          ),
      );
  }

  /** The board's fields and how its statuses read. */
  boardSection(t, ws) {
    const fields = this.fields[boardKey(ws.board)];
    const options = this.boardStatuses(ws);
    const differs = options && JSON.stringify(options) !== JSON.stringify(ws.statuses);
    const section = v_flex().gap(10).child(this.heading(t, "Board"));
    if (!fields || fields.loading) return section.child(Note("Reading the board's fields…"));
    if (fields.error) {
      return section.child(Note(`${fields.error}. The board needs gh's read:project scope: gh auth refresh -s read:project`, t.blocked));
    }
    return section
      .when(fields.selects.length > 1, (el) =>
        el.child(
          this.field(
            t,
            "Status field",
            this.picker(
              t,
              "ws-status-field",
              ws.board.statusField,
              fields.selects.map((field) => ({ value: field.name, label: field.name, sub: `${field.options.length} options` })),
              (name) => {
                ws.board.statusField = name;
                this.useBoardStatuses(ws);
              },
            ),
          ),
        ),
      )
      .child(
        this.field(
          t,
          "Iteration field",
          this.picker(
            t,
            "ws-iteration-field",
            ws.board.iterationField || null,
            [{ value: null, label: "None", sub: "no iteration filters" }, ...fields.iterations.map((name) => ({ value: name, label: name }))],
            (name) => (ws.board.iterationField = name ?? ""),
          ),
        ),
      )
      .when(Boolean(differs), (el) =>
        el.child(
          h_flex()
            .gap(8)
            .items_center()
            .child(Note("The board's statuses differ from these.", t.working))
            .child(
              TextButton("st-use-statuses", "Use the board's statuses", (cx) => {
                this.useBoardStatuses(ws);
                cx.notify();
              }),
            ),
        ),
      )
      .child(this.statusTable(t, ws))
      .child(this.field(t, "Leave out of in flight", this.text(t, "excludeTypes")));
  }

  /** One row per status: its role, whether Your issues hides it, and which one means on hold. */
  statusTable(t, ws) {
    const role = (status) =>
      ws.notStarted.includes(status) ? "not-started" : ws.inFlight.statuses.includes(status) ? "in-flight" : "other";
    const roles = [
      { value: "not-started", label: "Not started", tooltip: "Flagged on the milestone when the due date is close" },
      { value: "in-flight", label: "In flight", tooltip: "Listed in the team in flight" },
      { value: "other", label: "Other" },
    ];
    return v_flex()
      .gap(2)
      .child(
        h_flex()
          .gap(12)
          .px(6)
          .text_size(10.5)
          .text_color(t.dim)
          .child(div().w(150).child("Status"))
          .child(div().w(230).child("Counts as"))
          .child(div().w(110).child("Hide in Your issues"))
          .child(div().child("On hold")),
      )
      .children(
        ws.statuses.map((status, index) =>
          h_flex()
            .id(`st-status-${index}`)
            .gap(12)
            .px(6)
            .h(28)
            .items_center()
            .rounded(6)
            .hover((style) => style.bg(t.hover))
            .child(
              h_flex()
                .w(150)
                .gap(6)
                .items_center()
                .child(div().size(7).rounded(4).bg(statusColor(t, status)))
                .child(div().min_w(0).truncate().text_size(12).text_color(t.foreground).child(status)),
            )
            .child(
              div()
                .w(230)
                .child(
                  this.pills(t, `st-role-${index}`, roles, role(status), (value, cx) => {
                    this.setRole(ws, status, value);
                    cx.notify();
                  }),
                ),
            )
            .child(
              h_flex()
                .w(110)
                .child(
                  this.check(t, `st-hide-${index}`, ws.mineHidden.includes(status), (cx) => {
                    ws.mineHidden = ws.mineHidden.includes(status)
                      ? ws.mineHidden.filter((value) => value !== status)
                      : ws.statuses.filter((value) => value === status || ws.mineHidden.includes(value));
                    cx.notify();
                  }),
                ),
            )
            .child(
              this.check(
                t,
                `st-hold-${index}`,
                ws.spotlight.holdStatus === status,
                (cx) => {
                  ws.spotlight.holdStatus = ws.spotlight.holdStatus === status ? "" : status;
                  cx.notify();
                },
                { tooltip: "Spotlight lists these issues under To discuss" },
              ),
            ),
        ),
      );
  }

  /** The repository's cards: triage, bugs, spotlight, customer issues, nightly. */
  repoSection(t, ws, details) {
    const workflows = details?.workflows ?? [];
    const workflowOptions = [
      { value: null, label: "None", sub: "no nightly tile" },
      ...workflows.map((workflow) => ({ value: workflow.file, label: workflow.name, sub: workflow.file })),
    ];
    if (ws.nightly && !workflows.some((workflow) => workflow.file === ws.nightly.workflow)) {
      workflowOptions.push({ value: ws.nightly.workflow, label: ws.nightly.workflow });
    }
    return v_flex()
      .gap(10)
      .child(this.heading(t, "Nightly"))
      .when(Boolean(details?.loading), (el) => el.child(Note("Reading the repository's workflows…")))
      .child(
        this.field(
          t,
          "Workflow",
          this.picker(t, "ws-nightly", ws.nightly?.workflow ?? null, workflowOptions, (file) => {
            ws.nightly = file
              ? {
                  workflow: file,
                  branch: ws.nightly?.branch || details?.branch || "main",
                  events: ws.nightly?.events ?? ["schedule", "workflow_dispatch"],
                  checks: ws.nightly?.workflow === file ? ws.nightly.checks : [],
                }
              : null;
            this.inputs.nightlyBranch.set_value(ws.nightly?.branch ?? "");
          }),
        ),
      )
      .when(Boolean(ws.nightly), (el) =>
        el
          .child(this.field(t, "Branch", this.text(t, "nightlyBranch")))
          .child(
            this.field(
              t,
              "Runs that count",
              h_flex()
                .gap(6)
                .children(
                  NIGHTLY_EVENTS.map((event) =>
                    Toggle(`st-event-${event}`, event, ws.nightly.events.includes(event), (cx) => {
                      ws.nightly.events = ws.nightly.events.includes(event)
                        ? ws.nightly.events.filter((value) => value !== event)
                        : [...ws.nightly.events, event];
                      cx.notify();
                    }),
                  ),
                ),
            ),
          )
          .child(
            this.field(
              t,
              "Checks",
              Note(
                ws.nightly.checks.length
                  ? ws.nightly.checks.map((check) => check.name).join(" · ")
                  : "None: the tile shows the run's overall result.",
              ),
              "One row per job or step: edit them in alpmeister.json (see alpmeister.example.json).",
            ),
          ),
      )
      .child(
        h_flex().child(
          TextButton(
            "st-advanced-ws",
            this.advancedWorkspace ? "Hide the team cards' settings" : "Bugs, triage, spotlight and customer issues…",
            (cx) => {
              this.advancedWorkspace = !this.advancedWorkspace;
              cx.notify();
            },
          ),
        ),
      )
      .when(this.advancedWorkspace, (el) =>
        el
          .child(this.heading(t, "Bugs and triage"))
          .child(this.field(t, "Open bugs search", this.text(t, "bugsQuery"), `Scoped to ${ws.repo}`))
          .child(this.field(t, "Priority field", this.text(t, "priorityField"), "The issue field the bugs are counted by"))
          .child(this.field(t, "Priorities", this.text(t, "priorities")))
          .child(this.field(t, "Triage search", this.text(t, "triage")))
          .child(this.heading(t, "Spotlight"))
          .child(
            this.field(
              t,
              "Milestones",
              this.pills(
                t,
                "st-milestones",
                [1, 2, 3, 4].map((count) => ({ value: count, label: String(count) })),
                ws.spotlight.milestones,
                (count, cx) => {
                  ws.spotlight.milestones = count;
                  cx.notify();
                },
              ),
              "How many upcoming milestones the spotlight shows",
            ),
          )
          .child(this.field(t, "Labels", this.text(t, "spotlightLabels")))
          .child(this.field(t, "Feature types", this.text(t, "featureTypes"), "Issue types always shown, in this order"))
          .child(this.heading(t, "Customer issues"))
          .child(this.field(t, "Label contains", this.text(t, "customer"))),
      );
  }
}
