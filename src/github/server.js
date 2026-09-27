/**
 * src/github/server.js — Full GitHub App Express server.
 *
 * Start: node src/cli/rite.js server [--port 3001]
 *
 * Routes:
 *   GET  /api/health                Health check + env status
 *   GET  /github/login              Redirect to GitHub OAuth
 *   GET  /github/install            Start installation with CSRF state
 *   GET  /github/callback           OAuth callback → session
 *   GET  /github/installations      List repos user authorised
 *   GET  /github/runs?repoId=&fullName=  Recent Rite workflow runs
 *   GET  /github/report?repoId=&fullName=&runId=  Fetch+validate artifact
 *   POST /github/logout             Clear session
 *
 * Security:
 *   - CSRF state checked on callback.
 *   - repoId resolved from GitHub installation list — never trusted from query.
 *   - Installation token is short-lived (1hr), obtained server-side only.
 *   - Private key, session secret, client secret are env vars only.
 *   - Report SHA bound to workflow run head SHA before display.
 *
 * Required env vars (see docs/github-app-setup.md):
 *   GITHUB_APP_ID, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET,
 *   GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_FILE,
 *   RITE_SESSION_SECRET, RITE_PUBLIC_URL
 *
 * Optional:
 *   RITE_SESSION_DIR (encrypted persistent sessions; memory-only when unset)
 *   PORT (default 3001)
 */

import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let express, session, FileStore, AdmZip, createAppAuth;

try {
  ({ default: express }     = await import('express'));
  ({ default: session }     = await import('express-session'));
  const { default: createFileStore } = await import('session-file-store');
  FileStore = createFileStore(session);
  ({ default: AdmZip }      = await import('adm-zip'));
  ({ createAppAuth }        = await import('@octokit/auth-app'));
} catch (e) {
  throw new Error(
    `Missing server dependencies. Run: npm install\n${e.message}`
  );
}

import { checkEnv, buildAuthUrl, buildInstallUrl, exchangeCode, listAuthorizedRepos } from './app.js';
import { ENGINE_VERSION, SCHEMA_VERSION } from '../core/engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ //
// Environment                                                          //
// ------------------------------------------------------------------ //

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Required env var not set: ${name}`);
  return val;
}

export function createSessionStore(path, secret) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return new FileStore({
    path,
    secret,
    ttl: 8 * 60 * 60,
    retries: 1,
    logFn: message => process.stderr.write(`rite-session: ${message}\n`),
  });
}

export function riteWorkflowRunsUrl(fullName) {
  return `https://api.github.com/repos/${fullName}/actions/workflows/rite.yml/runs?per_page=20`;
}

// ------------------------------------------------------------------ //
// Auth helper — creates a short-lived installation token              //
// ------------------------------------------------------------------ //

/**
 * Get a short-lived installation token using the App private key.
 * Token is valid for ~1 hour; obtain fresh per request.
 * @param {number} installationId
 * @returns {Promise<string>}
 */
async function getInstallationToken(installationId) {
  const appId     = requireEnv('GITHUB_APP_ID');
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
    ? process.env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n')
    : readFileSync(requireEnv('GITHUB_APP_PRIVATE_KEY_FILE'), 'utf8');

  const auth = createAppAuth({ appId: Number(appId), privateKey });
  const { token } = await auth({ type: 'installation', installationId });
  return token;
}

// ------------------------------------------------------------------ //
// Report fetcher                                                       //
// ------------------------------------------------------------------ //

/**
 * Download, unzip, parse, and validate a rite-report artifact.
 * Binds report to workflow run head SHA.
 * @param {string} installationToken
 * @param {string} fullName  — owner/repo
 * @param {number} runId
 * @param {string} expectedSha
 * @returns {Promise<{ valid: boolean, report?: object, mismatch?: string }>}
 */
async function fetchAndValidateReport(installationToken, fullName, runId, expectedSha) {
  const headers = {
    Authorization: `Bearer ${installationToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': `rite-app/${ENGINE_VERSION}`,
  };

  // 1. List artifacts
  const artResp = await fetch(
    `https://api.github.com/repos/${fullName}/actions/runs/${runId}/artifacts`,
    { headers }
  );
  if (!artResp.ok) {
    return { valid: false, mismatch: `GitHub artifact list failed: ${artResp.status} ${artResp.statusText}` };
  }
  const artData = await artResp.json();
  const artifact = artData.artifacts?.find(a => a.name === 'rite-report');
  if (!artifact) {
    return { valid: false, mismatch: 'No rite-report artifact found for this run.' };
  }
  if (artifact.expired) {
    return { valid: false, mismatch: 'Artifact has expired (GitHub 90-day retention limit).' };
  }

  // 2. Download the artifact zip (GitHub redirects to a signed URL)
  const dlResp = await fetch(artifact.archive_download_url, {
    headers: { Authorization: `Bearer ${installationToken}`, 'User-Agent': `rite-app/${ENGINE_VERSION}` },
    redirect: 'follow',
  });
  if (!dlResp.ok) {
    return { valid: false, mismatch: `Artifact download failed: ${dlResp.status}` };
  }
  const zipBuffer = Buffer.from(await dlResp.arrayBuffer());

  // 3. Unzip and extract rite-report.json
  let reportJson;
  try {
    const zip = new AdmZip(zipBuffer);
    const entry = zip.getEntry('rite-report.json');
    if (!entry) {
      return { valid: false, mismatch: 'rite-report.json not found inside artifact zip.' };
    }
    reportJson = zip.readAsText(entry);
  } catch (e) {
    return { valid: false, mismatch: `Failed to read zip: ${e.message}` };
  }

  // 4. Parse
  let report;
  try {
    report = JSON.parse(reportJson);
  } catch (e) {
    return { valid: false, mismatch: `rite-report.json is not valid JSON: ${e.message}` };
  }

  return validateReportBinding(report, expectedSha);
}

export function validateReportBinding(report, expectedSha) {
  if (!report.schemaVersion || !report.status || !Array.isArray(report.results)) {
    return { valid: false, mismatch: 'Report missing required fields (schemaVersion, status, results).' };
  }
  if (report.schemaVersion !== SCHEMA_VERSION) {
    return { valid: false, mismatch: `Report schemaVersion ${report.schemaVersion} does not match engine ${SCHEMA_VERSION}.` };
  }
  if (!report.commitSha || report.commitSha !== expectedSha) {
    return {
      valid: false,
      mismatch: `Report commitSha (${report.commitSha ?? 'missing'}) does not match run headSha (${expectedSha}). Do not display.`,
    };
  }
  return { valid: true, report };
}

// ------------------------------------------------------------------ //
// Express app                                                          //
// ------------------------------------------------------------------ //

export async function startGitHubServer({ port = 3001 } = {}) {
  const envCheck = checkEnv();
  if (!envCheck.ok) {
    throw new Error(
      `GitHub server cannot start — missing env vars: ${envCheck.missing.join(', ')}\n` +
      'See docs/github-app-setup.md.'
    );
  }

  const app = express();
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Session — optionally encrypted on disk, with the secret kept outside source.
  const sessionSecret = requireEnv('RITE_SESSION_SECRET');
  const sessionDir = process.env.RITE_SESSION_DIR;
  app.use(session({
    ...(sessionDir ? { store: createSessionStore(sessionDir, sessionSecret) } : {}),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    },
  }));

  // ---- Health ----
  app.get('/api/health', (req, res) => {
    res.json({
      name: 'Rite GitHub server',
      version: ENGINE_VERSION,
      authed: !!req.session.userToken,
      sessionStore: sessionDir ? 'persistent' : 'memory',
      env: checkEnv(),
    });
  });

  // ---- Login — redirect to GitHub OAuth ----
  app.get('/github/login', (req, res) => {
    const state = randomBytes(16).toString('hex');
    req.session.oauthState = state;
    res.redirect(buildAuthUrl(state));
  });

  // ---- Install — preserve CSRF state through GitHub's OAuth-on-install flow ----
  app.get('/github/install', (req, res) => {
    const state = randomBytes(16).toString('hex');
    req.session.oauthState = state;
    res.redirect(buildInstallUrl(state));
  });

  // ---- Callback — exchange code for user token ----
  app.get('/github/callback', async (req, res) => {
    const { code, state } = req.query;

    if (!state || state !== req.session.oauthState) {
      return res.status(400).json({ error: 'Invalid OAuth state. Possible CSRF.' });
    }
    delete req.session.oauthState;

    if (!code) {
      return res.status(400).json({ error: 'Missing OAuth code.' });
    }

    try {
      const { token } = await exchangeCode(String(code));

      // Fetch identity before rotating away from the pre-authentication session.
      const userResp = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': `rite-app/${ENGINE_VERSION}`,
        },
      });
      let user = null;
      if (userResp.ok) {
        user = await userResp.json();
      }

      await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
      req.session.userToken = token;
      if (user) {
        req.session.githubLogin = user.login;
        req.session.githubAvatarUrl = user.avatar_url;
      }
      await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
      res.redirect(`${process.env.RITE_PUBLIC_URL ?? ''}/#github-connected`);
    } catch (e) {
      res.status(500).json({ error: `OAuth exchange failed: ${e.message}` });
    }
  });

  // ---- Installations — list authorised repos ----
  app.get('/github/installations', async (req, res) => {
    if (!req.session.userToken) {
      return res.status(401).json({ error: 'Not authenticated. Visit /github/login first.' });
    }
    try {
      const repos = await listAuthorizedRepos(req.session.userToken);
      res.json({ login: req.session.githubLogin, repos });
    } catch (e) {
      res.status(502).json({ error: `GitHub API error: ${e.message}` });
    }
  });

  // ---- Runs — list recent Rite workflow runs for a repo ----
  app.get('/github/runs', async (req, res) => {
    if (!req.session.userToken) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const { repoId, fullName } = req.query;
    if (!repoId || !fullName) {
      return res.status(400).json({ error: 'repoId and fullName required.' });
    }

    // Security: verify repo is in the user's authorised list — do not trust query param
    try {
      const authorised = await listAuthorizedRepos(req.session.userToken);
      if (!authorised.find(r => String(r.id) === String(repoId) && r.fullName === fullName)) {
        return res.status(403).json({ error: 'Repo not in authorised installation list.' });
      }
    } catch (e) {
      return res.status(502).json({ error: `Could not verify authorisation: ${e.message}` });
    }

    try {
      const headers = {
        Authorization: `Bearer ${req.session.userToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `rite-app/${ENGINE_VERSION}`,
      };
      const runsResp = await fetch(riteWorkflowRunsUrl(String(fullName)), { headers });
      if (runsResp.status === 404) {
        return res.json({ runs: [], workflowInstalled: false });
      }
      if (!runsResp.ok) {
        return res.status(502).json({ error: `GitHub runs API: ${runsResp.status}` });
      }
      const data = await runsResp.json();
      const runs = (data.workflow_runs ?? []).map(r => ({
        runId: r.id,
        headSha: r.head_sha,
        status: r.status,
        conclusion: r.conclusion,
        createdAt: r.created_at,
        htmlUrl: r.html_url,
        name: r.name,
      }));
      res.json({ runs, workflowInstalled: true });
    } catch (e) {
      res.status(502).json({ error: `GitHub API error: ${e.message}` });
    }
  });

  // ---- Report — fetch and validate artifact ----
  app.get('/github/report', async (req, res) => {
    if (!req.session.userToken) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const { repoId, fullName, runId } = req.query;
    if (!repoId || !fullName || !runId) {
      return res.status(400).json({ error: 'repoId, fullName, and runId are required.' });
    }

    // Security: verify authorisation first
    try {
      const authorised = await listAuthorizedRepos(req.session.userToken);
      const repo = authorised.find(r => String(r.id) === String(repoId) && r.fullName === fullName);
      if (!repo) {
        return res.status(403).json({ error: 'Repo not in authorised installation list.' });
      }

      // Get installation token (short-lived, server-side only)
      const installToken = await getInstallationToken(repo.installationId);

      // Resolve the commit SHA from GitHub. Never trust one supplied by the browser.
      const runResp = await fetch(
        `https://api.github.com/repos/${fullName}/actions/runs/${Number(runId)}`,
        {
          headers: {
            Authorization: `Bearer ${installToken}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': `rite-app/${ENGINE_VERSION}`,
          },
        }
      );
      if (!runResp.ok) {
        return res.status(502).json({ error: `GitHub run API: ${runResp.status}` });
      }
      const run = await runResp.json();

      const result = await fetchAndValidateReport(
        installToken,
        String(fullName),
        Number(runId),
        String(run.head_sha)
      );

      if (!result.valid) {
        return res.status(422).json({ valid: false, mismatch: result.mismatch });
      }

      res.json({ valid: true, report: result.report });
    } catch (e) {
      res.status(502).json({ error: `Report fetch failed: ${e.message}` });
    }
  });

  // ---- Logout ----
  app.post('/github/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  // Production serves the built workbench and GitHub API from one origin.
  app.use(express.static(join(__dirname, '..', '..', 'dist')));

  // Start
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      process.stderr.write(`rite-server: listening on http://localhost:${port}\n`);
      resolve(server);
    });
    server.on('error', reject);
  });
}
