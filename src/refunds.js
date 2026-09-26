/**
 * refunds.js — Synthetic refund service (FIXED).
 *
 * Both customerRefund and supportRefund route through authorizeAndRefund,
 * which enforces ownership, paid status, and refund status at the shared
 * enforcement point — one call site to the private sink.
 *
 * No Node fs/path/crypto/child_process imports. No DOM globals. No React.
 * Safe to import in Node and in the browser.
 */

/**
 * @typedef {{ id: string, ownerId: string, paymentStatus: 'paid'|'unpaid',
 *             amountCents: number, currency: string, refunded: boolean }} OrderSeed
 */

const ALLOWED_REQUEST_KEYS = new Set(['orderId']);
const VALID_PAYMENT_STATUSES = new Set(['paid', 'unpaid']);
const VALID_CURRENCY = 'USD';

/**
 * Validate a fixture seed at construction time.
 * Throws on any invalid seed — this is a setup error, not an auth failure.
 * @param {unknown} seed
 */
function validateSeed(seed) {
  if (!seed || typeof seed !== 'object') throw new Error('Seed must be an object');
  const s = /** @type {Record<string,unknown>} */ (seed);
  if (typeof s.id !== 'string' || s.id.trim() === '')
    throw new Error(`Seed id must be a non-empty string (got ${s.id})`);
  if (typeof s.ownerId !== 'string' || s.ownerId.trim() === '')
    throw new Error(`Seed ownerId must be a non-empty string for order ${s.id}`);
  if (!VALID_PAYMENT_STATUSES.has(/** @type {string} */ (s.paymentStatus)))
    throw new Error(`Seed paymentStatus must be 'paid'|'unpaid' for order ${s.id}`);
  if (
    typeof s.amountCents !== 'number' ||
    !Number.isSafeInteger(s.amountCents) ||
    s.amountCents <= 0
  )
    throw new Error(`Seed amountCents must be a positive safe integer for order ${s.id}`);
  if (s.currency !== VALID_CURRENCY)
    throw new Error(`Seed currency must be ${VALID_CURRENCY} for order ${s.id}`);
  if (typeof s.refunded !== 'boolean')
    throw new Error(`Seed refunded must be a boolean for order ${s.id}`);
}

/**
 * Deep-clone a plain order record.
 * @param {object} order
 * @returns {object}
 */
function cloneOrder(order) {
  return { ...order };
}

/**
 * Create a fresh, isolated refund service instance.
 * @param {{ orders: OrderSeed[] }} config
 */
export function createRefundService({ orders }) {
  if (!Array.isArray(orders) || orders.length === 0)
    throw new Error('createRefundService: orders must be a non-empty array');

  // Validate and clone into a private Map.
  const store = new Map();
  for (const seed of orders) {
    validateSeed(seed);
    if (store.has(seed.id))
      throw new Error(`Duplicate order id in seeds: ${seed.id}`);
    store.set(seed.id, cloneOrder(seed));
  }

  /** @type {Array<object>} */
  const events = [];
  let eventSeq = 0;

  // ------------------------------------------------------------------ //
  // Private helpers                                                       //
  // ------------------------------------------------------------------ //

  /**
   * Issue a refund event into the private sink and update order state.
   * Called only after all authorization checks pass via authorizeAndRefund.
   * @param {object} order
   * @param {string} actorId
   * @returns {{ refundId: string }}
   */
  function issueRefund(order, actorId) {
    eventSeq += 1;
    const refundId = `refund-${eventSeq}`;
    events.push({
      refundId,
      orderId: order.id,
      actorId,
      amountCents: order.amountCents,
      currency: order.currency,
    });
    order.refunded = true;
    return { refundId };
  }

  /**
   * Shared authorization and refund helper — the single guarded path to issueRefund.
   * Validates request, reads canonical order, enforces all three policy conditions,
   * then issues the refund. Both public entry points call this function.
   *
   * Validation order: request shape → actor context → order existence →
   *   ownership → paid status → already-refunded → issue refund.
   *
   * @param {{ orderId: unknown }} request
   * @param {{ actorId: unknown }|null|undefined} context
   * @returns {{ ok: boolean, code: string, refundId?: string }}
   */
  function authorizeAndRefund(request, context) {
    // 1. Request shape
    if (
      !request ||
      typeof request !== 'object' ||
      typeof (/** @type {Record<string,unknown>} */ (request).orderId) !== 'string' ||
      /** @type {Record<string,unknown>} */ (request).orderId.trim() === ''
    ) {
      return { ok: false, code: 'INVALID_REQUEST' };
    }
    // Reject extra fields
    const reqKeys = Object.keys(request);
    for (const k of reqKeys) {
      if (!ALLOWED_REQUEST_KEYS.has(k)) return { ok: false, code: 'INVALID_REQUEST' };
    }

    // 2. Actor context
    if (
      !context ||
      typeof context !== 'object' ||
      typeof (/** @type {Record<string,unknown>} */ (context).actorId) !== 'string' ||
      /** @type {Record<string,unknown>} */ (context).actorId.trim() === ''
    ) {
      return { ok: false, code: 'UNAUTHENTICATED' };
    }

    const orderId = /** @type {string} */ (
      /** @type {Record<string,unknown>} */ (request).orderId
    );
    const actorId = /** @type {string} */ (
      /** @type {Record<string,unknown>} */ (context).actorId
    );

    // 3. Order existence
    const order = store.get(orderId);
    if (!order) return { ok: false, code: 'NOT_FOUND' };

    // 4. Ownership — shared guard; applies to every caller path
    // RITE:OWNERSHIP_GUARD_START
    if (order.ownerId !== actorId) return { ok: false, code: 'NOT_OWNER' };
    // RITE:OWNERSHIP_GUARD_END

    // 5. Paid status
    if (order.paymentStatus !== 'paid') return { ok: false, code: 'NOT_PAID' };

    // 6. Already-refunded status
    if (order.refunded) return { ok: false, code: 'ALREADY_REFUNDED' };

    // 7. Issue refund (single call site)
    const { refundId } = issueRefund(order, actorId);
    return { ok: true, code: 'REFUNDED', refundId };
  }

  // ------------------------------------------------------------------ //
  // Public API                                                            //
  // ------------------------------------------------------------------ //

  /**
   * Customer entry point.
   * @param {object} request
   * @param {object|null} context
   */
  function customerRefund(request, context) {
    return authorizeAndRefund(request, context);
  }

  /**
   * Support entry point.
   * Identical policy enforcement through the shared helper.
   * "Support" identifies the caller path, not a permission to override ownership.
   * @param {object} request
   * @param {object|null} context
   */
  function supportRefund(request, context) {
    return authorizeAndRefund(request, context);
  }

  /**
   * Return deep copies of current orders and events for observation.
   * Callers cannot mutate the service through snapshot values.
   * @returns {{ orders: object[], events: object[] }}
   */
  function snapshot() {
    return {
      orders: [...store.values()].map(cloneOrder),
      events: events.map(e => ({ ...e })),
    };
  }

  return { customerRefund, supportRefund, snapshot };
}
