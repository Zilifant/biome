/**
 * The source scans that enforce this project's architectural boundaries are only
 * as trustworthy as their comment stripping, and for a long time they were not
 * trustworthy at all — see the ⚠ in `helpers/sourceScan.js`. This suite pins the
 * stripper itself, so the guard cannot go quietly blind again.
 *
 * The regression case is first, and it is a real line from
 * `defaultSimulationConfig.js`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { stripComments, removeDemoFoundingRoster } from './helpers/sourceScan.js';

describe('source scan: comment stripping', () => {
  test('⚠ a `/*` inside a LINE comment does not open a block comment', () => {
    // The exact shape that blinded the species scan across 600 lines of config:
    // the literal `config/species/*` inside a `//` comment.
    const source = ['// biology lives in config/species/*', "const id = 'herbivore.gazelle';", '// trailing'].join('\n');
    const stripped = stripComments(source);
    assert.ok(stripped.includes("'herbivore.gazelle'"), 'code after the line comment must survive');
    assert.ok(!stripped.includes('config/species'), 'the line comment itself is gone');
  });

  test('⚠ a `*/` inside a LINE comment does not close a block comment', () => {
    // The mirror case, which is why reversing the two regexes was not the fix.
    const source = ['/**', ' * A doc block.', ' */', '// closing looks like */ here', "const id = 'predator.stalker';"].join('\n');
    const stripped = stripComments(source);
    assert.ok(stripped.includes("'predator.stalker'"), 'code after both comment kinds must survive');
    assert.ok(!stripped.includes('A doc block'), 'the block comment is gone');
  });

  test('a `//` inside a string is data, not a comment', () => {
    const source = ["const url = 'https://example.com';", "const banned = 'Math.random';"].join('\n');
    const stripped = stripComments(source);
    assert.ok(stripped.includes('https://example.com'), 'string contents are preserved');
    assert.ok(stripped.includes('Math.random'), 'a banned token inside a string still scans');
  });

  test('an escaped quote does not end a string early', () => {
    const source = String.raw`const s = 'it\'s fine'; // gone`;
    const stripped = stripComments(source);
    assert.ok(stripped.includes(String.raw`'it\'s fine'`), 'the whole string survives');
    assert.ok(!stripped.includes('gone'), 'the trailing comment is stripped');
  });

  test('comments inside a template substitution are still stripped', () => {
    const source = 'const t = `a ${b /* note */ + c} d`;';
    const stripped = stripComments(source);
    assert.ok(!stripped.includes('note'), 'a comment inside ${} is code context');
    assert.ok(stripped.includes('`a ${b'), 'the literal parts survive');
  });

  test('⚠ template text RESUMES after a substitution closes', () => {
    // The bug the first version of this scanner shipped with: it left template
    // mode at `${` and never returned, so everything after a substitution was
    // read as code. In a file of HTML templates, the very next `"` opens a bogus
    // string, the scanner desyncs, and comments stop being stripped — which is
    // exactly how `Controls.js` failed the renderer scan for a `Math.random`
    // that appears only inside a comment saying it is banned.
    const source = ['const html = `<input value="${x}" aria-label="Start" />`;', '// Math.random is banned here'].join('\n');
    const stripped = stripComments(source);
    assert.ok(!stripped.includes('banned'), 'the trailing line comment is still stripped');
    assert.ok(!stripped.includes('Math.random'), 'and so is the token it mentions');
    assert.ok(stripped.includes('aria-label="Start"'), 'template text after ${} stays text');
  });

  test('nested templates and nested braces unwind correctly', () => {
    const source = 'const t = `a ${ f({ k: `inner ${v}` }) } b`; // gone';
    const stripped = stripComments(source);
    assert.ok(!stripped.includes('gone'), 'the comment after a nested template is stripped');
    assert.ok(stripped.includes('b`;'), 'the outer template closes where it should');
  });

  test('an apostrophe in template text does not open a string', () => {
    const source = ["const t = `it's ${x} fine`;", '// gone'].join('\n');
    const stripped = stripComments(source);
    assert.ok(!stripped.includes('gone'), 'the following comment is still reachable');
  });

  test('line numbers and offsets are preserved', () => {
    const source = ['const a = 1; // one', '/* two', ' * three', ' */', 'const b = 2;'].join('\n');
    const stripped = stripComments(source);
    assert.equal(stripped.length, source.length, 'stripping replaces rather than deletes');
    assert.equal(stripped.split('\n').length, source.split('\n').length, 'newlines are kept');
    assert.equal(stripped.split('\n')[4], 'const b = 2;');
  });

  test('an unterminated block comment swallows the rest, and nothing more', () => {
    const source = ["const a = 'kept';", '/* never closed', "const b = 'hidden';"].join('\n');
    const stripped = stripComments(source);
    assert.ok(stripped.includes("'kept'"), 'code before the opener survives');
    assert.ok(!stripped.includes("'hidden'"), 'code after an unclosed opener is treated as comment');
  });
});

describe('source scan: the demo founding roster exemption', () => {
  test('the roster is excised and the rest of the config is not', () => {
    const source = [
      'export const config = {',
      "  terrain: { note: 'herbivore.gazelle' },",
      '  demo: {',
      '    founding: [',
      "      { speciesId: 'herbivore.gazelle', count: 120 },",
      "      { speciesId: 'predator.stalker', count: 8 },",
      '    ],',
      '  },',
      '};',
    ].join('\n');
    const trimmed = removeDemoFoundingRoster(source);
    assert.ok(!trimmed.includes('count: 120'), 'the roster is gone');
    assert.ok(trimmed.includes("terrain: { note: 'herbivore.gazelle' }"), 'an id anywhere else is still exposed');
  });

  test('against the real config, the roster is the only place ids appear', () => {
    // The claim the species scan rests on, asserted against the actual file
    // rather than trusted: with comments stripped correctly and the roster
    // excised, no species id remains anywhere in the config.
    const raw = readFileSync('src/simulation/config/defaultSimulationConfig.js', 'utf8');
    const scanned = removeDemoFoundingRoster(stripComments(raw));
    for (const id of ['herbivore.gazelle', 'predator.stalker', 'scavenger.vulture']) {
      assert.ok(!scanned.includes(id), `${id} appears outside demo.founding`);
    }
    // And the exemption is narrow: the roster really was in there to begin with.
    assert.ok(stripComments(raw).includes('herbivore.gazelle'), 'the roster is visible before excision');
  });
});
