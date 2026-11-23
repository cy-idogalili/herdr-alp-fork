// Runs: the workspace's VS Code launch configs, tasks and saved commands, started as named,
// labelled herdr-core terminals. One mod draws every piece, chosen by `props().part`:
// - `list`: Basecamp's Run tab.
// - `bar`, `sessions`, `empty`: the bottom panel's bar, sessions list and output placeholder.
// - `input`, `save`, `menu`: the Run tab's dialogs and right-click menu.

import { View, div } from "gpui-kit";
import { props } from "herdr";
import { ListPart } from "./list-view.js";
import { BarPart, EmptyPart, SessionsPart } from "./panel-view.js";
import { InputPart, MenuPart, SavePart } from "./forms.js";

const PARTS = {
  list: ListPart,
  bar: BarPart,
  sessions: SessionsPart,
  empty: EmptyPart,
  input: InputPart,
  save: SavePart,
  menu: MenuPart,
};

export default class Runs extends View {
  init(_props, cx) {
    const Part = PARTS[props()?.part] ?? null;
    this.part = Part ? new Part() : null;
    this.part?.init(cx);
  }

  render(cx) {
    return this.part ? this.part.render(cx) : div().child(`alp-runs: unknown part ${props()?.part}`);
  }
}
