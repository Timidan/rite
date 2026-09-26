/**
 * checks.js — Browser-safe case execution and effect comparison.
 *
 * Imports the service and literal cases. No Node fs/path/crypto/child_process.
 * No DOM globals. No React. Runs identically in Node and in the browser.
 */

import { createRefundService } from './refunds.js';
import { CASES } from './cases.js';
import { compareEffects } from './instrument/effect-schema.js';

/**
 * @typedef {{ orderId: string }} RefundRequest
 * @typedef {{ actorId: string }|null} RefundContext
 */

/**
 * One comparison of expected vs. observed for a single call.
 * @typedef {{
 *   expected: {
 *     ok: boolean,
 *     code: string,
 *     sinkCalls: number,
 *     event?: object,
 *     orderAfterRefunded?: boolean,
 *   },
 *   observed: {
 *     result: object,
 *     sinkCalls: number,
 *     events: object[],
 *     orderAfter: object|null,
 *     snapshotBefore?: object,
 *     snapshotAfter?: object,
 *   },
 * }} CallObservation
 */

/**
 * @typedef {{
 *   id: string,
 *   entry: 'customer'|'support',
 *   label: string,
 *   status: 'PASS'|'FAIL'|'ERROR',
 *   calls: CallObservation[],
 *   failures: string[],
 *   error: string|null,
 * }} CaseResult
 */

/**
 * @typedef {{
 *   status: 'PASS'|'FAIL'|'ERROR',
 *   results: CaseResult[],
 * }} SuiteReport
 */

/**
 * Select the correct entry function from a service instance.
 * @param {ReturnType<typeof createRefundService>} svc
 * @param {'customer'|'support'} entry
 * @returns {(req: object, ctx: object|null) => object}
 */
function selectEntry(svc, entry) {
  if (entry === 'customer') return svc.customerRefund.bind(svc);
  if (entry === 'support') return svc.supportRefund.bind(svc);
  throw new Error(`Unknown entry: ${entry}`);
}

/**
 * Assert that a snapshot value has the expected shape.
 * Throws immediately if the contract is broken — silent field misses
 * produce wrong verdicts, not passing tests.
 * Expected shape: { orders: object[], events: object[] }
 * @param {unknown} snap
 * @param {string} label
 */
function assertSnapshotShape(snap, label) {
  if (!snap || typeof snap !== 'object')
    throw new Error(`${label}: snapshot() returned non-object`);
  const s = /** @type {Record<string,unknown>} */ (snap);
  if (!Array.isArray(s.orders))
    throw new Error(`${label}: snapshot().orders is not an array (got ${typeof s.orders}). Did refunds.js change its snapshot shape?`);
  if (!Array.isArray(s.events))
    throw new Error(`${label}: snapshot().events is not an array (got ${typeof s.events}). Did refunds.js change its snapshot shape?`);
}

/**
 * Compare two snapshot orders to detect mutation in denial cases.
 * @param {object} before
 * @param {object} after
 * @returns {string[]} Failure messages, empty if identical.
 */
function detectMutation(before, after) {
  const failures = [];
  const bOrders = before.orders;
  const aOrders = after.orders;
  if (bOrders.length !== aOrders.length) {
    failures.push(`Order count changed: ${bOrders.length} → ${aOrders.length}`);
    return failures;
  }
  for (let i = 0; i < bOrders.length; i++) {
    const bO = bOrders[i];
    const aO = aOrders[i];
    for (const key of Object.keys(bO)) {
      if (bO[key] !== aO[key]) {
        failures.push(`Order ${bO.id}.${key} mutated: ${bO[key]} → ${aO[key]}`);
      }
    }
  }
  return failures;
}

/**
 * Run one scenario through one entry path.
 * Creates its own fresh service instance (except the repeat-request case,
 * which shares one instance across its two calls by design).
 *
 * @param {import('./cases.js').CaseSpec} caseSpec
 * @param {'customer'|'support'} entry
 * @returns {CaseResult}
 */
export function runCase(caseSpec, entry) {
  const resultId = `${caseSpec.id}:${entry}`;
  /** @type {CaseResult} */
  const result = {
    id: resultId,
    entry,
    label: caseSpec.label,
    status: 'PASS',
    calls: [],
    failures: [],
    error: null,
  };

  try {
    const svc = createRefundService({ orders: caseSpec.seeds.map(s => ({ ...s })) });
    const entryFn = selectEntry(svc, entry);

    let cumulativeEventsBefore = 0;

    for (let i = 0; i < caseSpec.calls.length; i++) {
      const call = caseSpec.calls[i];
      const exp = caseSpec.expected[i];

      const snapBefore = svc.snapshot();
      assertSnapshotShape(snapBefore, `${resultId} call ${i + 1} (before)`);
      const eventsCountBefore = snapBefore.events.length;

      const callResult = entryFn(call.request, call.context);

      const snapAfter = svc.snapshot();
      assertSnapshotShape(snapAfter, `${resultId} call ${i + 1} (after)`);
      const newEvents = snapAfter.events.slice(eventsCountBefore);
      const newSinkCalls = newEvents.length;

      const orderAfter = call.request?.orderId
        ? (snapAfter.orders.find(o => o.id === call.request.orderId) || null)
        : null;

      /** @type {CallObservation} */
      const obs = {
        expected: { ...exp },
        observed: {
          result: callResult,
          sinkCalls: newSinkCalls,
          events: newEvents,
          orderAfter: orderAfter ? { ...orderAfter } : null,
          snapshotBefore: snapBefore,
          snapshotAfter: snapAfter,
        },
      };
      result.calls.push(obs);

      // ---- Compare expected vs. observed ----
      const callLabel = `${resultId} call ${i + 1}`;

      // Result code
      if (callResult.ok !== exp.ok) {
        result.failures.push(
          `${callLabel}: expected ok=${exp.ok}; observed ok=${callResult.ok}`
        );
      }
      if (callResult.code !== exp.code) {
        result.failures.push(
          `${callLabel}: expected code=${exp.code}; observed code=${callResult.code}`
        );
      }

      // Sink calls
      if (newSinkCalls !== exp.sinkCalls) {
        result.failures.push(
          `${callLabel}: expected ${exp.sinkCalls} new sink event(s); observed ${newSinkCalls}` +
          (newSinkCalls > 0
            ? ` for order ${newEvents[0]?.orderId} by ${newEvents[0]?.actorId}`
            : '')
        );
      }

      // Event shape — use compareEffects for consistent comparison with engine
      if (exp.sinkCalls > 0 && exp.event) {
        const expectedEffects = newEvents.map(() => exp.event);
        const effectFailures = compareEffects(newEvents, expectedEffects);
        for (const f of effectFailures)
          result.failures.push(`${callLabel}: ${f}`);
      }

      // Order state transition
      if (exp.orderAfterRefunded !== undefined && orderAfter) {
        if (orderAfter.refunded !== exp.orderAfterRefunded) {
          result.failures.push(
            `${callLabel}: expected order.refunded=${exp.orderAfterRefunded}; observed ${orderAfter.refunded}`
          );
        }
      }

      // Denial: no mutation
      if (!exp.ok) {
        const mutationFailures = detectMutation(snapBefore, snapAfter);
        for (const mf of mutationFailures) {
          result.failures.push(`${callLabel}: state mutated on denial — ${mf}`);
        }
      }

      cumulativeEventsBefore = snapAfter.events.length;
    }
  } catch (err) {
    result.status = 'ERROR';
    result.error = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
    return result;
  }

  result.status = result.failures.length > 0 ? 'FAIL' : 'PASS';
  return result;
}

/**
 * Run all five cases through both entry paths (ten results).
 * @returns {SuiteReport}
 */
export function runSuite() {
  /** @type {CaseResult[]} */
  const results = [];
  const entries = /** @type {Array<'customer'|'support'>} */ (['customer', 'support']);

  for (const caseSpec of CASES) {
    for (const entry of entries) {
      results.push(runCase(caseSpec, entry));
    }
  }

  if (results.length === 0) {
    return { status: 'ERROR', results: [] };
  }

  // Aggregate: ERROR > FAIL > PASS
  let status = /** @type {'PASS'|'FAIL'|'ERROR'} */ ('PASS');
  for (const r of results) {
    if (r.status === 'ERROR') { status = 'ERROR'; break; }
    if (r.status === 'FAIL') status = 'FAIL';
  }

  return { status, results };
}
