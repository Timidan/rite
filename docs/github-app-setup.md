# GitHub App Setup Guide

This file is the checklist for wiring the live GitHub integration. Registration,
deployment, OAuth, and repository discovery are configured; the artifact flow is
complete after an installed repository produces its first Rite workflow run.

---

## Step 1 — Register the GitHub App

1. Open: https://github.com/settings/apps/new

2. Fill in the form:

   | Field | Value |
   |---|---|
   | GitHub App name | `Rite Authorization Check` (or any unique name) |
   | Homepage URL | `https://rite.timidan.xyz` |
   | Callback URL | `https://rite.timidan.xyz/github/callback` |
   | Setup URL | Leave blank |
   | Webhook | **Uncheck** "Active" for now (not required for MVP) |

3. Under **Permissions → Repository permissions**:

   | Permission | Level |
   |---|---|
   | Actions | Read-only |
   | Metadata | Read-only (mandatory) |

4. Under **Where can this GitHub App be installed?**:
   Select **Any account** (so others can install it) or **Only on this account**.

5. Click **Create GitHub App**.

---

## Step 2 — Collect credentials

After creation, you land on the App settings page. Collect:

| Variable | Where to find it |
|---|---|
| `GITHUB_APP_ID` | "App ID" shown at the top of the App settings page |
| `GITHUB_APP_CLIENT_ID` | "Client ID" in the OAuth section |
| `GITHUB_APP_CLIENT_SECRET` | Click "Generate a new client secret" |
| `GITHUB_APP_PRIVATE_KEY` | Scroll to "Private keys" → "Generate a private key" → download `.pem` |

For the private key: open the `.pem` file, copy the entire contents,
then replace literal newlines with `\n` for the env var:
```bash
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----"
```
Or export it from the file directly:
```bash
export GITHUB_APP_PRIVATE_KEY=$(cat path/to/private-key.pem | tr '\n' '|' | sed 's/|/\\n/g')
```

For deployment, keeping the key in a protected file is preferable:
```bash
GITHUB_APP_PRIVATE_KEY_FILE=/run/secrets/rite-github-app.pem
```
Set either `GITHUB_APP_PRIVATE_KEY` or `GITHUB_APP_PRIVATE_KEY_FILE`, not both.

---

## Step 3 — Set environment variables

Create a `.env` file (never commit this):
```bash
GITHUB_APP_ID=123456
GITHUB_APP_CLIENT_ID=Iv1.abcdef1234567890
GITHUB_APP_CLIENT_SECRET=your_client_secret_here
GITHUB_APP_PRIVATE_KEY_FILE=/absolute/path/to/rite-github-app.private-key.pem
RITE_SESSION_SECRET=at_least_32_random_chars_here_change_this
RITE_PUBLIC_URL=https://rite.timidan.xyz
PORT=3001
```

Load it before starting the server:
```bash
set -a && source .env && set +a
node src/cli/rite.js server --port 3001
```

---

## Step 4 — Install the App on a repository

1. Start from Rite so the OAuth-on-install callback carries valid CSRF state:
   `https://rite.timidan.xyz/github/install`
2. Select the account.
3. Choose **Only select repositories** → pick the repo that has the Rite workflow.
4. Click **Install**.

The server will now be able to list that repo when the user authenticates.

---

## Step 5 — Initialize Rite in the target repo

From the target repository, run:

```bash
npx --yes @timidan/rite@0.1.0 init
```

Review `rite.config.json` and `rite.adapter.mjs`, then commit the generated files
and push.

The workflow will run on every push to `main`/`master` and every PR.
It uploads `rite-report.json` as an artifact (90-day retention).

---

## Step 6 — Test the full flow

```bash
# Start the server
node src/cli/rite.js server --port 3001

# In browser:
# 1. Open http://localhost:3001/api/health
#    → Should show { authed: false, env: { ok: true } }
# 2. Visit http://localhost:3001/github/login
#    → Redirects to GitHub OAuth
# 3. Authorise → redirected back to /#github-connected
# 4. GET http://localhost:3001/github/installations
#    → Lists your authorised repos
# 5. GET http://localhost:3001/github/runs?repoId=<id>&fullName=<owner/repo>
#    → Lists recent workflow runs
# 6. GET http://localhost:3001/github/report?repoId=<id>&fullName=<owner/repo>&runId=<id>
#    → Returns validated report JSON
```

---

## What the server does and does not do

**Does:**
- Verify the user owns the installation before serving any data
- Use short-lived installation tokens for artifact reads (never your personal token)
- Bind the report to the workflow run's head SHA before displaying it
- Reject expired or mismatched artifacts explicitly

**Does not:**
- Expose private keys, client secrets, or session tokens to the browser
- Trust repo name or owner from browser query parameters
- Run repository code on the Rite server
- Require write access to the repository

---

## Status in this build

| Component | Status |
|---|---|
| Express server + all routes | ✅ Implemented (`src/github/server.js`) |
| OAuth flow (login/callback/logout) | ✅ Implemented |
| Installation list + repo auth | ✅ Implemented |
| Run list | ✅ Implemented |
| Artifact fetch + unzip + SHA binding | ✅ Implemented |
| `rite server` CLI command | ✅ Implemented |
| GitHub Actions workflow | ✅ Ready (`.github/workflows/rite.yml`) |
| Browser connect/repo/run/report UI | ✅ Implemented (`src/App.jsx`) |
| App registered on GitHub | ✅ Configured |
| Env vars set | ✅ Configured on the deployed server |
| App installed on target repo | ✅ Verified |
| Public OAuth redirect | ✅ Verified at `https://rite.timidan.xyz/github/login` |
| SHA-bound live artifact read | ⬜ Pending the target repo's first Rite workflow run |
