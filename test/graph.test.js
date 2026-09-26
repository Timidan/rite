/**
 * test/graph.test.js — Direct unit tests for src/graph/walker.js.
 *
 * Runs walkFile against the actual src/refunds.js (fixed version)
 * and verifies the exact expected call chains.
 * If refunds.js is refactored, this test catches the regression immediately.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkFile, formatWalkResult } from '../src/graph/walker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REFUNDS_FILE = join(__dirname, '..', 'src', 'refunds.js');

describe('walkFile — src/refunds.js', () => {
  const result = walkFile({
    file: REFUNDS_FILE,
    entries: ['customerRefund', 'supportRefund'],
    sink: 'issueRefund',
  });

  it('detects customerRefund → issueRefund', () => {
    const trace = result.traces.find(t => t.entry === 'customerRefund');
    assert.ok(trace, 'trace for customerRefund not found');
    assert.equal(trace.found, true, 'customerRefund should reach issueRefund');
  });

  it('detects supportRefund → issueRefund', () => {
    const trace = result.traces.find(t => t.entry === 'supportRefund');
    assert.ok(trace, 'trace for supportRefund not found');
    assert.equal(trace.found, true, 'supportRefund should reach issueRefund');
  });

  it('call chain includes authorizeAndRefund (shared guard)', () => {
    const trace = result.traces.find(t => t.entry === 'customerRefund');
    assert.ok(trace.path.includes('authorizeAndRefund'),
      `Expected authorizeAndRefund in path: ${trace.path.join(' → ')}`);
  });

  it('both paths route through authorizeAndRefund', () => {
    for (const trace of result.traces) {
      assert.ok(trace.path.includes('authorizeAndRefund'),
        `${trace.entry}: expected authorizeAndRefund in path: ${trace.path.join(' → ')}`);
    }
  });

  it('detects known functions including private helpers', () => {
    const fns = result.functions;
    assert.ok(fns.includes('authorizeAndRefund'), 'authorizeAndRefund should be detected');
    assert.ok(fns.includes('issueRefund'), 'issueRefund should be detected');
    assert.ok(fns.includes('createRefundService'), 'createRefundService should be detected');
    assert.ok(fns.includes('snapshot'), 'snapshot should be detected');
  });

  it('issueRefund is marked on-path for both traces', () => {
    // Every trace that found the sink should include issueRefund in its path
    for (const trace of result.traces.filter(t => t.found)) {
      assert.ok(trace.path.includes('issueRefund'),
        `${trace.entry}: sink issueRefund not in path`);
    }
  });
});

describe('formatWalkResult', () => {
  it('produces non-empty markdown output', () => {
    const result = walkFile({
      file: REFUNDS_FILE,
      entries: ['customerRefund'],
      sink: 'issueRefund',
    });
    const md = formatWalkResult(result);
    assert.ok(typeof md === 'string' && md.length > 0);
    assert.ok(md.includes('customerRefund'));
    assert.ok(md.includes('issueRefund'));
    assert.ok(md.includes('reaches sink'));
  });

  it('reports NO PATH FOUND for a nonexistent entry', () => {
    const result = walkFile({
      file: REFUNDS_FILE,
      entries: ['nonExistentFn'],
      sink: 'issueRefund',
    });
    const trace = result.traces[0];
    assert.equal(trace.found, false);
    const md = formatWalkResult(result);
    assert.ok(md.includes('no path to sink'));
  });
});
