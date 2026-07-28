/**
 * Shared helpers for the source scans that enforce this project's architectural
 * boundaries — `engine.test.js` (no Express/ws/DOM/`Math.random` in the domain),
 * `renderer-boundaries.test.js` (the renderer imports nothing internal), and
 * `species-schema.test.js` (no species id leaks into the engine).
 *
 * ⚠ **Comments must be stripped before matching**, per DOCS §1.4 D6: a scan once
 * rejected a file for the word "window." inside a doc comment. A guard that fires
 * on prose teaches people to word around it rather than to trust it. Every one of
 * these files *discusses* the thing it bans, at length and on purpose.
 *
 * ⚠ **And stripping with two regexes is what made the species scan blind.** All
 * three scans used to share this line:
 *
 * ```js
 * source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
 * ```
 *
 * Block comments first, line comments second — so a `/` followed by a `*` inside
 * a **line** comment reads as opening a block comment. `defaultSimulationConfig.js`
 * has exactly that: the literal `config/species/*` in a `//` comment on line 178.
 * The regex treated it as an opener and swallowed everything to the next `*​/`,
 * some six hundred lines later — including the entire `demo.founding` roster, the
 * one place in that file where species ids actually appear. The invariant the
 * species plan leans on was unenforced across the file where ids are most likely
 * to spread, and the test passed happily the whole time.
 *
 * Reversing the order does not fix it either; it just moves the blind spot (a
 * `*​/` inside a line comment inside a block comment). Comments are not a regular
 * language, so this is a one-pass scanner instead: it walks the source once,
 * tracking whether it is inside a line comment, a block comment, a quoted string,
 * or a template literal, and only the comment bytes are dropped. That also fixes a
 * second latent bug the old version papered over with its `[^:]` guard — a `//`
 * inside a **string** (`'https://…'`, or a regex like `/from\s+['"]\/\//`) used to
 * blank the rest of the line.
 */

/**
 * Remove `//` and block comments from JavaScript source, preserving everything
 * else byte for byte (comment bytes become spaces, so match offsets and line
 * numbers stay usable for error messages).
 *
 * String and template-literal contents are preserved: a scan asks what the code
 * *does*, and a `//` inside a string literal is data, not a comment. Escapes are
 * honoured, so `'it\\'s'` does not end the string early. Template substitutions
 * are treated as ordinary code, so a comment inside `${…}` is still stripped.
 *
 * This is deliberately not a full tokenizer — it does not distinguish a regex
 * literal from division, which for these scans is harmless: the only cost is that
 * a `//` inside a regex literal would be read as a comment, hiding code rather
 * than exposing it. No such pattern exists in the scanned trees.
 * `test/source-scan.test.js` pins every case above, including the exact line from
 * `defaultSimulationConfig.js` that caused the original blindness.
 *
 * @param {string} source JavaScript source text
 * @returns {string} the same text with comment bytes replaced by spaces
 */
export function stripComments(source) {
  const out = [...source];
  const n = source.length;
  // Brace depths of the template-literal substitutions currently open. Empty
  // means plain code; one entry per `${` we are nested inside, so a template in
  // a substitution in a template unwinds correctly.
  const templates = [];
  let i = 0;

  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    // Line comment: to the end of the line, newline kept.
    if (c === '/' && next === '/') {
      let end = source.indexOf('\n', i);
      if (end === -1) end = n;
      blank(i, end);
      i = end;
      continue;
    }

    // Block comment: to the closing delimiter, newlines kept so line numbers hold.
    if (c === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      blank(i, end);
      i = end;
      continue;
    }

    // A quoted string: contents are data, including any `//` inside them.
    if (c === '"' || c === "'") {
      i = skipQuoted(source, i, c);
      continue;
    }

    // A template literal: its text is data until the closing backtick or a `${`.
    if (c === '`') {
      i = skipTemplateText(source, i + 1, templates);
      continue;
    }

    // Inside a substitution, braces say when the template's text resumes. ⚠ This
    // is the part the first version of this scanner got wrong: it broke out at
    // `${` and never came back, so everything after a substitution was read as
    // code. In a file of HTML templates that means every `"` opens a bogus
    // string, the scanner desyncs, and comments stop being stripped — which
    // surfaced as `Controls.js` failing the renderer boundary scan for a
    // `Math.random` that appears only inside a comment explaining the ban.
    if (templates.length > 0) {
      if (c === '{') {
        templates[templates.length - 1] += 1;
        i += 1;
        continue;
      }
      if (c === '}') {
        templates[templates.length - 1] -= 1;
        if (templates[templates.length - 1] === 0) {
          templates.pop();
          i = skipTemplateText(source, i + 1, templates);
          continue;
        }
        i += 1;
        continue;
      }
    }

    i += 1;
  }

  return out.join('');
}

/**
 * Skip a `'`/`"` string, returning the index just past its closing quote.
 * A raw newline ends it: such a string is invalid JavaScript, and bailing at the
 * line end keeps a mis-sync from swallowing the rest of the file.
 */
function skipQuoted(source, start, quote) {
  let i = start + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    if (c === '\n') return i;
    i += 1;
  }
  return i;
}

/**
 * Skip the literal text of a template, from `start` up to either its closing
 * backtick (returning the index past it, back in plain code) or the `${` of a
 * substitution (pushing its brace depth and returning the index past it, so the
 * caller resumes scanning the substitution as code).
 */
function skipTemplateText(source, start, templates) {
  let i = start;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '`') return i + 1;
    if (c === '$' && source[i + 1] === '{') {
      templates.push(1);
      return i + 2;
    }
    i += 1;
  }
  return i;
}

/**
 * The `demo.founding` roster in `defaultSimulationConfig.js` is the **one place
 * outside `config/species/` where species ids legitimately appear** — it is the
 * scenario definition saying which species the demo world starts with, which is
 * exactly the config edit that makes "a species is data" true.
 *
 * Excising it by name is the point: the rest of that 800-line file stays scanned,
 * so an id leaking into (say) a decision threshold or a terrain rule is still
 * caught. Until 2026-07-28 this exemption existed only by accident, as a side
 * effect of the comment-stripping bug above, and it covered six hundred lines
 * rather than nine.
 *
 * @param {string} source config source, comments already stripped
 * @returns {string} the same source with the founding roster removed
 */
export function removeDemoFoundingRoster(source) {
  const start = source.indexOf('founding:');
  if (start === -1) return source;
  const open = source.indexOf('[', start);
  if (open === -1) return source;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '[') depth += 1;
    else if (source[i] === ']') {
      depth -= 1;
      if (depth === 0) return `${source.slice(0, start)}${source.slice(i + 1)}`;
    }
  }
  return source;
}
