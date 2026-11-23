// VS Code `${...}` variables, resolved into text a POSIX shell runs.

const EDITOR_VARIABLES = new Set([
  "file",
  "fileBasename",
  "fileBasenameNoExtension",
  "fileDirname",
  "fileDirnameBasename",
  "fileExtname",
  "fileWorkspaceFolder",
  "relativeFile",
  "relativeFileDirname",
  "lineNumber",
  "selectedText",
  "execPath",
  "defaultBuildTask",
]);

const VARIABLE = /\$\{([^}]+)\}/g;

/**
 * Why a template can't run outside VS Code, if it can't.
 * @param {string} text A value from a config.
 * @returns {string | null} The reason, or null when every variable resolves here.
 */
export function unsupportedReason(text) {
  for (const [, name] of String(text).matchAll(VARIABLE)) {
    if (EDITOR_VARIABLES.has(name)) return `uses \${${name}}, which needs an open editor`;
    if (name.startsWith("command:")) return `uses \${${name}}, a VS Code command`;
    if (name.startsWith("config:")) return `uses \${${name}}, a VS Code setting`;
  }
  return null;
}

/**
 * The `${input:id}` ids a template asks for.
 * @param {string} text A value from a config.
 * @returns {string[]} The ids, in order of appearance.
 */
export function inputIds(text) {
  return [...String(text).matchAll(VARIABLE)]
    .map(([, name]) => name)
    .filter((name) => name.startsWith("input:"))
    .map((name) => name.slice(6));
}

/**
 * Splits a template into literal text and environment references, with every other variable filled.
 * @param {string} text The template.
 * @param {{ workspace: string, home: string, answers: Record<string, string> }} context What variables resolve to.
 * @returns {({ text: string } | { env: string })[]} The pieces, in order.
 */
function pieces(text, context) {
  const parts = [];
  let last = 0;
  for (const match of String(text).matchAll(VARIABLE)) {
    parts.push({ text: String(text).slice(last, match.index) });
    last = match.index + match[0].length;
    const name = match[1];
    if (name.startsWith("env:")) parts.push({ env: name.slice(4) });
    else if (name.startsWith("input:")) parts.push({ text: context.answers[name.slice(6)] ?? "" });
    else if (name === "workspaceFolder" || name === "workspaceRoot" || name === "cwd")
      parts.push({ text: context.workspace });
    else if (name === "workspaceFolderBasename") parts.push({ text: context.workspace.split("/").pop() ?? "" });
    else if (name === "userHome") parts.push({ text: context.home });
    else if (name === "pathSeparator" || name === "/") parts.push({ text: "/" });
    else parts.push({ text: match[0] });
  }
  parts.push({ text: String(text).slice(last) });
  return parts;
}

/**
 * Quotes text for a POSIX shell so it reaches the program as one word.
 * @param {string} text The word.
 * @returns {string} The quoted word.
 */
export const quote = (text) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`);

/**
 * A template as shell source the shell reads as written, for a shell task's command line.
 * @param {string} text The template.
 * @param {{ workspace: string, home: string, answers: Record<string, string> }} context What variables resolve to.
 * @returns {string} Shell source.
 */
export const resolveRaw = (text, context) =>
  pieces(text, context)
    .map((part) => ("env" in part ? `\${${part.env}}` : part.text))
    .join("");

/**
 * A template as one quoted shell word, for an argument VS Code would pass without a shell.
 * @param {string} text The template.
 * @param {{ workspace: string, home: string, answers: Record<string, string> }} context What variables resolve to.
 * @returns {string} One shell word.
 */
export function resolveWord(text, context) {
  const word = pieces(text, context)
    .filter((part) => "env" in part || part.text)
    .map((part) => ("env" in part ? `"\${${part.env}}"` : quote(part.text)))
    .join("");
  return word || "''";
}

/**
 * A template as plain text, for a folder or a label, with environment references left in place.
 * @param {string} text The template.
 * @param {{ workspace: string, home: string, answers: Record<string, string> }} context What variables resolve to.
 * @returns {string} The text.
 */
export const resolveText = (text, context) =>
  pieces(text, context)
    .map((part) => ("env" in part ? `$${part.env}` : part.text))
    .join("");
