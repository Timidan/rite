# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers and reviewers checking whether every explicitly mapped entry path to
a sensitive operation enforces the same authorization rule.

## Product Purpose

Rite turns a written authorization rule, a deliberate path map, and observable
effects into repeatable black-box checks. Success is a clear behavioral verdict
with evidence that the checks detect the defect they claim to cover.

## Positioning

Rite does not claim automatic or exhaustive security analysis. It verifies the
paths a developer explicitly maps and distinguishes a forbidden observed effect
from a crash, static warning, or unexecuted branch.

## Operating Context

Users can run the synthetic sample in the browser, use the CLI locally or in
CI, inspect a recorded four-phase mutation proof, and connect GitHub to read
SHA-bound Rite reports produced by installed repositories.

## Capabilities and Constraints

- The included sample covers `customerRefund` and `supportRefund` only.
- The sample uses synthetic in-memory orders and refund events; no money moves.
- External repositories run `rite init`, then review and commit the generated config, adapter, and workflow.
- The GitHub App has read-only Actions and metadata access and reads existing reports.
- GitHub sessions are single-process and expire when the server restarts.
- watsonx.ai drafting exists but has not been verified with live credentials.

## Brand Commitments

- Product name: Rite.
- Preserve the existing Rite wordmark asset.
- Voice is concise, specific, and evidence-led.
- The interface must not reuse Overcode's dark monospaced editorial identity.
- Prefer less prose and stronger typography over explanatory marketing sections.

## Evidence on Hand

- Interactive ten-check synthetic sample in `src/App.jsx`.
- Reproducible baseline, fixed, mutation, and restored proof in `evidence/`.
- GitHub OAuth and SHA-bound artifact verification in `src/github/`.
- Policy and mapped paths in `docs/policy.md` and `docs/path-map.md`.
- No customer testimonials, usage metrics, or production-security claims.

## Product Principles

- Show observed behavior before explaining it.
- State the checked scope and its limits plainly.
- Keep authorization evidence bound to the code revision that produced it.
- Never present missing or unverified evidence as a pass.

## Accessibility & Inclusion

Maintain semantic controls, keyboard focus, reduced-motion support, readable
contrast, and responsive layouts at desktop and mobile widths.
