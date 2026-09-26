# Authorization Policy — Synthetic Refund Service

## Rule

A refund may reach the fake refund sink **only** when the requesting actor owns
the canonical order, the order was paid, and it has not already been refunded.

Success issues exactly one refund for the canonical amount and currency and
marks the order refunded.

Every denial issues zero refunds and leaves state unchanged.

## Boundaries

1. **Request data** contains only `{ orderId }`. No caller-supplied owner, amount,
   status, or metadata may influence authorization.
2. **Actor identity** arrives separately in `{ actorId }`, supplied as trusted
   context by the harness. Browser identity selection is a simulation, not
   authentication.
3. **Canonical state** — ownership, paid status, refund state, amount, and
   currency — comes from the service's private order store. The store is
   populated from validated seeds at construction time.

## Entry paths

The service exposes two entry points for the same refund operation:

- **`customerRefund(request, context)`** — customer-facing path.
- **`supportRefund(request, context)`** — support-facing path.

Both paths are bound by the same rule. The name "support" identifies a different
caller path, not a permission to refund someone else's order. The support path
has **no ownership override** in this sample.

The baseline implementation intentionally omits the ownership check from the
support path. This is a documented defect, not intended behaviour.

## Validation order

For every request, checks proceed in this fixed order:

1. Request shape (`INVALID_REQUEST`)
2. Actor context (`UNAUTHENTICATED`)
3. Order existence (`NOT_FOUND`)
4. Ownership (`NOT_OWNER`)
5. Paid status (`NOT_PAID`)
6. Already-refunded status (`ALREADY_REFUNDED`)
7. Issue refund → mark order refunded → return `REFUNDED`

## Sink invariant

The fake sink emits exactly one event per successful refund. Its payload is
derived entirely from the canonical order record and the trusted actor ID,
never from caller-supplied data.

## Scope and caveats

This is a synchronous in-memory example. It does not solve database races,
provider retries, distributed transactions, or production idempotency. There
is no real payment, provider, persistence, network transaction, or production
identity system. Two mapped entry paths are checked in this sample. Paths
outside this map are not checked.
