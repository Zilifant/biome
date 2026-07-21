import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The renderer portrays authoritative simulation output; it must never
 * import simulation internals, the server, or even engine-side protocol
 * code — it speaks the protocol purely as message shapes over a transport.
 */
describe('renderer architectural boundary', () => {
  test('renderer modules import nothing from simulation, server, protocol, or node backends', () => {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const rendererRoot = path.join(projectRoot, 'src/renderer/app');
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) files.push(full);
      }
    };
    walk(rendererRoot);
    assert.ok(files.length >= 14, `expected to scan the renderer modules, found ${files.length}`);

    const forbidden = [
      { pattern: /from\s+['"][^'"]*\/simulation\//, label: 'simulation import' },
      { pattern: /from\s+['"][^'"]*\/server\//, label: 'server import' },
      { pattern: /from\s+['"][^'"]*\/protocol\//, label: 'engine-side protocol import' },
      { pattern: /from\s+['"][^'"]*\/fixtures\/createDemoSimulation/, label: 'simulation fixture import' },
      { pattern: /from\s+['"]express['"]/, label: 'express import' },
      { pattern: /from\s+['"]ws['"]/, label: 'ws package import' },
      { pattern: /from\s+['"]node:/, label: 'node builtin import' },
      { pattern: /\brequire\s*\(/, label: 'CommonJS require' },
      { pattern: /\bMath\.random\b/, label: 'unseeded randomness (presentation must be deterministic)' },
    ];
    // Strip comments before scanning, exactly as the engine-side scan in
    // engine.test.js does and for the same reason (§1.4 D6): these patterns are
    // about what the code *does*, and prose explaining why `Math.random` is
    // banned here is not itself a violation. A scan that fires on documentation
    // trains people to word around it rather than to trust it.
    const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const file of files) {
      const raw = readFileSync(file, 'utf8');
      const source = stripComments(raw);
      for (const { pattern, label } of forbidden) {
        assert.ok(!pattern.test(source), `${path.relative(projectRoot, file)} contains forbidden ${label}`);
      }
      // Every relative import must stay inside the renderer app directory.
      for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const resolved = path.resolve(path.dirname(file), match[1]);
        assert.ok(
          resolved.startsWith(rendererRoot + path.sep),
          `${path.relative(projectRoot, file)} imports outside the renderer: ${match[1]}`,
        );
      }
    }
  });

  test('the simulation stores no renderer concepts (no glyphs or colors in entity state)', () => {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const source = readFileSync(path.join(projectRoot, 'src/simulation/world/EntityManager.js'), 'utf8');
    for (const term of ['glyph', 'color', 'sprite', 'dracula']) {
      assert.ok(!source.toLowerCase().includes(term), `simulation entity state mentions "${term}"`);
    }
  });
});
