/**
 * examples/refund/rite.adapter.mjs — Refund service adapter for Rite.
 *
 * Exports runCase(caseSpec) which:
 *   1. Creates a fresh service instance with per-case isolated fixtures.
 *   2. Calls the named entry function with the trusted actor and input.
 *   3. Observes actual sink events and before/after order state.
 *   4. Returns { decision, effects, stateBefore, stateAfter, stateChanged }.
 *
 * The adapter calls the actual entry function — it does NOT infer effects
 * from the return value. A denial that still emits events is detectable here.
 */

import { createRefundService } from '../../src/refunds.js';

/** Canonical fixture seeds — cloned fresh for every case. */
const SEEDS = {
  'order-paid': {
    id: 'order-paid',
    ownerId: 'actor-owner',
    paymentStatus: 'paid',
    amountCents: 4900,
    currency: 'USD',
    refunded: false,
  },
  'order-paid-b': {
    id: 'order-paid-b',
    ownerId: 'actor-owner',
    paymentStatus: 'paid',
    amountCents: 4900,
    currency: 'USD',
    refunded: false,
  },
  'order-unpaid': {
    id: 'order-unpaid',
    ownerId: 'actor-owner',
    paymentStatus: 'unpaid',
    amountCents: 2200,
    currency: 'USD',
    refunded: false,
  },
  'order-refunded': {
    id: 'order-refunded',
    ownerId: 'actor-owner',
    paymentStatus: 'paid',
    amountCents: 3300,
    currency: 'USD',
    refunded: true,
  },
};

/**
 * Map the service result code to the canonical decision string.
 * 'REFUNDED' → 'allow'; anything else → 'deny'.
 * @param {object} result
 * @returns {'allow'|'deny'}
 */
function toDecision(result) {
  return result.ok === true ? 'allow' : 'deny';
}

/**
 * Select all seeds that contain the requested orderId, plus any others needed
 * for the case. For this sample, one seed per orderId is sufficient.
 * @param {string} orderId
 * @returns {object[]}
 */
function seedsForCase(orderId) {
  const seed = SEEDS[orderId];
  if (!seed) throw new Error(`No fixture seed for orderId: ${orderId}`);
  return [{ ...seed }];
}

/**
 * Run one case and return observable adapter result.
 * @param {{ id: string, path: string, actor: string, input: { orderId: string } }} caseSpec
 * @returns {Promise<{
 *   decision: 'allow'|'deny',
 *   effects: object[],
 *   stateBefore: object,
 *   stateAfter: object,
 *   stateChanged: boolean,
 * }>}
 */
export async function runCase(caseSpec) {
  const { path: entryName, actor, input } = caseSpec;
  const orderId = input?.orderId;
  if (typeof orderId !== 'string')
    throw new Error(`caseSpec.input.orderId must be a string (got ${typeof orderId})`);

  const svc = createRefundService({ orders: seedsForCase(orderId) });

  const snapBefore = svc.snapshot();

  let result;
  if (entryName === 'customerRefund') {
    result = svc.customerRefund({ orderId }, { actorId: actor });
  } else if (entryName === 'supportRefund') {
    result = svc.supportRefund({ orderId }, { actorId: actor });
  } else {
    throw new Error(`Unknown entry: ${entryName}`);
  }

  const snapAfter = svc.snapshot();
  const newEvents = snapAfter.events.slice(snapBefore.events.length);

  // Strip internal refundId from effect comparison so expected values stay stable.
  const effects = newEvents.map(({ refundId: _rid, ...rest }) => rest);

  const stateBefore = snapBefore.orders.find(o => o.id === orderId) ?? null;
  const stateAfter  = snapAfter.orders.find(o => o.id === orderId) ?? null;
  const stateChanged = JSON.stringify(stateBefore) !== JSON.stringify(stateAfter);

  return {
    decision: toDecision(result),
    effects,
    stateBefore,
    stateAfter,
    stateChanged,
  };
}
