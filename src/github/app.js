/**
 * src/github/app.js — GitHub App OAuth and repository helpers.
 *
 * Handles:
 *   GET  /github/login          — Start OAuth flow
 *   GET  /github/callback       — OAuth callback, set session
 *   GET  /github/installations  — List repos the user authorised
 *   GET  /github/runs           — List recent Rite workflow runs for a repo
 *   GET  /github/report         — Fetch and validate a run's Rite report artifact
 *   POST /github/logout         — Clear session
 *
 * Security model:
 *   - User access token (user-to-server) for identity and session.
 *   - Short-lived installation token (server-to-server) for artifact reads.
 *   - App private key and session secret stay server-side — never
 *     in browser assets, GitHub Actions logs, or Rite report JSON.
 *   - Repository owner/name is NEVER trusted from a browser query parameter;
 *     only repos in the user's authenticated installation list are served.
 *   - Report schema and embedded SHA are validated against GitHub run metadata
 *     before display. Mismatch → explicit error state, never PASS.
 *
 * Environment variables required:
 *   GITHUB_APP_ID          — numeric App ID from GitHub App settings
 *   GITHUB_APP_CLIENT_ID   — OAuth client ID
 *   GITHUB_APP_CLIENT_SECRET
 *   GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_FILE
 *   RITE_SESSION_SECRET    — Random 32+ char string for session signing
 *   RITE_PUBLIC_URL        — e.g. https://rite.timidan.xyz (for OAuth callback)
 *
 * Register the App and set the environment variables above before starting
 * the server. See docs/github-app-setup.md.
 *
 * GitHub App docs: https://docs.github.com/en/apps
 */

/**
 * Check required environment variables.
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function checkEnv() {
  const required = [
    'GITHUB_APP_ID',
    'GITHUB_APP_CLIENT_ID',
    'GITHUB_APP_CLIENT_SECRET',
    'RITE_SESSION_SECRET',
    'RITE_PUBLIC_URL',
  ];
  const missing = required.filter(k => !process.env[k]);
  if (!process.env.GITHUB_APP_PRIVATE_KEY && !process.env.GITHUB_APP_PRIVATE_KEY_FILE) {
    missing.push('GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_FILE');
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Build the GitHub App OAuth authorization URL.
 * @param {string} state — CSRF token, stored in session
 * @returns {string}
 */
export function buildAuthUrl(state) {
  const clientId = process.env.GITHUB_APP_CLIENT_ID ?? '';
  const redirectUri = encodeURIComponent(`${process.env.RITE_PUBLIC_URL}/github/callback`);
  return `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}`;
}

/**
 * Start installation through Rite so GitHub's OAuth-on-install callback carries
 * the same CSRF state stored in the user's session.
 */
export function buildInstallUrl(state) {
  return `https://github.com/apps/rite-authorization-check/installations/new?state=${encodeURIComponent(state)}`;
}

/**
 * Exchange a GitHub OAuth code for a user access token.
 * @param {string} code
 * @returns {Promise<{ token: string, tokenType: string }>}
 */
export async function exchangeCode(code) {
  const resp = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_APP_CLIENT_ID,
      client_secret: process.env.GITHUB_APP_CLIENT_SECRET,
      code,
    }),
  });
  if (!resp.ok) throw new Error(`GitHub token exchange failed: ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new Error(`GitHub OAuth error: ${data.error_description ?? data.error}`);
  return { token: data.access_token, tokenType: data.token_type };
}

/**
 * List repositories accessible to the authenticated user via their installations.
 * Uses the user access token — only repos the user authorised appear here.
 * @param {string} userToken — user access token
 * @returns {Promise<Array<{ id: number, fullName: string, installationId: number }>>}
 */
export async function listAuthorizedRepos(userToken) {
  // 1. Get installations this user has authorised
  const instResp = await fetch('https://api.github.com/user/installations', {
    headers: {
      Authorization: `Bearer ${userToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!instResp.ok) throw new Error(`GitHub installations list failed: ${instResp.status}`);
  const instData = await instResp.json();
  const installations = instData.installations ?? [];

  // 2. For each installation, list repos — filter to Rite-relevant ones
  const allRepos = [];
  for (const inst of installations) {
    const repoResp = await fetch(
      `https://api.github.com/user/installations/${inst.id}/repositories`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );
    if (!repoResp.ok) continue;
    const repoData = await repoResp.json();
    for (const repo of repoData.repositories ?? []) {
      allRepos.push({ id: repo.id, fullName: repo.full_name, installationId: inst.id });
    }
  }
  return allRepos;
}
