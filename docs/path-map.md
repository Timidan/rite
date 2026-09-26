# Path Map — Synthetic Refund Service

## How this map was produced

The map was built by reading `src/refunds.js` directly — tracing imports and
call relationships within the file. This is a manual, text-based inspection of
a single-file module. It does not use an AST engine and does not claim
exhaustive call-graph discovery across arbitrary repositories.

Excluded scope: the test adapter (`test/refunds.test.js`), the runner
(`src/checks.js`), and the proof script (`scripts/prove.mjs`) are not mapped
here. They call public entry points only; they have no path to the private sink.

## File: `src/refunds.js`

### Public entry points

Both are exported methods on the object returned by `createRefundService`.

```
src/refunds.js :: createRefundService() → customerRefund(request, context)
src/refunds.js :: createRefundService() → supportRefund(request, context)
src/refunds.js :: createRefundService() → snapshot()
```

`snapshot()` is read-only; it returns deep copies and cannot reach the sink.

### Private helpers (closure-scoped, not exported)

```
src/refunds.js :: validateSeed(seed)           — fixture validation at construction
src/refunds.js :: cloneOrder(order)            — shallow copy of order records
src/refunds.js :: issueRefund(order, actorId) — private sink (event append + state write)
src/refunds.js :: authorizeAndRefund(req, ctx) — shared enforcement helper
```

`issueRefund` and `authorizeAndRefund` are closure functions. They are not
exported, not returned, not accessible through `snapshot()`, and cannot be
called from outside the factory.

---

## Baseline structure (vulnerable — `evidence/baseline/refunds.js`)

```
customerRefund(request, context)
  └─ authorizeAndRefund(request, context)        ← request/context/order/owner/paid/refunded → issueRefund

supportRefund(request, context)
  ├─ inline: validate request shape
  ├─ inline: validate actor context
  ├─ inline: resolve order
  ├─ OWNERSHIP CHECK OMITTED                      ← defect
  ├─ inline: check paid status
  ├─ inline: check refunded status
  └─ issueRefund(order, actorId)                  ← sink reached without ownership enforcement
```

The baseline defect is that `supportRefund` calls `issueRefund` directly after
checking paid/refunded status, skipping the ownership check. The policy requires
the actor to own the order regardless of which entry path is used.

---

## Fixed structure (`src/refunds.js`)

```
customerRefund(request, context)
  └─ authorizeAndRefund(request, context)
           │
           ├─ validate request shape          → INVALID_REQUEST
           ├─ validate actor context          → UNAUTHENTICATED
           ├─ resolve canonical order         → NOT_FOUND
           ├─ ownership check                 → NOT_OWNER
           ├─ paid status check               → NOT_PAID
           ├─ already-refunded check          → ALREADY_REFUNDED
           └─ issueRefund(order, actorId)     → REFUNDED (one event, one state write)

supportRefund(request, context)
  └─ authorizeAndRefund(request, context)    ← same path, same guard
```

**Repair:** `supportRefund` now delegates entirely to `authorizeAndRefund`,
leaving one guarded call site to `issueRefund`. The ownership check at step 4
of `authorizeAndRefund` applies to both paths.

---

## Guard location

| Concern | File | Function | Line region |
|---|---|---|---|
| Ownership | `src/refunds.js` | `authorizeAndRefund` | `if (order.ownerId !== actorId)` |
| Paid status | `src/refunds.js` | `authorizeAndRefund` | `if (order.paymentStatus !== 'paid')` |
| Already refunded | `src/refunds.js` | `authorizeAndRefund` | `if (order.refunded)` |

---

## Scope boundary

Two entry paths are mapped: `customerRefund` and `supportRefund` in
`src/refunds.js`. Any additional entry points — in other files, services, or
systems — are outside this map and not checked by Rite's current case suite.
