// What the Run tab lists: a workspace's VS Code launch configurations and tasks, and the commands
// the person saved in ~/.config/alp/commands.json. Each becomes an entry the runner can start.

import { exec, home, readTextFile } from "herdr";
import { parseJsonc } from "./jsonc.js";
import { inputIds, unsupportedReason } from "./template.js";

export const COMMANDS_PATH = () => `${home()}/.config/alp/commands.json`;
const NODE_TYPES = new Set(["node", "pwa-node"]);
const PYTHON_TYPES = new Set(["python", "debugpy"]);
const BROWSER_TYPES = new Set(["chrome", "pwa-chrome", "msedge", "pwa-msedge", "firefox"]);

/** A path with a leading `~` made absolute, without a trailing slash. */
export const expandHome = (path) => (path?.startsWith("~") ? home() + path.slice(1) : (path ?? "")).replace(/\/+$/, "");

/** A string, or the `value` of VS Code's `{ value, quoting }` form. */
const text = (value) => (typeof value === "string" ? value : typeof value?.value === "string" ? value.value : "");

/** A list of names from a string, a list, or nothing. */
const names = (value) =>
  value == null
    ? []
    : (Array.isArray(value) ? value : [value])
        .map((item) => (typeof item === "string" ? item : (item?.label ?? "")))
        .filter(Boolean);

/**
 * The workspace a folder belongs to: its git checkout, and the main checkout when it is a worktree.
 * @param {string} folder A folder in the workspace.
 * @returns {Promise<{ root: string, mainRoot: string, name: string, repo: boolean }>}
 */
export async function findWorkspace(folder) {
  const result = await exec("git", [
    "-C",
    folder,
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--git-common-dir",
  ]).catch(() => null);
  const [root, common] = result?.code === 0 ? result.stdout.trim().split("\n") : [folder, ""];
  const absoluteCommon = common?.startsWith("/") ? common : `${root}/${common}`;
  const mainRoot = absoluteCommon.endsWith("/.git") ? absoluteCommon.slice(0, -5) : root;
  return { root, mainRoot, name: root.split("/").pop() ?? root, repo: result?.code === 0 };
}

/**
 * Every template an entry runs, so variables can be checked in one place.
 * @param {object} entry An entry without `unsupported` and `inputIds`.
 * @returns {string[]}
 */
function templatesOf(entry) {
  const command = entry.command;
  const words = !command
    ? []
    : "argv" in command
      ? [...command.argv, command.tail ?? ""]
      : [command.shell, ...command.args.map((arg) => arg.template)];
  return [...words, entry.cwd, entry.envFile ?? "", ...Object.values(entry.env ?? {})].map(String);
}

/** Adds what can't run here and which inputs it asks for. */
function finish(entry, reason = null) {
  const templates = templatesOf(entry);
  return {
    ...entry,
    unsupported: reason ?? templates.map(unsupportedReason).find(Boolean) ?? null,
    inputIds: [...new Set(templates.flatMap(inputIds))],
  };
}

/**
 * A launch configuration as an entry. Debugger-only types are kept, marked as not runnable here.
 * @param {object} config One item of `configurations`.
 * @returns {object} The entry.
 */
function launchEntry(config) {
  const base = {
    key: `launch:${config.name}`,
    kind: "launch",
    name: config.name,
    cwd: config.cwd ?? "${workspaceFolder}",
    env: config.env ?? {},
    envFile: config.envFile ?? null,
    dependsOn: names(config.preLaunchTask),
    dependsOrder: "sequence",
    isBackground: true,
    command: null,
  };
  if (config.request && config.request !== "launch") return finish(base, "attaches a debugger to a running program");
  if (BROWSER_TYPES.has(config.type)) return finish(base, "opens a browser under VS Code's debugger");
  const args = Array.isArray(config.args) ? config.args : [];
  const rawArgs = typeof config.args === "string" ? [{ template: config.args }] : [];
  if (config.type === "node-terminal") return finish({ ...base, command: { shell: config.command ?? "", args: [] } });
  if (NODE_TYPES.has(config.type)) {
    if (!config.program && !config.runtimeExecutable && !args.length) {
      return base.dependsOn.length ? finish(base) : finish(base, "names no program to run");
    }
    const argv = [
      config.runtimeExecutable ?? "node",
      ...(config.runtimeArgs ?? []),
      ...(config.program ? [config.program] : []),
      ...args,
    ];
    return finish({ ...base, command: { argv, tail: rawArgs[0]?.template ?? null } });
  }
  if (PYTHON_TYPES.has(config.type)) {
    const target = config.module ? ["-m", config.module] : config.program ? [config.program] : null;
    if (!target) return finish(base, "names no program to run");
    return finish({ ...base, command: { argv: [config.python ?? "python3", ...target, ...args] } });
  }
  return finish(base, `uses the ${config.type} debugger`);
}

/**
 * A compound launch: several configurations started together.
 * @param {object} compound One item of `compounds`.
 * @param {Map<string, object>} launches The launch entries by name.
 * @returns {object} The entry.
 */
function compoundEntry(compound, launches) {
  const configurations = names(compound.configurations);
  const missing = configurations.find((name) => !launches.has(name));
  const blocked = configurations.map((name) => launches.get(name)).find((entry) => entry?.unsupported);
  const reason = missing
    ? `names ${missing}, which isn't in launch.json`
    : blocked
      ? `includes ${blocked.name}, which ${blocked.unsupported}`
      : null;
  return {
    key: `compound:${compound.name}`,
    kind: "compound",
    name: compound.name,
    configurations,
    dependsOn: names(compound.preLaunchTask),
    dependsOrder: "sequence",
    isBackground: true,
    command: null,
    cwd: "${workspaceFolder}",
    env: {},
    envFile: null,
    unsupported: reason,
    inputIds: [],
  };
}

/**
 * A task as an entry, with the platform's own block (`osx`, `linux`, `windows`) applied.
 * @param {object} raw One item of `tasks`.
 * @param {string} platform "macos", "linux" or "windows".
 * @returns {object} The entry.
 */
function taskEntry(raw, platform) {
  const own = raw[{ macos: "osx", linux: "linux", windows: "windows" }[platform]] ?? {};
  const task = {
    ...raw,
    ...own,
    options: { ...raw.options, ...own.options, env: { ...raw.options?.env, ...own.options?.env } },
  };
  const name = task.label ?? task.taskName ?? text(task.command);
  const args = (task.args ?? []).map(text);
  const base = {
    key: `task:${name}`,
    kind: "task",
    name,
    cwd: task.options?.cwd ?? "${workspaceFolder}",
    env: task.options?.env ?? {},
    envFile: null,
    dependsOn: names(task.dependsOn),
    dependsOrder: task.dependsOrder === "sequence" ? "sequence" : "parallel",
    isBackground: Boolean(task.isBackground),
    command: null,
  };
  if (task.type === "npm") {
    const cwd = task.path ? `\${workspaceFolder}/${task.path}` : base.cwd;
    return finish({ ...base, cwd, command: { shell: `npm run ${task.script}`, args: [] } });
  }
  const command = text(task.command);
  if (!command) return base.dependsOn.length ? finish(base) : finish(base, "has no command");
  if (task.type === "process") return finish({ ...base, command: { argv: [command, ...args] } });
  if (task.type && task.type !== "shell")
    return finish(base, `is a ${task.type} task, which needs its VS Code extension`);
  return finish({
    ...base,
    command: { shell: command, args: args.map((arg) => ({ template: arg, quoted: /\s/.test(arg) })) },
  });
}

/**
 * A saved command as an entry.
 * @param {object} saved One item of commands.json's `commands`.
 * @returns {object} The entry.
 */
function savedEntry(saved) {
  return finish({
    key: `saved:${saved.name}`,
    kind: "saved",
    name: saved.name,
    cwd: saved.cwd ?? "${workspaceFolder}",
    env: saved.env ?? {},
    envFile: null,
    dependsOn: [],
    dependsOrder: "parallel",
    isBackground: false,
    command: { shell: saved.command ?? "", args: [] },
    workspace: saved.workspace ?? null,
    inputDefs: Object.fromEntries((saved.inputs ?? []).map((input) => [input.id, input])),
  });
}

/**
 * Reads and parses a JSONC file.
 * @param {string} path Where it is.
 * @param {string[]} errors Where a parse error is reported.
 * @returns {Promise<{ text: string | null, value: any }>} The text as read, and its value ({} when absent or broken).
 */
async function readConfig(path, errors) {
  const source = await readTextFile(path).catch(() => null);
  if (source == null) return { text: null, value: {} };
  try {
    return { text: source, value: parseJsonc(source) ?? {} };
  } catch (error) {
    errors.push(`${path.split("/").slice(-2).join("/")}: ${error}`);
    return { text: source, value: {} };
  }
}

/**
 * Everything the Run tab lists for a workspace.
 * @param {{ root: string, mainRoot: string }} workspace The workspace, from `findWorkspace`.
 * @param {string} platform "macos", "linux" or "windows".
 * @returns {Promise<{ launch: object[], tasks: object[], saved: object[], inputs: Record<string, object>, errors: string[], commandsText: string | null }>}
 */
export async function loadEntries(workspace, platform) {
  const errors = [];
  const [launchFile, tasksFile, commandsFile] = await Promise.all([
    readConfig(`${workspace.root}/.vscode/launch.json`, errors),
    readConfig(`${workspace.root}/.vscode/tasks.json`, errors),
    readConfig(COMMANDS_PATH(), errors),
  ]);
  const configs = (launchFile.value.configurations ?? []).filter((config) => config?.name).map(launchEntry);
  const byName = new Map(configs.map((entry) => [entry.name, entry]));
  const compounds = (launchFile.value.compounds ?? [])
    .filter((compound) => compound?.name)
    .map((compound) => compoundEntry(compound, byName));
  const tasks = (tasksFile.value.tasks ?? []).map((task) => taskEntry(task, platform)).filter((entry) => entry.name);
  const here = new Set([workspace.root, workspace.mainRoot]);
  const saved = (commandsFile.value.commands ?? [])
    .filter((command) => command?.name && command.command)
    .map(savedEntry)
    .filter((entry) => !entry.workspace || here.has(expandHome(entry.workspace)));
  const inputs = Object.fromEntries(
    [...(launchFile.value.inputs ?? []), ...(tasksFile.value.inputs ?? [])]
      .filter((input) => input?.id)
      .map((input) => [input.id, input]),
  );
  return { launch: [...compounds, ...configs], tasks, saved, inputs, errors, commandsText: commandsFile.text };
}
