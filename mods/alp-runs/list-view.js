// Basecamp's Run tab: the focused workspace's launch configs, tasks and saved commands, each with
// a play button. A row whose entry has a session shows its state and selects it in the bottom
// panel. Entries that need VS Code are folded away at the end, with the reason on each.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import {
  focused,
  home,
  notify,
  openOverlay,
  panes,
  setShared,
  shared,
  spaces,
  theme,
  watchFolder,
  window,
} from "herdr";
import { findWorkspace, loadEntries } from "./config.js";
import { neededInputs, sessionFor, startEntry } from "./runner.js";
import { showSession } from "./panel.js";

export const LAUNCH_KEY = "alp.runs.launch";
export const STAMP_KEY = "alp.runs.stamp";
export const ANSWERS_KEY = "alp.runs.inputs";
const PLAY_ICON = "mods/alp-runs/play.svg";
const PLUS_ICON = "mods/workspace-chrome/plus.svg";
const RELOAD_ICON = "mods/alp-runs/reload.svg";
const SECTIONS = [
  { id: "launch", title: "LAUNCH" },
  { id: "tasks", title: "TASKS" },
  { id: "saved", title: "SAVED" },
];

/**
 * Folders that say where the person works now, best first: the focused terminal's, the active
 * tab's terminals', the active space's other terminals', then the space's own folder.
 * @returns {string[]}
 */
function candidateFolders() {
  const space = spaces().find((candidate) => candidate.active);
  const tabs = space?.tabs ?? [];
  const activeTab = tabs.find((tab) => tab.active)?.id;
  const spaceTabs = new Set(tabs.map((tab) => tab.id));
  const paneFolders = (filter) =>
    panes()
      .filter((pane) => pane.cwd && filter(pane))
      .map((pane) => pane.cwd);
  const folders = [
    focused()?.cwd,
    ...paneFolders((pane) => pane.tab === activeTab),
    ...paneFolders((pane) => spaceTabs.has(pane.tab)),
    space?.folder || home(),
  ];
  return [...new Set(folders.filter(Boolean))];
}

/**
 * The glyph and color for a session's state.
 * @param {object} t The theme.
 * @param {object | undefined} session From `sessions()`.
 * @returns {{ glyph: string, color: string } | null}
 */
export function sessionMark(t, session) {
  if (!session) return null;
  if (session.running) return { glyph: "●", color: t.working };
  return session.exit === 0 ? { glyph: "✓", color: t.done } : { glyph: "✗", color: t.blocked };
}

/**
 * Starts an entry, asking for its inputs first when it has any, and shows its session.
 * @param {object} entry The entry.
 * @param {object} catalog From `loadEntries`.
 * @param {object} workspace From `findWorkspace`.
 * @param {Record<string, string> | null} answers The inputs' answers, or null to ask for them.
 * @returns {Promise<void>}
 */
export async function launch(entry, catalog, workspace, answers) {
  const inputs = neededInputs(entry, catalog);
  if (answers == null && inputs.length) {
    openOverlay({
      mod: "alp-runs",
      kind: "dialog",
      width: 440,
      height: 150 + inputs.length * 78,
      props: { part: "input", key: entry.key, root: workspace.root },
    });
    return;
  }
  try {
    const address = await startEntry(entry, catalog, workspace, answers ?? {});
    if (address) showSession(address);
  } catch (error) {
    notify({ title: `${entry.name} didn't start`, body: String(error?.message ?? error), level: "error" });
  }
}

export class ListPart {
  init(cx) {
    this.folder = null;
    this.workspace = null;
    this.catalog = null;
    this.stamp = shared(STAMP_KEY) ?? null;
    this.launchId = shared(LAUNCH_KEY)?.id ?? null;
    this.pending = new Set();
    this.showBlocked = false;
    this.watchToken = 0;
    this.filter = InputState.new({ placeholder: "Filter" });
    this.filter.on("change", (_event, cx) => cx.notify());
    this.sync(cx);
  }

  /** Reloads when the folder, the saved commands or a launch request changed. */
  sync(cx) {
    const folders = candidateFolders();
    const folder = folders.join("\n");
    const stamp = shared(STAMP_KEY) ?? null;
    if (folder !== this.folder || stamp !== this.stamp) {
      const force = stamp !== this.stamp;
      this.folder = folder;
      this.stamp = stamp;
      this.load(cx, force);
    }
    const request = shared(LAUNCH_KEY);
    if (request?.id && request.id !== this.launchId) {
      this.launchId = request.id;
      this.handleRequest(cx, request);
    }
  }

  /** Finds the folder's workspace and reads its entries when the workspace changed. */
  load(cx, force = false) {
    const folders = this.folder.split("\n");
    cx.spawn(async (cx) => {
      let workspace = null;
      for (const folder of folders) {
        workspace = await findWorkspace(folder);
        if (workspace.repo) break;
      }
      if (!force && workspace.root === this.workspace?.root && this.catalog) return;
      this.workspace = workspace;
      this.catalog = await loadEntries(workspace, window()?.platform ?? "macos");
      if (this.watchRoot !== workspace.root) this.watch(cx, workspace.root);
      cx.notify();
    });
  }

  /** Reads the entries again whenever the workspace's .vscode folder changes. */
  watch(cx, root) {
    this.watchRoot = root;
    const token = ++this.watchToken;
    this.watchHandle?.cancel();
    cx.spawn(async (cx) => {
      while (token === this.watchToken) {
        this.watchHandle = watchFolder(`${root}/.vscode`);
        const changed = await this.watchHandle.catch(() => null);
        if (!changed?.length || token !== this.watchToken) return;
        this.catalog = await loadEntries(this.workspace, window()?.platform ?? "macos");
        cx.notify();
      }
    });
  }

  /** Starts what the input dialog asked for, with its answers. */
  handleRequest(cx, request) {
    cx.spawn(async (cx) => {
      const sameWorkspace = this.workspace?.root === request.root && this.catalog;
      const workspace = sameWorkspace ? this.workspace : await findWorkspace(request.root);
      const catalog = sameWorkspace ? this.catalog : await loadEntries(workspace, window()?.platform ?? "macos");
      const entry = [...catalog.launch, ...catalog.tasks, ...catalog.saved].find((item) => item.key === request.key);
      if (entry) await this.start(cx, entry, catalog, workspace, request.answers);
    });
  }

  /** Starts an entry, marking it as starting until it has a session or fails. */
  async start(cx, entry, catalog, workspace, answers) {
    this.pending.add(entry.key);
    cx.notify();
    await launch(entry, catalog, workspace, answers);
    this.pending.delete(entry.key);
    cx.notify();
  }

  /** One entry: its session's state, its name, and its play button. */
  row(t, entry) {
    const session = this.workspace ? sessionFor(entry.key, this.workspace.root) : null;
    const mark = sessionMark(t, session);
    const starting = this.pending.has(entry.key);
    const play = (_event, cx) => {
      cx.stop_propagation();
      if (session?.running) showSession(session.address);
      else cx.spawn(async (cx) => this.start(cx, entry, this.catalog, this.workspace, null));
    };
    const menu = (_event, cx) => {
      cx.stop_propagation();
      if (entry.kind !== "saved" && entry.kind !== "task") return;
      openOverlay({
        mod: "alp-runs",
        kind: "popup",
        width: 210,
        height: entry.kind === "saved" ? 84 : 48,
        props: { part: "menu", key: entry.key, root: this.workspace.root },
      });
    };
    return h_flex()
      .id(`run-${entry.key}`)
      .w_full()
      .h(28)
      .px(10)
      .gap(8)
      .items_center()
      .text_size(12)
      .cursor_pointer()
      .hover((style) => style.bg(t.hover))
      .tooltip(entry.unsupported ? `Can't run here: it ${entry.unsupported}` : entry.name)
      .on_click((event, cx) => (session ? showSession(session.address) : entry.unsupported ? null : play(event, cx)))
      .on_mouse_down("right", menu)
      .child(
        div()
          .w(10)
          .flex_none()
          .text_size(10)
          .text_color(mark?.color ?? t.dim)
          .child(mark?.glyph ?? ""),
      )
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_color(entry.unsupported ? t.dim : t.foreground)
          .child(entry.name),
      )
      .when(!entry.unsupported, (el) =>
        el.child(
          h_flex()
            .id(`run-play-${entry.key}`)
            .flex_none()
            .size(22)
            .items_center()
            .justify_center()
            .rounded(5)
            .text_color(session?.running ? t.working : t.accent)
            .hover((style) => style.bg(t.selected))
            .tooltip(session?.running ? "Running: show its output" : `Run ${entry.name}`)
            .on_click(play)
            .child(
              starting
                ? div().text_size(11).frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)
                : svg(PLAY_ICON).size(11),
            ),
        ),
      );
  }

  /** A section heading, with + for saved commands. */
  heading(t, section) {
    const add = (_event, cx) => {
      cx.stop_propagation();
      openOverlay({
        mod: "alp-runs",
        kind: "dialog",
        width: 460,
        height: 360,
        props: { part: "save", root: this.workspace?.root ?? null },
      });
    };
    return h_flex()
      .px(10)
      .pt(10)
      .pb(3)
      .items_center()
      .child(div().flex_1().text_size(10.5).font_semibold().text_color(t.dim).child(section.title))
      .when(section.id === "saved", (el) =>
        el.child(
          h_flex()
            .id("run-save-new")
            .size(20)
            .items_center()
            .justify_center()
            .rounded(5)
            .cursor_pointer()
            .text_color(t.dim)
            .hover((style) => style.bg(t.hover).text_color(t.foreground))
            .tooltip("Save a command")
            .on_click(add)
            .child(svg(PLUS_ICON).size(12)),
        ),
      );
  }

  render(cx) {
    this.sync(cx);
    const t = theme();
    const query = this.filter.value().trim().toLowerCase();
    const matches = (entry) => !query || entry.name.toLowerCase().includes(query);
    const catalog = this.catalog;
    const blocked = catalog
      ? [...catalog.launch, ...catalog.tasks].filter((entry) => entry.unsupported && matches(entry))
      : [];
    const items = [];
    if (catalog) {
      for (const section of SECTIONS) {
        const rows = catalog[section.id].filter((entry) => !entry.unsupported && matches(entry));
        if (!rows.length && section.id !== "saved") continue;
        items.push(this.heading(t, section));
        if (!rows.length)
          items.push(div().px(10).py(4).text_size(11.5).text_color(t.dim).child("Save a command with +."));
        rows.forEach((entry) => items.push(this.row(t, entry)));
      }
      if (blocked.length) {
        items.push(
          h_flex()
            .id("run-blocked")
            .px(10)
            .pt(12)
            .gap(6)
            .items_center()
            .text_size(11)
            .text_color(t.dim)
            .cursor_pointer()
            .hover((style) => style.text_color(t.muted))
            .on_click((_event, cx) => {
              this.showBlocked = !this.showBlocked;
              cx.notify();
            })
            .child(this.showBlocked ? "▾" : "▸")
            .child(`${blocked.length} need VS Code`),
        );
        if (this.showBlocked) blocked.forEach((entry) => items.push(this.row(t, entry)));
      }
    }
    return v_flex()
      .id("alp-runs-list")
      .size_full()
      .bg(t.chrome)
      .child(
        h_flex()
          .flex_none()
          .px(10)
          .pt(8)
          .pb(6)
          .gap(6)
          .items_center()
          .child(
            Input.new(this.filter)
              .flex_1()
              .h(28)
              .px(8)
              .rounded(7)
              .border_1()
              .border_color(t.input)
              .bg(t.background)
              .text_size(12),
          )
          .child(
            h_flex()
              .id("run-reload")
              .flex_none()
              .size(24)
              .items_center()
              .justify_center()
              .rounded(6)
              .cursor_pointer()
              .text_color(t.dim)
              .hover((style) => style.bg(t.hover).text_color(t.foreground))
              .tooltip(`Read ${this.workspace?.name ?? "the workspace"}'s launch.json and tasks.json again`)
              .on_click((_event, cx) => this.load(cx, true))
              .child(svg(RELOAD_ICON).size(12)),
          ),
      )
      .when(Boolean(this.workspace), (el) =>
        el.child(div().px(10).text_size(11).text_color(t.dim).truncate().child(this.workspace.name)),
      )
      .children(
        (catalog?.errors ?? []).map((error, i) =>
          div().id(`run-error-${i}`).px(10).pt(4).text_size(11).text_color(t.blocked).child(error),
        ),
      )
      .when(!catalog, (el) =>
        el.child(div().px(10).py(8).text_size(11.5).text_color(t.dim).child("Reading the workspace…")),
      )
      .child(
        v_flex().id("alp-runs-scroll").flex_1().min_h(0).overflow_y_scrollbar().child(v_flex().pb(10).children(items)),
      );
  }

  /** Records the answers as the next defaults, then asks the list to start the entry. */
  static request(key, root, answers) {
    setShared(ANSWERS_KEY, { ...(shared(ANSWERS_KEY) ?? {}), ...answers });
    setShared(LAUNCH_KEY, { id: `${Date.now()}-${Math.random()}`, key, root, answers });
  }
}
