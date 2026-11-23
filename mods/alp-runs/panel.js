// The bottom panel's output block. It shows the selected session's terminal, or the `empty` part
// when none is selected. Herdr drops a terminal block whose terminal ends, so the block is
// written back whenever it goes missing.

import { layout, run, setShared, shared } from "herdr";

export const PANEL_ID = "bottom-panel";
const BODY_ID = "runs-body";
const OUTPUT_ID = "run-output";
const SELECTED_KEY = "alp.runs.selected";
const SELECTED_AT_KEY = "alp.runs.selectedAt";
const BASECAMP_ID = "basecamp";
const BASECAMP_STACK = "basecamp-body";
const RUN_TAB = "basecamp-run";

/**
 * Finds a node in the layout tree by id.
 * @param {object} node The tree.
 * @param {string} id The node's id.
 * @returns {object | null}
 */
export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

/** The selected session's terminal address, if any. */
export const selectedAddress = () => shared(SELECTED_KEY) ?? null;

/** When the current selection was made, in ms. */
export const selectedAt = () => shared(SELECTED_AT_KEY) ?? 0;

/** What the output block shows for a selection. */
const contentFor = (address) => (address ? { terminal: address } : { mod: "alp-runs", props: { part: "empty" } });

/** True when the output block already shows the selection. */
export function outputShows(address) {
  const output = find(layout(), OUTPUT_ID);
  return Boolean(output) && JSON.stringify(output.content) === JSON.stringify(contentFor(address));
}

/**
 * Selects a session and points the output block at its terminal, writing the block back if Herdr
 * dropped it. Null selects nothing.
 * @param {string | null} address The session's terminal address.
 * @param {{ reveal?: boolean }} options `reveal`: also show the bottom panel (default true).
 */
export function showSession(address, { reveal = true } = {}) {
  if (selectedAddress() !== address) {
    setShared(SELECTED_KEY, address);
    setShared(SELECTED_AT_KEY, Date.now());
  }
  if (!outputShows(address)) {
    const tree = JSON.parse(JSON.stringify(layout()));
    const body = find(tree, BODY_ID);
    if (!body) return;
    const output = find(tree, OUTPUT_ID);
    if (output) output.content = contentFor(address);
    else body.children.unshift({ id: OUTPUT_ID, type: "block", content: contentFor(address) });
    run("layout.set", { layout: tree });
  }
  if (reveal) run("layout.show", { id: PANEL_ID });
}

/** Shows Basecamp on its Run tab. */
export function openRunTab() {
  run("layout.select", { stack: BASECAMP_STACK, child: RUN_TAB });
  run("layout.show", { id: BASECAMP_ID });
}
