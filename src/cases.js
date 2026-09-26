/**
 * cases.js — Literal expected outcomes for the authorization policy.
 *
 * These expectations are authored from the written policy in docs/policy.md,
 * before observing any implementation. They must not be derived by importing
 * the service's guard, consulting a vulnerable/fixed switch, or treating
 * a returned decision as truth.
 *
 * Five scenarios × two entry paths = ten scenario/path results.
 * Every independent scenario/path pair gets a fresh service instance.
 */

/**
 * Canonical fixture seeds. Each case runner clones these for its own instance.
 * Never mutated after definition.
 *
 * @typedef {{ id: string, ownerId: string, paymentStatus: 'paid'|'unpaid',
 *             amountCents: number, currency: string, refunded: boolean }} OrderSeed
 */

/** @type {OrderSeed} */
export const SEED_PAID = {
  id: 'order-paid',
  ownerId: 'actor-owner',
  paymentStatus: 'paid',
  amountCents: 4900,
  currency: 'USD',
  refunded: false,
};

/** @type {OrderSeed} */
export const SEED_UNPAID = {
  id: 'order-unpaid',
  ownerId: 'actor-owner',
  paymentStatus: 'unpaid',
  amountCents: 2200,
  currency: 'USD',
  refunded: false,
};

/** @type {OrderSeed} */
export const SEED_ALREADY_REFUNDED = {
  id: 'order-refunded',
  ownerId: 'actor-owner',
  paymentStatus: 'paid',
  amountCents: 3300,
  currency: 'USD',
  refunded: true,
};

/**
 * @typedef {{ orderId: string }} RefundRequest
 * @typedef {{ actorId: string }} RefundContext
 */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   seeds: OrderSeed[],
 *   calls: Array<{ request: RefundRequest, context: RefundContext }>,
 *   expected: Array<{
 *     ok: boolean,
 *     code: string,
 *     sinkCalls: number,
 *     event?: { orderId: string, actorId: string, amountCents: number, currency: string },
 *     orderAfterRefunded?: boolean,
 *   }>
 * }} CaseSpec
 */

/** @type {CaseSpec[]} */
export const CASES = [
  {
    id: 'valid-owner',
    label: 'Valid owner',
    seeds: [SEED_PAID],
    calls: [
      { request: { orderId: 'order-paid' }, context: { actorId: 'actor-owner' } },
    ],
    expected: [
      {
        ok: true,
        code: 'REFUNDED',
        sinkCalls: 1,
        event: {
          orderId: 'order-paid',
          actorId: 'actor-owner',
          amountCents: 4900,
          currency: 'USD',
        },
        orderAfterRefunded: true,
      },
    ],
  },
  {
    id: 'wrong-owner',
    label: 'Wrong owner',
    seeds: [SEED_PAID],
    calls: [
      { request: { orderId: 'order-paid' }, context: { actorId: 'actor-other' } },
    ],
    expected: [
      {
        ok: false,
        code: 'NOT_OWNER',
        sinkCalls: 0,
        orderAfterRefunded: false,
      },
    ],
  },
  {
    id: 'unpaid-order',
    label: 'Unpaid order',
    seeds: [SEED_UNPAID],
    calls: [
      { request: { orderId: 'order-unpaid' }, context: { actorId: 'actor-owner' } },
    ],
    expected: [
      {
        ok: false,
        code: 'NOT_PAID',
        sinkCalls: 0,
        orderAfterRefunded: false,
      },
    ],
  },
  {
    id: 'already-refunded',
    label: 'Already refunded',
    seeds: [SEED_ALREADY_REFUNDED],
    calls: [
      { request: { orderId: 'order-refunded' }, context: { actorId: 'actor-owner' } },
    ],
    expected: [
      {
        ok: false,
        code: 'ALREADY_REFUNDED',
        sinkCalls: 0,
        orderAfterRefunded: true, // already was refunded — no change
      },
    ],
  },
  {
    id: 'repeat-request',
    label: 'Repeat request',
    seeds: [SEED_PAID],
    // Two calls share one service instance — handled specially in runCase.
    calls: [
      { request: { orderId: 'order-paid' }, context: { actorId: 'actor-owner' } },
      { request: { orderId: 'order-paid' }, context: { actorId: 'actor-owner' } },
    ],
    expected: [
      {
        ok: true,
        code: 'REFUNDED',
        sinkCalls: 1, // cumulative after call 1
        event: {
          orderId: 'order-paid',
          actorId: 'actor-owner',
          amountCents: 4900,
          currency: 'USD',
        },
        orderAfterRefunded: true,
      },
      {
        ok: false,
        code: 'ALREADY_REFUNDED',
        sinkCalls: 0, // no NEW events on call 2
        orderAfterRefunded: true,
      },
    ],
  },
];

/**
 * Compact boundary checks: caller-supplied fields and absent context must not
 * create events or succeed. These are run once by the Node adapter.
 * They use fresh service instances and rely on the same public entry points.
 */
export const BOUNDARY_CHECKS = [
  {
    id: 'extra-field-rejected',
    label: 'Extra field in request rejected',
    seeds: [SEED_PAID],
    call: {
      request: { orderId: 'order-paid', ownerId: 'actor-owner' },
      context: { actorId: 'actor-owner' },
    },
    expectedOk: false,
    expectedCode: 'INVALID_REQUEST',
    zeroEvents: true,
  },
  {
    id: 'missing-context',
    label: 'Missing actor context denied',
    seeds: [SEED_PAID],
    call: {
      request: { orderId: 'order-paid' },
      context: null,
    },
    expectedOk: false,
    expectedCode: 'UNAUTHENTICATED',
    zeroEvents: true,
  },
  {
    id: 'empty-actor',
    label: 'Empty actorId denied',
    seeds: [SEED_PAID],
    call: {
      request: { orderId: 'order-paid' },
      context: { actorId: '' },
    },
    expectedOk: false,
    expectedCode: 'UNAUTHENTICATED',
    zeroEvents: true,
  },
];
