// JSON with comments and trailing commas, as VS Code writes `launch.json` and `tasks.json`.

/**
 * The index of the next character that is not whitespace or inside a comment.
 * @param {string} text JSONC source.
 * @param {number} from Where to start looking.
 * @returns {number} That index, or the text's length.
 */
function nextSignificant(text, from) {
  let i = from;
  while (i < text.length) {
    if (/\s/.test(text[i])) i++;
    else if (text[i] === '/' && text[i + 1] === '/') while (i < text.length && text[i] !== '\n') i++;
    else if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
    } else return i;
  }
  return i;
}

/**
 * Removes `//` and `/* *\/` comments and trailing commas, leaving strings as they are.
 * @param {string} text JSONC source.
 * @returns {string} Plain JSON source.
 */
export function stripJsonc(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      const start = i;
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      out += text.slice(start, i + 1);
      i++;
    } else if (char === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      i = nextSignificant(text, i);
    } else if (char === ',') {
      const after = nextSignificant(text, i + 1);
      if (text[after] !== '}' && text[after] !== ']') out += char;
      i++;
    } else {
      out += char;
      i++;
    }
  }
  return out;
}

/**
 * Parses JSONC text.
 * @param {string} text JSONC source.
 * @returns {any} The parsed value.
 */
export const parseJsonc = (text) => JSON.parse(stripJsonc(text));
