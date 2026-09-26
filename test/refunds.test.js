/**
 * test/refunds.test.js — Node test adapter over the shared runner.
 *
 * Uses Node built-in node:test and node:assert/strict.
 * Writes proof.json when RITE_REPORT_PATH is set (used by prove.mjs).
 * All filesystem access is here; checks.js and cases.js remain fs-free.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { runSuite } from '../src/checks.js';
import { BOUNDARY_CHECKS } from '../src/cases.js';
import { createRefundService } from '../src/refunds.js';

// Run the full suite once and share.
let suiteReport;

before(async () => {
  suiteReport = runSuite();
});

// ------------------------------------------------------------------ //
// Helper to look up a result by id                                     //
// ------------------------------------------------------------------ //
function getResult(id) {
  const r = suiteReport.results.find(r => r.id === id);
  assert.ok(r, `Result not found: ${id}`);
  return r;
}

// ------------------------------------------------------------------ //
// Boundary checks (compact)                                            //
// ------------------------------------------------------------------ //
const boundaryResults = [];

describe('Boundary checks', () => {
  for (const bc of BOUNDARY_CHECKS) {
    it(bc.label, () => {
      const entries = ['customer', 'support'];
      for (const entry of entries) {
        const svc = createRefundService({ orders: bc.seeds.map(s => ({ ...s })) });
        const fn = entry === 'customer' ? svc.customerRefund : svc.supportRefund;
        const result = fn(bc.call.request, bc.call.context);
        const snap = svc.snapshot();

        const passed = result.ok === bc.expectedOk &&
          result.code === bc.expectedCode &&
          (!bc.zeroEvents || snap.events.length === 0);

        boundaryResults.push({
          id: `${bc.id}:${entry}`,
          label: bc.label,
          entry,
          passed,
          result,
          eventsAfter: snap.events.length,
        });

        assert.equal(result.ok, bc.expectedOk,
          `${bc.id}:${entry} — expected ok=${bc.expectedOk}; got ${result.ok}`);
        assert.equal(result.code, bc.expectedCode,
          `${bc.id}:${entry} — expected code=${bc.expectedCode}; got ${result.code}`);
        if (bc.zeroEvents) {
          assert.equal(snap.events.length, 0,
            `${bc.id}:${entry} — expected 0 events; got ${snap.events.length}`);
        }
      }
    });
  }
});

// ------------------------------------------------------------------ //
// Policy suite                                                         //
// ------------------------------------------------------------------ //
describe('Policy suite', () => {
  it('runSuite produces exactly 10 results', () => {
    assert.equal(suiteReport.results.length, 10, 'Expected 10 results');
  });

  it('All 10 expected result IDs present exactly once', () => {
    const EXPECTED_IDS = [
      'valid-owner:customer', 'valid-owner:support',
      'wrong-owner:customer', 'wrong-owner:support',
      'unpaid-order:customer', 'unpaid-order:support',
      'already-refunded:customer', 'already-refunded:support',
      'repeat-request:customer', 'repeat-request:support',
    ];
    for (const id of EXPECTED_IDS) {
      const matches = suiteReport.results.filter(r => r.id === id);
      assert.equal(matches.length, 1, `Expected exactly one result for ${id}`);
    }
  });

  it('No result has ERROR status', () => {
    for (const r of suiteReport.results) {
      assert.notEqual(r.status, 'ERROR',
        `Unexpected ERROR in ${r.id}: ${r.error}`);
    }
  });

  it('valid-owner:customer — PASS', () => {
    const r = getResult('valid-owner:customer');
    assert.equal(r.status, 'PASS', r.failures.join('\n'));
  });

  it('valid-owner:support — PASS', () => {
    const r = getResult('valid-owner:support');
    assert.equal(r.status, 'PASS', r.failures.join('\n'));
  });

  it('wrong-owner:customer — PASS', () => {
    const r = getResult('wrong-owner:customer');
    assert.equal(r.status, 'PASS', r.failures.join('\n'));
  });

  it('wrong-owner:support — PASS', () => {
    const r = getResult('wrong-owner:support');
    assert.equal(r.status, 'PASS', r.failures.join('\n'));
  });

  it('unpaid-order:customer — PASS', () => {
    const r = getResult('unpaid-order:customer');
    assert.equal(r.status, 'PASS', r.failures.join('\n'));
  });

  it('unpaid-order:support — PASS', () => {
    const r = getResult('unpaid-order:support');
    assert.equal(r.status, 'PASS', r.failures.join('\n'));
  });

  it('already-refunded:customer — PASS', () => {
    const r = getResult('already-refunded:customer');
    assert.equal(r.status, 'PASS', r.failures.join('\n'));
  });

  it('already-refunded:support — PASS', () => {
    const r = getResult('already-refunded:support');
    assert.equal(r.status, 'PASS', r.failures.join('\n'));
  });

  it('repeat-request:customer — first REFUNDED, second ALREADY_REFUNDED, one event total', () => {
    const r = getResult('repeat-request:customer');
    assert.equal(r.status, 'PASS', r.failures.join('\n'));
    assert.equal(r.calls.length, 2);
    assert.equal(r.calls[0].observed.result.code, 'REFUNDED');
    assert.equal(r.calls[1].observed.result.code, 'ALREADY_REFUNDED');
    // Total events in snapshot after both calls: exactly 1
    const totalEvents = r.calls[1].observed.snapshotAfter?.events?.length ?? -1;
    assert.equal(totalEvents, 1, `Expected 1 total event; got ${totalEvents}`);
  });

  it('repeat-request:support — first REFUNDED, second ALREADY_REFUNDED, one event total', () => {
    const r = getResult('repeat-request:support');
    assert.equal(r.status, 'PASS', r.failures.join('\n'));
    assert.equal(r.calls.length, 2);
    assert.equal(r.calls[0].observed.result.code, 'REFUNDED');
    assert.equal(r.calls[1].observed.result.code, 'ALREADY_REFUNDED');
    const totalEvents = r.calls[1].observed.snapshotAfter?.events?.length ?? -1;
    assert.equal(totalEvents, 1, `Expected 1 total event; got ${totalEvents}`);
  });

  it('Suite aggregate status is PASS', () => {
    assert.equal(suiteReport.status, 'PASS',
      `Suite status: ${suiteReport.status}`);
  });
});

// ------------------------------------------------------------------ //
// Write structured report when RITE_REPORT_PATH is set                 //
// (Filesystem access only here, never in checks.js)                    //
// ------------------------------------------------------------------ //
// We use a process exit hook via beforeExit to write after all tests complete.
process.on('beforeExit', () => {
  const reportPath = process.env.RITE_REPORT_PATH;
  if (!reportPath) return;
  try {
    const report = {
      suiteReport,
      boundaryChecks: boundaryResults,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  } catch (e) {
    // Don't swallow — this is a proof integrity issue.
    process.stderr.write(`RITE: failed to write report: ${e.message}\n`);
  }
});
