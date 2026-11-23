// The Run tab's overlays: the dialog that asks for an entry's `${input:...}` values before it
// starts, the form that saves a command to ~/.config/alp/commands.json, and the right-click menu
// of a task or a saved command.

import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import {
  closeOverlay,
  home,
  openOverlay,
  props,
  readTextFile,
  setShared,
  shared,
  theme,
  window,
  writeTextFile,
} from "herdr";
import { COMMANDS_PATH, findWorkspace, loadEntries } from "./config.js";
import { parseJsonc } from "./jsonc.js";
import { neededInputs } from "./runner.js";
import { inputIds } from "./template.js";
import { ANSWERS_KEY, ListPart, STAMP_KEY } from "./list-view.js";

/** A dialog button. */
function button(t, id, label, primary, action) {
  return h_flex()
    .id(id)
    .h(32)
    .px(14)
    .items_center()
    .rounded(8)
    .border_1()
    .border_color(primary ? t.solid : t.input)
    .bg(primary ? t.solid : t.raised)
    .text_color(primary ? t.solid_foreground : t.foreground)
    .text_size(12.5)
    .font_medium()
    .cursor_pointer()
    .hover((style) => style.opacity(0.88))
    .on_click(action)
    .child(label);
}

/** A field's label. */
const fieldLabel = (t, text) => div().pt(12).pb(6).text_size(11.5).text_color(t.dim).child(text);

/** A text field over an InputState. */
const textField = (t, state) =>
  Input.new(state).h(34).px(10).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.5);

/** The dialog's frame: a title with Esc, the fields, and the buttons. */
function dialog(t, part, title, fields, buttons) {
  return v_flex()
    .id("alp-runs-dialog")
    .track_focus(part.handle)
    .on_key_down((event, cx) => {
      if (event.key !== "escape") return;
      closeOverlay(props().overlay);
      cx.stop_propagation();
    })
    .size_full()
    .min_h(0)
    .p(18)
    .bg(t.popover)
    .text_color(t.foreground)
    .child(
      h_flex()
        .items_center()
        .child(div().flex_1().text_size(15).font_semibold().truncate().child(title))
        .child(div().text_size(11).text_color(t.dim).child("Esc")),
    )
    .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().children(fields))
    .when(Boolean(part.error), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.blocked).child(part.error)))
    .child(h_flex().pt(16).gap(8).justify_end().children(buttons));
}

/** Reads commands.json: its text as read (for a safe write) and its value. */
async function readCommands() {
  const text = await readTextFile(COMMANDS_PATH()).catch(() => null);
  const value = text ? parseJsonc(text) : {};
  return { text, value: { ...value, commands: value.commands ?? [] } };
}

/** Writes commands.json if nobody changed it since it was read, then tells the Run tab. */
async function writeCommands(previousText, value) {
  await writeTextFile(COMMANDS_PATH(), `${JSON.stringify(value, null, 2)}\n`, previousText);
  setShared(STAMP_KEY, Date.now());
}

/** Loads the entry an overlay was opened for. */
async function loadEntry(key, root) {
  const workspace = await findWorkspace(root);
  const catalog = await loadEntries(workspace, window()?.platform ?? "macos");
  const entry = [...catalog.launch, ...catalog.tasks, ...catalog.saved].find((item) => item.key === key);
  return { workspace, catalog, entry };
}

export class InputPart {
  init(cx) {
    this.handle = cx.focus_handle();
    this.entry = null;
    this.inputs = [];
    this.states = {};
    this.choices = {};
    const { key, root } = props();
    cx.spawn(async (cx) => {
      const { catalog, entry } = await loadEntry(key, root);
      this.entry = entry;
      this.inputs = entry ? neededInputs(entry, catalog) : [];
      const last = shared(ANSWERS_KEY) ?? {};
      for (const input of this.inputs) {
        const initial = last[input.id] ?? input.default ?? "";
        if (input.type === "pickString") {
          const values = (input.options ?? []).map((option) => (typeof option === "string" ? option : option.value));
          this.choices[input.id] = values.includes(initial) ? initial : values[0];
        } else {
          const state = InputState.new({ value: String(initial), placeholder: input.description ?? input.id });
          if (input.password) state.set_masked(true);
          state.on("submit", () => this.submit());
          this.states[input.id] = state;
        }
      }
      const first = this.inputs.find((input) => this.states[input.id]);
      if (first) this.states[first.id].focus();
      else this.handle.focus();
      cx.notify();
    });
  }

  submit() {
    const answers = Object.fromEntries(
      this.inputs.map((input) => [input.id, this.states[input.id]?.value() ?? this.choices[input.id] ?? ""]),
    );
    const { key, root, overlay } = props();
    ListPart.request(key, root, answers);
    closeOverlay(overlay);
  }

  /** A pickString's options as chips; the chosen one is lit. */
  options(t, input) {
    const chip = (option) => {
      const value = typeof option === "string" ? option : option.value;
      const label = typeof option === "string" ? option : (option.label ?? option.value);
      const on = this.choices[input.id] === value;
      return div()
        .id(`input-${input.id}-${value}`)
        .px(10)
        .py(4)
        .rounded(7)
        .border_1()
        .border_color(on ? t.accent : t.input)
        .bg(on ? t.selected : t.background)
        .text_size(12)
        .cursor_pointer()
        .hover((style) => style.bg(t.hover))
        .on_click((_event, cx) => {
          this.choices[input.id] = value;
          cx.notify();
        })
        .child(label);
    };
    return h_flex()
      .flex_wrap()
      .gap(6)
      .children((input.options ?? []).map(chip));
  }

  render() {
    const t = theme();
    const fields = this.inputs.flatMap((input) => [
      fieldLabel(t, input.description ?? input.id),
      input.type === "pickString" ? this.options(t, input) : textField(t, this.states[input.id]),
    ]);
    return dialog(t, this, this.entry ? `Run ${this.entry.name}` : "Run", fields, [
      button(t, "input-cancel", "Cancel", false, () => closeOverlay(props().overlay)),
      button(t, "input-run", "Run", true, () => this.submit()),
    ]);
  }
}

export class SavePart {
  init(cx) {
    this.handle = cx.focus_handle();
    this.error = "";
    const { name, prefill, root } = props();
    this.original = name ?? null;
    this.inputDefs = prefill?.inputs ?? [];
    this.onlyHere = Boolean(prefill?.workspace);
    this.name = InputState.new({ placeholder: "Kill port", value: prefill?.name ?? "" });
    this.command = InputState.new({
      placeholder: "lsof -t -i:${input:port} | xargs kill",
      value: prefill?.command ?? "",
    });
    this.cwd = InputState.new({ placeholder: "${workspaceFolder}", value: prefill?.cwd ?? "" });
    for (const state of [this.name, this.command, this.cwd]) state.on("submit", (_event, cx) => this.save(cx));
    this.name.focus();
    this.root = root;
    if (!name) return;
    cx.spawn(async (cx) => {
      const saved = (await readCommands()).value.commands.find((command) => command.name === name);
      if (!saved) return;
      this.name.set_value(saved.name);
      this.command.set_value(saved.command ?? "");
      this.cwd.set_value(saved.cwd ?? "");
      this.inputDefs = saved.inputs ?? [];
      this.onlyHere = Boolean(saved.workspace);
      cx.notify();
    });
  }

  /** Writes the command into commands.json, replacing the one being edited. */
  save(cx) {
    const name = this.name.value().trim();
    const command = this.command.value().trim();
    const cwd = this.cwd.value().trim();
    if (!name || !command) {
      this.error = "A command needs a name and a command line.";
      cx.notify();
      return;
    }
    cx.spawn(async (cx) => {
      try {
        const { text, value } = await readCommands();
        const others = value.commands.filter((saved) => saved.name !== this.original);
        if (others.some((saved) => saved.name === name)) throw new Error(`A command named ${name} is saved already.`);
        const ids = [...new Set(inputIds(`${command} ${cwd}`))];
        const known = Object.fromEntries(this.inputDefs.map((input) => [input.id, input]));
        const inputs = ids.map((id) => known[id] ?? { id, type: "promptString", description: id });
        const workspace = this.onlyHere && this.root ? this.root.replace(home(), "~") : null;
        const entry = {
          name,
          command,
          ...(cwd ? { cwd } : {}),
          ...(inputs.length ? { inputs } : {}),
          ...(workspace ? { workspace } : {}),
        };
        const index = value.commands.findIndex((saved) => saved.name === this.original);
        const commands =
          index >= 0 ? value.commands.map((saved, i) => (i === index ? entry : saved)) : [...value.commands, entry];
        await writeCommands(text, { ...value, commands });
        closeOverlay(props().overlay);
      } catch (error) {
        this.error = String(error?.message ?? error);
        cx.notify();
      }
    });
  }

  render() {
    const t = theme();
    const here = this.root?.split("/").pop();
    const checkbox = h_flex()
      .id("save-only-here")
      .pt(14)
      .gap(8)
      .items_center()
      .cursor_pointer()
      .text_size(12)
      .on_click((_event, cx) => {
        this.onlyHere = !this.onlyHere;
        cx.notify();
      })
      .child(
        div()
          .size(14)
          .rounded(4)
          .border_1()
          .border_color(this.onlyHere ? t.accent : t.input)
          .bg(this.onlyHere ? t.accent : t.background),
      )
      .child(here ? `Only in ${here} and its worktrees` : "Only in this workspace");
    const fields = [
      fieldLabel(t, "Name"),
      textField(t, this.name),
      fieldLabel(t, "Command: ${input:name} asks before it runs"),
      textField(t, this.command),
      fieldLabel(t, "Folder (empty: the workspace root)"),
      textField(t, this.cwd),
      ...(this.root ? [checkbox] : []),
    ];
    return dialog(t, this, this.original ? `Edit ${this.original}` : "Save a command", fields, [
      button(t, "save-cancel", "Cancel", false, () => closeOverlay(props().overlay)),
      button(t, "save-save", "Save", true, (_event, cx) => this.save(cx)),
    ]);
  }
}

/** A command line as a template, for saving a task as a command. */
function templateLine(command) {
  const word = (text) => (/^[A-Za-z0-9_@%+=:,./${}-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`);
  if ("argv" in command) return [...command.argv.map(word), ...(command.tail ? [command.tail] : [])].join(" ");
  return [command.shell, ...command.args.map((arg) => (arg.quoted ? word(arg.template) : arg.template))].join(" ");
}

export class MenuPart {
  init(cx) {
    this.handle = cx.focus_handle();
  }

  /** Opens the save form on a task's command, its inputs carried over. */
  saveTask(cx) {
    const { key, root, overlay } = props();
    cx.spawn(async () => {
      const { catalog, entry } = await loadEntry(key, root);
      if (entry?.command) {
        const prefill = {
          name: entry.name,
          command: templateLine(entry.command),
          cwd: entry.cwd === "${workspaceFolder}" ? "" : entry.cwd,
          inputs: entry.inputIds.map((id) => catalog.inputs[id]).filter(Boolean),
          workspace: true,
        };
        openOverlay({
          mod: "alp-runs",
          kind: "dialog",
          width: 460,
          height: 360,
          props: { part: "save", root, prefill },
        });
      }
      closeOverlay(overlay);
    });
  }

  /** Removes a saved command. */
  remove(cx, name) {
    cx.spawn(async () => {
      const { text, value } = await readCommands();
      await writeCommands(text, { ...value, commands: value.commands.filter((saved) => saved.name !== name) });
      closeOverlay(props().overlay);
    });
  }

  render() {
    const t = theme();
    const { key, root, overlay } = props();
    const name = key.replace(/^[a-z]+:/, "");
    const item = (id, label, action) =>
      div()
        .id(id)
        .px(12)
        .py(7)
        .rounded(6)
        .text_size(12.5)
        .cursor_pointer()
        .hover((style) => style.bg(t.hover))
        .on_click(action)
        .child(label);
    const items = key.startsWith("saved:")
      ? [
          item("menu-edit", "Edit…", () => {
            openOverlay({
              mod: "alp-runs",
              kind: "dialog",
              width: 460,
              height: 360,
              props: { part: "save", root, name },
            });
            closeOverlay(overlay);
          }),
          item("menu-delete", "Delete", (_event, cx) => this.remove(cx, name)),
        ]
      : [item("menu-save", "Save to my commands…", (_event, cx) => this.saveTask(cx))];
    return v_flex().id("alp-runs-menu").size_full().p(4).bg(t.popover).text_color(t.foreground).children(items);
  }
}
