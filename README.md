# Rite

**Authorization checks for the paths ordinary tests miss.**

Rite turns an authorization rule and an explicit map of sensitive entry paths
into black-box behavior checks. It records what the system actually did, so a
failure is evidence of an unauthorized effect—not merely a crash, static
warning, or unexercised branch.

This repository is a working prototype built for the IBM Bob 2.0 Hackathon. The
included demonstration covers two paths through a synthetic refund service; it
does not claim exhaustive analysis of arbitrary repositories.

## The problem Rite demonstrates

Both callers below reach the same refund sink, but the original support path
skipped the ownership check:

```text
customerRefund ─┐
                ├─ authorizeAndRefund ── issueRefund
supportRefund  ─┘
```

Rite checks the observable invariants at both mapped entries: the order exists,
the caller owns it, it is paid, and it has not already been refunded. The proof
run shows the vulnerable baseline failing, the repaired implementation passing,
an intentional guard-removal mutation failing, and the restored source passing
again.

## Try it locally

Requires Node.js 20 or newer with `npm`.

```bash
npm install
npm test
npm run prove
npm run dev
```

Open `http://localhost:5173` for the interactive workbench. The browser runs the
same synthetic cases and labels the bundled four-phase proof as a recorded CLI
capture, not a fresh browser execution.

For a production build:

```bash
npm run build
npm run preview
```

## CLI

Run Rite without a global installation:

```bash
# Create rite.config.json, rite.adapter.mjs, and the GitHub workflow
npx --yes @timidan/rite@0.1.0 init

# Review the generated rule and adapter, then verify
npx --yes @timidan/rite@0.1.0 verify \
  --config rite.config.json \
  --out report.json \
  --sarif report.sarif

# Inspect an existing report
npx --yes @timidan/rite@0.1.0 report report.json

# Trace configured entries to a sink in one JavaScript file
npx --yes @timidan/rite@0.1.0 graph \
  --file src/refunds.js \
  --entries customerRefund,supportRefund \
  --sink issueRefund

```

Additional commands:

| Command | Purpose |
|---|---|
| `instrument` | Generate a starter adapter for a JavaScript module |
| `draft` | Ask watsonx.ai for candidate paths and cases; requires IBM Cloud credentials |
| `server` | Run the GitHub App web server |
| `mcp` | Run the local MCP stdio server |

`verify` exits with `0` for PASS, `1` for FAIL, `2` for ERROR, and `3` for
invalid usage.

## Configuration model

A Rite target consists of three explicit inputs:

1. A written authorization rule.
2. A map of the entry functions and sensitive sink in scope.
3. An adapter that invokes those entries and exposes observable effects.

The verifier compares each observed effect with literal expectations. Rite does
not infer that unmapped paths are safe. The included static graph walker is
single-file assistance for reviewing a path map, not a whole-program security
proof.

## Evidence model

Run `npm run prove` to reproduce the demonstration in an isolated temporary
directory. Workspace source is not modified.

| Phase | Expected observation |
|---|---|
| Baseline | `wrong-owner:support` fails and records the unauthorized refund event |
| Fixed | All 10 mapped entry/case combinations pass |
| Mutation | Removing the shared ownership guard makes both wrong-owner cases fail |
| Restored | The exact fixed source passes all 10 checks again |

A red phase counts only when the intended behavioral assertion fails and the
forbidden effect is observed. A syntax error or process failure is reported as
an error, not vulnerability evidence. The generated record is written to
`evidence/proof.json` and copied to `public/evidence/proof.json` for the web UI.

## GitHub App

The GitHub integration implements OAuth, installation and repository selection,
workflow-run discovery, and SHA-bound report artifact reads. `rite init` creates
the reviewed local files; Rite never silently writes to a connected repository.

Registration, environment variables, callback URLs, permissions, and the
webhook setting are documented in
[`docs/github-app-setup.md`](./docs/github-app-setup.md). The live GitHub flow
has verified OAuth, repository discovery, and a SHA-bound artifact read from
Cuebound's passing Rite workflow.

## MCP server

Configure an MCP client with:

```json
{
  "mcpServers": {
    "rite": {
      "command": "npx",
      "args": ["--yes", "@timidan/rite@0.1.0", "mcp"]
    }
  }
}
```

It exposes `rite_analyze`, `rite_verify`, and `rite_report`, all backed by the
same core verifier used by the CLI.

## Project structure

```text
src/
  cli/              CLI entry point
  core/             Config loading, verification, and SARIF output
  github/           GitHub App helpers and Express server
  graph/            Single-file JavaScript call-path walker
  instrument/       Adapter generation and effect comparison
  mcp/              MCP stdio server
  watsonx/          Optional candidate-drafting integration
  App.jsx            Browser workbench
  checks.js          Browser-safe sample case runner
  refunds.js         Synthetic refund service
examples/refund/     Sample config and adapter
scripts/prove.mjs    Reproducible four-phase proof
test/                Node test suite
docs/                Policy, path map, and GitHub setup
evidence/            Saved vulnerable source and proof records
```

## Current boundaries

- The sample covers only `customerRefund` and `supportRefund` in
  `src/refunds.js`.
- All orders, payments, users, and effects are synthetic and held in memory.
- No payment provider is contacted and no money moves.
- External repositories require a reviewed config, adapter, and workflow.
- GitHub sessions use the in-memory Express store and are lost on restart; the
  current deployment shape is suitable for a single-process demo, not a
  horizontally scaled production service.
- The optional watsonx.ai drafting request has not been verified with live
  credentials.

## IBM Bob build record

The build session established the rule and expected cases before the repair,
captured the baseline failure, routed both entries through one shared guard,
captured the passing result, then removed that guard to prove the checks could
detect the defect. Instructions for preserving genuine Bob screenshots live in
[`bob_sessions/README.md`](./bob_sessions/README.md).

## License

MIT. See [`LICENSE`](./LICENSE). Third-party packages remain subject to their
respective licenses.
