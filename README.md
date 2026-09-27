# Rite

**Authorization checks for the paths ordinary tests miss.**

Rite turns an authorization rule and an explicit map of sensitive entry paths
into black-box behavior checks. It records what the system actually did, so a
failure is evidence of an unauthorized effect—not merely a crash, static
warning, or unexercised branch.

This repository is a working prototype built with IBM Bob for the IBM Bob 2.0
Hackathon. It is not affiliated with or endorsed by IBM. The included
demonstration covers two paths through a synthetic refund service; it does not
claim exhaustive analysis of arbitrary repositories.

## Use Rite on your repository

Requires Node.js 20 or newer.

1. In your repository, run `npx --yes @timidan/rite@0.1.1 init`. It writes
   `rite.config.json`, `rite.adapter.mjs`, and `.github/workflows/rite.yml`,
   and asks before overwriting any of them. Use `--dir <path>` to target
   another directory.
2. Write your rule, map your entry paths and sink, and implement `runCase` in
   the adapter. Run `verify` locally until the result is what you expect.
3. Commit and push. The workflow runs on pushes and pull requests targeting
   `main`/`master`, and uploads `rite-report.json` as the `rite-report` artifact.
4. Optional: install the [GitHub App](#github-app) on that repository to read
   the SHA-bound report from the Rite web UI.

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
npx --yes @timidan/rite@0.1.1 init

# Review the generated rule and adapter, then verify
npx --yes @timidan/rite@0.1.1 verify \
  --config rite.config.json \
  --out rite-report.json \
  --sarif rite-report.sarif

# Render an existing report
npx --yes @timidan/rite@0.1.1 report rite-report.json

# Trace configured entries to a sink in one JavaScript file
npx --yes @timidan/rite@0.1.1 graph \
  --file src/refunds.js \
  --entries customerRefund,supportRefund \
  --sink issueRefund
```

All commands:

| Command | Flags | Purpose |
|---|---|---|
| `init` | `[--dir <path>]` | Create the starter config, adapter, and workflow |
| `verify` | `--config <file> [--out <file>] [--sarif <file>]` | Run the checks and write a report |
| `report` | `<file>` | Render an existing report to stdout |
| `graph` | `--file <file> --entries a,b --sink <fn>` | Walk entry-to-sink paths in one JavaScript file |
| `instrument` | `--module <file> --entries a,b --sink <fn> [--factory <fn>] [--snapshot <fn>] [--out <file>]` | Generate a starter adapter for a JavaScript module |
| `draft` | `--rule <file> [--snippet <file>]` | Ask watsonx.ai for candidate paths and cases; requires IBM Cloud credentials |
| `server` | `[--port 3001]` | Run the GitHub App web server |
| `mcp` | | Run the local MCP stdio server |

`verify` exits with `0` for PASS, `1` for FAIL, `2` for ERROR (config, adapter,
or runtime problem), and `3` for invalid usage. `draft` output is a hypothesis
to review, not a result.

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

From the web UI:

1. Press **Connect GitHub** and approve the OAuth request.
2. If no repositories are listed, choose **Install / choose repositories** and
   install the app on repositories that already run the Rite workflow, then
   press **Refresh**.
3. Pick a repository under **Repository evidence** and choose a run with
   **Read report**.

The app requests only read-only **Actions** and **Metadata** permissions. The
server resolves each run's head SHA from GitHub, never from the browser, and
shows a report only when its commit matches that SHA. Expired or mismatched
artifacts are rejected with an explicit error.

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
      "args": ["--yes", "@timidan/rite@0.1.1", "mcp"]
    }
  }
}
```

From a clone of this repository, `npm run mcp` starts the same server.

| Tool | Input | Returns |
|---|---|---|
| `rite_analyze` | `config` | The config's rule, mapped entry paths, and case summary |
| `rite_verify` | `config`, optional `out` | The full verification report as JSON; writes it to `out` if given |
| `rite_report` | `file` | A rendered summary of a saved report |

Relative paths resolve against the MCP server's working directory. All three
tools use the same core verifier as the CLI.

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
- Set `RITE_SESSION_DIR` to keep encrypted GitHub sessions across restarts. The
  file store is intentionally single-process; use a shared session store before
  horizontally scaling the server.
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
