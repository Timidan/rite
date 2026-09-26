---
name: rite
description: |
  Rite authorization-check workflow for IBM Bob. Use when checking whether a
  written authorization rule is enforced across all named entry paths to a
  sensitive operation. Covers policy authoring, path tracing, black-box case
  execution, shared repair, mutation testing, and evidence capture. Verified
  on the synthetic refund service sample.
---

# Rite — Reusable Bob Workflow

## When to use this skill

Activate when a developer needs to verify that a written authorization rule
holds across **all** entry paths to a sensitive operation — not just the paths
that existing tests happen to exercise.

Typical trigger: "I have a rule, I have some paths, I want to know if any of
them bypass the check."

---

## The seven steps

### 1. Identify the scope

Before writing any code, establish:

- **Written policy** — the exact rule in plain language. Record it in
  `docs/policy.md`. Example: *"Only the owner of a paid, unrefunded order may
  receive one refund."*
- **Trusted context** — how actor identity arrives (separate from request data).
- **Sensitive sink** — the private function or side effect that must only fire
  after all checks pass.
- **Bounded scope** — exactly which entry paths are in this map. State
  explicitly what is outside.

Safeguard: do not claim exhaustive coverage of paths you have not read.

### 2. Trace named entry points and actual call paths

Read the source files directly. For each named entry point:

- Follow the call chain to the sink.
- Note where authorization checks occur relative to the sink call.
- Record the baseline structure (vulnerable) and the intended structure (fixed)
  in `docs/path-map.md`.

Safeguard: this is a text-based inspection, not an AST engine. Label it as
such in the path map. Do not claim discovered paths you have not verified.

### 3. Establish literal expectations before repair

Write `src/cases.js` (or equivalent) with explicit expected outcomes:

- At minimum: valid actor, wrong actor, unpaid, already-processed, repeat.
- Both entry paths for each scenario.
- Expected result code, sink call count, event content, state transition.

Safeguard: do not derive expectations by importing the guard function, repeating
its predicates, or treating the current (possibly vulnerable) return value as
truth.

### 4. Observe effects through public entries and a suitable test seam

Run the cases against the **baseline** (vulnerable) source:

```bash
node --test test/refunds.test.js
```

Confirm:
- The intended failure case fails with an **observed unauthorized effect**
  (not just a wrong return code).
- All other controls pass.

Save the baseline source artifact. This is used only by the proof script.

Safeguard: syntax errors, crashes, or arbitrary nonzero exit codes are not
detection. Require an observed unauthorized effect in the failure witness.

### 5. Fix the common enforcement point

Place authorization at the **shared helper** that both entry paths call before
the sink — not at each wrapper independently. One guarded call site to the sink.

After repair:
```bash
node --test test/refunds.test.js   # all cases PASS
```

### 6. Challenge the repair with one deliberate bounded defect

Remove only the ownership guard from the shared helper. Run the unchanged cases:

```bash
node scripts/prove.mjs
```

Confirm:
- The wrong-actor cases fail for **both** entry paths.
- Controls still pass.

Restore the exact fixed bytes. Confirm all cases pass again.

Safeguard: label this "ownership-check mutation" — not a mutation score from
one deliberate change. It establishes that the checks detect this specific
regression; it does not prove exhaustive detection.

### 7. Report checked scope and remaining limits

In the README and submission:

- State exactly which paths were checked (by file and function name).
- State what is outside the map.
- Note that the adapter, not Rite, determines what effects are observable.
- Distinguish: implemented vs. configured vs. verified end-to-end.
- Do not claim the repair makes the system secure beyond the checked paths.

---

## Using the CLI in Bob

```bash
# Verify a config
node src/cli/rite.js verify --config examples/refund/rite.config.json

# Write a report
node src/cli/rite.js verify --config examples/refund/rite.config.json --out report.json

# Render a saved report
node src/cli/rite.js report report.json
```

Exit codes: `0` = PASS, `1` = FAIL, `2` = ERROR/setup, `3` = usage.

## Using the MCP server in Bob

Start: `node src/cli/rite.js mcp`

Available tools:
- `rite_analyze` — read rule and path scope from a config file
- `rite_verify` — run verification (same engine as CLI)
- `rite_report` — read and render a saved report

---

## Safeguards summary

| Risk | Guard |
|---|---|
| Weakening expectations | Author cases from policy, not from observed output |
| Treating exceptions as detection | Require observed unauthorized effect in red witness |
| Fabricating Bob usage | Add only genuine task-summary screenshots in `bob_sessions/` |
| Exposing real data | Synthetic fixtures only; no real orders, actors, or credentials |
| Claiming exhaustive coverage | State the exact paths checked; name what is outside the map |
| Mixing recorded proof with live run | Label `evidence/proof.json` as a CLI capture in the UI |

---

## Attachment note

This skill file is at `.bob/skills/rite/SKILL.md`. If auto-discovery is not
confirmed in this Bob version, attach it manually at the start of a session
by referencing this path. The workflow steps above were followed during the
build of this sample.
