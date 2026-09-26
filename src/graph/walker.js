/**
 * src/graph/walker.js — Lightweight JS call-graph walker.
 *
 * Traces call paths from named entry functions to a named sink within
 * a single JS/TS file using regex-based heuristics. Not a full AST parser —
 * it reads function bodies and detects direct function calls by name.
 *
 * Limitations (stated explicitly):
 *   - Single-file scope only; does not follow cross-file imports.
 *   - Detects direct named calls: foo(), this.foo(), self.foo().
 *   - Does not resolve aliases, computed calls, prototype chains, or closures
 *     unless the called name literally appears in the source.
 *   - Works well for module-pattern code (factory functions with closures).
 *   - For large multi-file codebases, use a proper AST tool (acorn, ts-morph).
 *
 * Returns a PathTrace suitable for docs/path-map.md generation.
 */

import { readFileSync } from 'node:fs';

// ------------------------------------------------------------------ //
// Source reader                                                        //
// ------------------------------------------------------------------ //

/**
 * Extract named function/method bodies from JS source.
 * Handles: function foo() {}, const foo = function() {}, const foo = () => {},
 * foo(...) { ... } (method shorthand), async variants.
 * @param {string} source
 * @returns {Map<string, { body: string, startLine: number }>}
 */
function extractFunctions(source) {
  const fns = new Map();
  const lines = source.split('\n');

  // Pattern: function name(...) { OR const name = (...) => { OR async function name
  const funcPattern = /(?:async\s+)?function\s+(\w+)\s*\(/g;
  const arrowPattern = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(?[^)]*\)?\s*=>/g;
  const methodPattern = /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/gm;

  for (const [pattern, nameIdx] of [
    [funcPattern, 1],
    [arrowPattern, 1],
    [methodPattern, 1],
  ]) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const name = match[nameIdx];
      if (!name || fns.has(name)) continue;
      // Find the line number
      const upTo = source.slice(0, match.index);
      const startLine = upTo.split('\n').length;
      // Extract body: find matching braces from match position
      const bodyStart = source.indexOf('{', match.index);
      if (bodyStart === -1) continue;
      let depth = 0;
      let bodyEnd = bodyStart;
      for (let i = bodyStart; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
          depth--;
          if (depth === 0) { bodyEnd = i; break; }
        }
      }
      fns.set(name, { body: source.slice(bodyStart, bodyEnd + 1), startLine });
    }
  }
  return fns;
}

/**
 * Find all function names called inside a function body.
 * @param {string} body
 * @returns {string[]}
 */
function findCalls(body) {
  const calls = new Set();
  // Match: word( OR this.word( OR self.word(
  const callPattern = /(?:this\.|self\.)?(\w+)\s*\(/g;
  let m;
  while ((m = callPattern.exec(body)) !== null) {
    const name = m[1];
    // Filter out JS keywords and common built-ins
    if (!['if', 'for', 'while', 'switch', 'catch', 'new', 'return', 'typeof',
          'instanceof', 'await', 'async', 'function', 'class', 'import',
          'console', 'Object', 'Array', 'String', 'Number', 'Promise',
          'Error', 'Map', 'Set', 'JSON', 'Math'].includes(name)) {
      calls.add(name);
    }
  }
  return [...calls];
}

// ------------------------------------------------------------------ //
// Path trace                                                           //
// ------------------------------------------------------------------ //

/**
 * @typedef {{
 *   entry: string,
 *   sink: string,
 *   path: string[],      // function call chain entry → … → sink
 *   found: boolean,
 *   startLine: number,
 * }} PathTrace
 */

/**
 * BFS from entry toward sink, using extracted function bodies.
 * @param {string} entry
 * @param {string} sink
 * @param {Map<string, { body: string, startLine: number }>} fns
 * @returns {PathTrace}
 */
function tracePath(entry, sink, fns) {
  const entryInfo = fns.get(entry);
  if (!entryInfo) return { entry, sink, path: [entry], found: false, startLine: 0 };

  // BFS
  const queue = [[entry]];
  const visited = new Set([entry]);

  while (queue.length > 0) {
    const currentPath = queue.shift();
    const current = currentPath[currentPath.length - 1];
    const fnInfo = fns.get(current);
    if (!fnInfo) continue;

    const calls = findCalls(fnInfo.body);
    for (const called of calls) {
      if (called === sink) {
        return {
          entry,
          sink,
          path: [...currentPath, sink],
          found: true,
          startLine: entryInfo.startLine,
        };
      }
      if (!visited.has(called) && fns.has(called)) {
        visited.add(called);
        queue.push([...currentPath, called]);
      }
    }
  }

  return { entry, sink, path: [entry], found: false, startLine: entryInfo.startLine };
}

// ------------------------------------------------------------------ //
// Public API                                                           //
// ------------------------------------------------------------------ //

/**
 * @typedef {{
 *   file: string,
 *   entries: string[],
 *   sink: string,
 *   traces: PathTrace[],
 *   functions: string[],
 *   note: string,
 * }} WalkResult
 */

/**
 * Walk a JS file and trace all named entry paths to a sink.
 * @param {{ file: string, entries: string[], sink: string }} opts
 * @returns {WalkResult}
 */
export function walkFile({ file, entries, sink }) {
  const source = readFileSync(file, 'utf-8');
  const fns = extractFunctions(source);
  const traces = entries.map(entry => tracePath(entry, sink, fns));
  return {
    file,
    entries,
    sink,
    traces,
    functions: [...fns.keys()],
    note: 'Regex-based single-file walker. Does not follow cross-file imports or resolve aliases.',
  };
}

/**
 * Format a WalkResult as Markdown for docs/path-map.md.
 * @param {WalkResult} result
 * @returns {string}
 */
export function formatWalkResult(result) {
  const lines = [];
  lines.push(`## Auto-discovered paths in \`${result.file}\``);
  lines.push('');
  lines.push(`> ${result.note}`);
  lines.push('');

  for (const trace of result.traces) {
    const status = trace.found ? '✓ reaches sink' : '✗ no path to sink found';
    lines.push(`### \`${trace.entry}\` → \`${trace.sink}\`  (${status})`);
    if (trace.found) {
      lines.push('');
      lines.push('Call chain:');
      lines.push('```');
      lines.push(trace.path.join(' → '));
      lines.push('```');
    } else {
      lines.push('');
      lines.push('No direct call chain detected. The sink may be reached via a closure,');
      lines.push('dynamic dispatch, or a cross-file import outside this walker\'s scope.');
    }
    lines.push('');
  }

  lines.push('### All functions detected');
  lines.push('');
  for (const fn of result.functions) {
    const reachesSink = result.traces.some(t => t.path.includes(fn) && t.found);
    lines.push(`- \`${fn}\`${reachesSink ? '  ← on path to sink' : ''}`);
  }
  return lines.join('\n');
}
