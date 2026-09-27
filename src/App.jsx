import React, { useState, useEffect, useCallback } from 'react';
import { runSuite, runCase } from './checks.js';
import { CASES } from './cases.js';

// ============================================================
// Shared bits
// ============================================================

const ENTRIES = ['customer', 'support'];

function Status({ status }) {
  if (status === 'PASS' || status === 'FAIL' || status === 'ERROR') {
    return <span className={`status status-${status.toLowerCase()}`}>{status}</span>;
  }
  return <span className="status status-notrun">Not run</span>;
}

function laneState(entry, lastRun) {
  const forEntry = (lastRun?.data?.results ?? []).filter(r => r.entry === entry);
  if (forEntry.length === 0) return { text: 'Not run', tone: 'idle' };
  const passed = forEntry.filter(r => r.status === 'PASS').length;
  return {
    text: `${passed} of ${forEntry.length} passed`,
    tone: passed === forEntry.length ? 'pass' : 'fail',
  };
}

// ============================================================
// Instrument: rule → two mapped paths → shared gate → verdict rail
// ============================================================

function Instrument({ lastRun, verdict, pulse }) {
  const lanes = ENTRIES.map(entry => ({ entry, ...laneState(entry, lastRun) }));
  return (
    <figure className="scope hero-rise" data-tone={verdict.tone}>
      <p className="scope-rule">
        <span className="tag">Rule</span>
        A refund needs an owner, a paid order, and no earlier refund.
      </p>

      <div className="scope-grid">
        <div className="ch ch1" data-tone={lanes[0].tone}>
          <span className="tag">Path 1</span>
          <code>customerRefund()</code>
          <span className="ch-state">{lanes[0].text}</span>
        </div>
        <span className="wire w1" aria-hidden="true" key={`a${pulse}`} />
        <div className="ch ch2" data-tone={lanes[1].tone}>
          <span className="tag">Path 2</span>
          <code>supportRefund()</code>
          <span className="ch-state">{lanes[1].text}</span>
        </div>
        <span className="wire w2" aria-hidden="true" key={`b${pulse}`} />

        <div className="gate">
          <span className="tag">Shared gate</span>
          <code>authorizeAndRefund()</code>
          <ul>
            <li>actor owns the order</li>
            <li>order is paid</li>
            <li>not already refunded</li>
          </ul>
        </div>
        <span className="wire w3" aria-hidden="true" key={`c${pulse}`} />

        <div className="rail" role="status" aria-live="polite" aria-atomic="true">
          <span className="tag">Verdict</span>
          <span className="rail-label">{verdict.label}</span>
          <span className="rail-sub">{verdict.sub}</span>
          <span className="rail-sink">
            <code>issueRefund()</code> allowed: 1 event · denied: 0 events
          </span>
        </div>
      </div>
      <figcaption className="scope-note">
        Sample: a synthetic refund service with two mapped paths,{' '}
        <code>customerRefund</code> and <code>supportRefund</code>. Checks run in this browser.
        Unmapped paths are not checked.
      </figcaption>
    </figure>
  );
}

// ============================================================
// Results matrix
// ============================================================

function ResultsTable({ lastRun, pathFilter, setPathFilter, selectedKey, setSelectedKey, onRunCase, running }) {
  const entries = ENTRIES.filter(e => pathFilter === 'all' || pathFilter === e);
  const find = id => lastRun?.data?.results?.find(r => r.id === id) ?? null;
  const filters = [['all', 'Both paths'], ['customer', 'Customer'], ['support', 'Support']];

  return (
    <div className="matrix-wrap">
      <div className="segmented" role="group" aria-label="Paths shown">
        {filters.map(([value, label]) => (
          <button
            key={value}
            className="seg-btn"
            aria-pressed={pathFilter === value}
            onClick={() => setPathFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="region" aria-label="Current checks results" tabIndex={0} className="table-scroll">
        <table className="matrix">
          <caption className="sr-only">Current checks by mapped path</caption>
          <thead>
            <tr>
              <th scope="col">Case</th>
              {entries.map(e => <th scope="col" key={e}>{e}</th>)}
            </tr>
          </thead>
          <tbody>
            {CASES.map(caseSpec => (
              <tr key={caseSpec.id}>
                <th scope="row">{caseSpec.label}</th>
                {entries.map(entry => {
                  const id = `${caseSpec.id}:${entry}`;
                  const result = find(id);
                  return (
                    <td key={id}>
                      <button
                        className="cell"
                        data-status={result?.status ?? 'none'}
                        aria-pressed={selectedKey === id}
                        aria-controls="case-detail"
                        aria-label={`${caseSpec.label}, ${entry} path: ${result ? result.status : 'not run. Run it'}`}
                        disabled={running}
                        onClick={() => (result ? setSelectedKey(id) : onRunCase(caseSpec, entry))}
                      >
                        <span className="dot" aria-hidden="true" />
                        {result ? result.status : 'Run'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// CaseDetail
// ============================================================

function formatCurrency(amountCents, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
      amountCents / 100
    );
  } catch {
    return `${amountCents} ${currency}`;
  }
}

function EventItem({ ev }) {
  return (
    <dl className="event-item">
      <div><dt>refundId</dt><dd>{ev.refundId}</dd></div>
      <div><dt>orderId</dt><dd>{ev.orderId}</dd></div>
      <div><dt>actorId</dt><dd>{ev.actorId}</dd></div>
      <div><dt>amount</dt><dd>{ev.amountCents} cents ({formatCurrency(ev.amountCents, ev.currency)})</dd></div>
      <div><dt>currency</dt><dd>{ev.currency}</dd></div>
    </dl>
  );
}

function CallBlock({ callObs, index }) {
  const { expected, observed } = callObs;
  return (
    <div className="call-block">
      <h3>Call {index + 1}</h3>
      <div className="call-columns">
        <dl className="call-col">
          <dt className="col-label">Expected</dt>
          <div><dt>ok</dt><dd>{String(expected.ok)}</dd></div>
          <div><dt>code</dt><dd>{expected.code}</dd></div>
          <div><dt>sinkCalls</dt><dd>{expected.sinkCalls}</dd></div>
        </dl>
        <dl className="call-col">
          <dt className="col-label">Observed</dt>
          <div><dt>ok</dt><dd>{String(observed.result?.ok)}</dd></div>
          <div><dt>code</dt><dd>{observed.result?.code}</dd></div>
          <div><dt>sinkCalls</dt><dd>{observed.sinkCalls}</dd></div>
        </dl>
      </div>
      {observed.orderAfter && (
        <>
          <div className="col-label">orderAfter</div>
          <pre className="pre-block">{JSON.stringify(observed.orderAfter, null, 2)}</pre>
        </>
      )}
      <div className="col-label">New sink events ({observed.events?.length ?? 0})</div>
      {observed.events?.length > 0
        ? observed.events.map((ev, i) => <EventItem key={i} ev={ev} />)
        : <p className="muted">No refund events.</p>}
    </div>
  );
}

function CaseDetail({ selectedKey, lastRun }) {
  const result = lastRun?.data?.results?.find(r => r.id === selectedKey) ?? null;

  return (
    <section id="case-detail" className="case-detail" aria-labelledby="case-detail-heading" tabIndex={0}>
      <h2 id="case-detail-heading" className="sr-only">Case detail</h2>
      {!result ? (
        <p className="detail-empty">Select a result to compare expected and observed effects.</p>
      ) : (
        <>
          <div className="case-detail-header">
            <div>
              <div className="case-detail-title">{result.label}</div>
              <div className="muted">{result.entry} path</div>
            </div>
            <Status status={result.status} />
          </div>

          {result.failures?.length > 0 && (
            <ul className="failures-list">
              {result.failures.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}

          {result.error && (
            <ul className="failures-list"><li>{result.error}</li></ul>
          )}

          {result.calls?.map((callObs, i) => (
            <CallBlock key={i} callObs={callObs} index={i} />
          ))}
        </>
      )}
    </section>
  );
}

// ============================================================
// RecordedProof
// ============================================================

function PhaseBlock({ phase }) {
  return (
    <li className="phase-block">
      <div className="phase-header">
        <span className="phase-label">{phase.label}</span>
        <Status status={phase.resultStatus} />
        <span className={phase.expectationMet ? 'muted' : 'phase-unmet'}>
          {phase.expectationMet ? 'expected observation met' : 'expected observation not met'}
        </span>
      </div>
      <div className="phase-meta">
        command: {phase.command}
        {' · '}exit: {phase.exitCode ?? 'null'}
        {phase.signal ? ` · signal: ${phase.signal}` : ''}
        {phase.processError ? ` · error: ${phase.processError}` : ''}
      </div>
      <div className="phase-meta">sourceHash: {phase.sourceHash ?? 'n/a'}</div>
    </li>
  );
}

// What each recorded phase changes and what it must show. Matches the README evidence table.
const PROOF_STEPS = [
  { id: 'baseline', title: 'Baseline', change: 'The support path skips the ownership check.', expect: <><code>wrong-owner:support</code> fails and records the unauthorized refund.</> },
  { id: 'fixed', title: 'Fixed', change: 'Both paths route through one shared guard.', expect: 'All 10 mapped checks pass.' },
  { id: 'mutation', title: 'Mutation', change: 'The ownership guard is removed from the shared gate.', expect: 'Both wrong-owner cases fail.' },
  { id: 'restored', title: 'Restored', change: 'The exact fixed source is put back.', expect: 'All 10 checks pass again.' },
];

function RecordedProof() {
  const [proofState, setProofState] = useState('idle'); // idle|loading|missing|invalid|error|ready
  const [proof, setProof]   = useState(null);
  const [proofMsg, setProofMsg] = useState('');

  function validateProof(data) {
    if (!data || typeof data !== 'object') return false;
    if (data.schemaVersion !== 1) return false;
    if (typeof data.generatedAt !== 'string') return false;
    if (data.status !== 'PASS' && data.status !== 'FAIL') return false;
    if (!Array.isArray(data.phases) || data.phases.length !== 4) return false;
    const phaseIds = ['baseline', 'fixed', 'mutation', 'restored'];
    for (const id of phaseIds) {
      if (!data.phases.find(p => p.id === id)) return false;
    }
    for (const phase of data.phases) {
      if (typeof phase.label !== 'string') return false;
      if (typeof phase.command !== 'string') return false;
      if (phase.exitCode !== null && typeof phase.exitCode !== 'number') return false;
      if (typeof phase.expectationMet !== 'boolean') return false;
      if (!['PASS', 'FAIL', 'ERROR'].includes(phase.resultStatus)) return false;
    }
    return true;
  }

  async function loadProof() {
    setProofState('loading');
    try {
      const url = `${import.meta.env.BASE_URL}evidence/proof.json`;
      const resp = await fetch(url);
      if (resp.status === 404) {
        setProofState('missing');
        return;
      }
      if (!resp.ok) {
        setProofState('error');
        setProofMsg(`HTTP ${resp.status}`);
        return;
      }
      let data;
      try { data = await resp.json(); } catch {
        setProofState('invalid');
        return;
      }
      if (!validateProof(data)) {
        setProofState('invalid');
        return;
      }
      setProof(data);
      setProofState('ready');
    } catch (e) {
      setProofState('error');
      setProofMsg(String(e?.message ?? e));
    }
  }

  useEffect(() => { loadProof(); }, []);

  return (
    <section className="panel recorded-proof" id="proof" aria-labelledby="proof-heading">
      <div className="panel-head">
        <h2 id="proof-heading">Mutation proof</h2>
        {proofState === 'error' && (
          <button className="btn btn-secondary" onClick={loadProof}>Retry loading</button>
        )}
      </div>
      <p className="lede">
        A check only counts if it catches the defect it claims to cover. These four CLI phases were
        recorded while building this sample. They are not re-run here.
      </p>

      <ol className="timeline">
        {PROOF_STEPS.map((step, i) => {
          const recorded = proofState === 'ready' ? proof.phases.find(p => p.id === step.id) : null;
          const tone = !recorded ? 'idle' : recorded.resultStatus === 'PASS' ? 'pass' : 'fail';
          return (
            <li className="step" data-tone={tone} key={step.id} style={{ '--i': i }}>
              <span className="tag">{i + 1}. {step.title}</span>
              <p className="step-change">{step.change}</p>
              <p className="step-expect"><span className="step-key">Expected</span> {step.expect}</p>
              <div className="step-recorded">
                <span className="step-key">Recorded</span>
                {recorded ? (
                  <span className="step-result">
                    <Status status={recorded.resultStatus} />
                    <span className={recorded.expectationMet ? 'muted' : 'phase-unmet'}>
                      {recorded.expectationMet ? 'as expected' : 'not as expected'}
                    </span>
                  </span>
                ) : (
                  <span className="muted">{proofState === 'loading' || proofState === 'idle' ? 'Loading…' : 'Unavailable'}</span>
                )}
              </div>
              {Array.isArray(recorded?.witnesses) && recorded.witnesses.length > 0 && (
                <p className="phase-meta">witnesses: {recorded.witnesses.join(', ')}</p>
              )}
            </li>
          );
        })}
      </ol>

      <div className="recorded-proof-body" role="status">
        {proofState === 'missing' && (
          <p className="muted">No recorded proof file in this build. Current checks still run live.</p>
        )}
        {proofState === 'invalid' && (
          <p className="muted">Recorded proof file did not match the expected shape, so it is not shown.</p>
        )}
        {proofState === 'error' && (
          <p className="muted">Could not load recorded proof: {proofMsg}. Current checks still run live.</p>
        )}
      </div>

      {proofState === 'ready' && proof && (
        <details className="proof-raw">
          <summary>Commands, exit codes, and hashes</summary>
          <div className="proof-raw-body">
            <div className="proof-overall">
              <strong>Overall</strong>
              <Status status={proof.status} />
              <span className="meta">Generated {proof.generatedAt}</span>
              <span className="meta">Node {proof.runtime?.node}</span>
            </div>
            <div className="proof-hashes">
              <div className="meta">policy hash: {proof.hashes?.policy}</div>
              <div className="meta">cases hash: {proof.hashes?.cases}</div>
              <div className="meta">checks hash: {proof.hashes?.checks}</div>
              <div className="meta">test hash: {proof.hashes?.test}</div>
            </div>
            <ol className="phases">
              {proof.phases.map(phase => (
                <PhaseBlock key={phase.id} phase={phase} />
              ))}
            </ol>
          </div>
        </details>
      )}

      <p className="proof-how">
        <strong>How this was made:</strong> in IBM Bob, trace both entry paths, write black-box
        behavior checks, fix at the shared enforcement point, remove the ownership check and
        watch checks fail, then restore it and watch them pass.
      </p>
    </section>
  );
}

// ============================================================
// GitHub session (shared by hero and evidence section)
// ============================================================

const GITHUB_INSTALL_URL = '/github/install';

// status: 'checking' | 'connected' | 'disconnected' | 'error'. The session cookie is
// httpOnly and stays on the server; the client only learns login and repos.
function useGitHubSession() {
  const [gh, setGh] = useState({ status: 'checking', login: null, repos: null, error: '' });
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const resp = await fetch('/github/installations').catch(() => null);
    const data = resp ? await resp.json().catch(() => null) : null;

    if (resp?.ok && data) {
      setGh({ status: 'connected', login: data.login ?? null, repos: data.repos ?? [], error: '' });
    } else if (resp?.status === 401) {
      setGh({ status: 'disconnected', login: null, repos: null, error: '' });
    } else {
      setGh(prev => {
        const error = data?.error ?? (prev.status === 'connected' ? 'Refresh failed.' : '');
        if (prev.status === 'connected') return { ...prev, error };
        return error
          ? { status: 'error', login: null, repos: null, error }
          : { status: 'disconnected', login: null, repos: null, error: '' };
      });
    }

    if (location.hash === '#github-connected') {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
    setRefreshing(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { gh, refreshing, refresh };
}

function GitHubStatus({ gh, className = '' }) {
  if (gh.status === 'checking') {
    return <span className={`btn btn-quiet ${className}`} aria-busy="true">Checking GitHub…</span>;
  }
  if (gh.status === 'connected') {
    return (
      <a className={`btn btn-quiet is-connected ${className}`} href="#github-evidence">
        <span className="dot" aria-hidden="true" />
        {gh.login ? `Connected as @${gh.login}` : 'Connected'}
      </a>
    );
  }
  return <a className={`btn btn-quiet ${className}`} href="/github/login">Connect GitHub</a>;
}

// ============================================================
// GitHub evidence
// ============================================================

function GitHubEvidence({ gh, refreshing, refresh }) {
  const [repo, setRepo] = useState(null);
  const [runs, setRuns] = useState([]);
  const [report, setReport] = useState(null);
  const [workflowInstalled, setWorkflowInstalled] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const connected = gh.status === 'connected';
  const working = busy || refreshing;
  const shownError = error || gh.error;

  async function getJson(url) {
    const response = await fetch(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? data.mismatch ?? `HTTP ${response.status}`);
    return data;
  }

  async function loadRuns(repoId) {
    const selected = gh.repos?.find(item => String(item.id) === repoId);
    setRepo(selected ?? null);
    setRuns([]);
    setReport(null);
    setWorkflowInstalled(null);
    setError('');
    if (!selected) return;
    setBusy(true);
    try {
      const query = new URLSearchParams({ repoId: selected.id, fullName: selected.fullName });
      const data = await getJson(`/github/runs?${query}`);
      setRuns(data.runs ?? []);
      setWorkflowInstalled(data.workflowInstalled ?? null);
    } catch (e) {
      setError(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function loadReport(runId) {
    setBusy(true);
    setReport(null);
    setError('');
    try {
      const query = new URLSearchParams({ repoId: repo.id, fullName: repo.fullName, runId });
      const data = await getJson(`/github/report?${query}`);
      setReport(data.report);
    } catch (e) {
      setError(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="github-evidence" className="panel github-evidence" aria-labelledby="github-evidence-heading">
      <div className="panel-head">
        <h2 id="github-evidence-heading">Repository evidence</h2>
        <div className="panel-actions">
          {connected ? (
            <>
              <span className="conn-line" role="status">
                <span className="dot" aria-hidden="true" />
                {gh.login ? `Connected as @${gh.login}` : 'Connected'}
              </span>
              <button className="btn btn-secondary" onClick={refresh} disabled={working}>Refresh</button>
            </>
          ) : gh.status === 'checking' ? (
            <span className="conn-line" role="status" aria-busy="true">Checking GitHub…</span>
          ) : (
            <>
              {gh.status === 'error' && (
                <button className="btn btn-secondary" onClick={refresh} disabled={working}>Retry</button>
              )}
              <a className="btn" href="/github/login">Connect GitHub</a>
            </>
          )}
        </div>
      </div>

      <p className="lede">
        Reads SHA-bound Rite reports from repositories that already run a Rite workflow.
        Rite never writes to the connected repository.
      </p>

      {connected && gh.repos.length > 0 && (
        <label className="field">
          <span>Repository</span>
          <select value={repo?.id ?? ''} onChange={e => loadRuns(e.target.value)} disabled={working}>
            <option value="">Choose an installed repository</option>
            {gh.repos.map(item => <option key={item.id} value={item.id}>{item.fullName}</option>)}
          </select>
        </label>
      )}

      {connected && gh.repos.length === 0 && (
        <div className="github-empty">
          <strong>No repositories installed.</strong>
          <p>OAuth connected your identity. Install Rite on the repositories you want to inspect, then return and press Refresh.</p>
          <a className="btn" href={GITHUB_INSTALL_URL} target="_blank" rel="noreferrer">
            Install / choose repositories<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      )}
      {busy && <p className="muted" role="status">Loading GitHub evidence…</p>}
      {shownError && <p className="github-error" role="alert">{shownError}</p>}

      {runs.length > 0 && (
        <ul className="github-runs">
          {runs.map(run => (
            <li className="github-run" key={run.runId}>
              <span>
                <strong>{run.name}</strong>
                <span className="meta">{run.headSha?.slice(0, 7) ?? 'no sha'} · {run.conclusion ?? run.status}</span>
              </span>
              <button className="btn btn-small btn-secondary" onClick={() => loadReport(run.runId)} disabled={working}>
                Read report
              </button>
            </li>
          ))}
        </ul>
      )}
      {repo && !busy && runs.length === 0 && !shownError && workflowInstalled === false && (
        <div className="github-empty">
          <strong>Rite is not initialized in this repository.</strong>
          <pre className="pre-block"><code>npx --yes @timidan/rite@0.1.1 init</code></pre>
          <p>Review the generated rule and adapter, then commit and push. The first workflow run will appear here.</p>
        </div>
      )}
      {repo && !busy && runs.length === 0 && !shownError && workflowInstalled === true && (
        <p className="muted">The Rite workflow is installed but has not produced a report yet.</p>
      )}
      {repo && !busy && runs.length === 0 && !shownError && workflowInstalled === null && (
        <p className="muted">No workflow runs found. Rite could not confirm whether the workflow is installed.</p>
      )}

      {report && (
        <div className="github-report">
          <Status status={report.status} />
          <strong>{report.rule}</strong>
          <span className="meta">
            {report.results?.filter(item => item.status === 'PASS').length ?? 0}/{report.results?.length ?? 0} checks passed · {report.commitSha?.slice(0, 7) ?? 'no sha'}
          </span>
        </div>
      )}
    </section>
  );
}

// ============================================================
// Setup
// ============================================================

function Setup() {
  return (
    <section id="setup" className="panel setup" aria-labelledby="setup-heading">
      <div className="panel-head">
        <h2 id="setup-heading">Use it on your repository</h2>
      </div>
      <ol className="steps">
        <li>
          <span>Run <code>npx --yes @timidan/rite@0.1.1 init</code> in your repository. It creates the Rite
          config, adapter, and GitHub workflow.</span>
        </li>
        <li>
          <span>Review the generated rule and adapter, then commit and push. The workflow uploads{' '}
          <code>rite-report.json</code>.</span>
        </li>
        <li>
          <span><a href={GITHUB_INSTALL_URL} target="_blank" rel="noreferrer">Install the GitHub App<span className="sr-only"> (opens in a new tab)</span></a> on
          that repository, return here, press Refresh, and select it under <a href="#github-evidence">Repository evidence</a>.</span>
        </li>
      </ol>
      <p className="note">
        The app asks for read-only Actions and Metadata access. It reads the report artifact and
        shows it only if the report's commit matches the run's head SHA. Rite never writes to your
        repository; you review and commit the generated files.
      </p>
    </section>
  );
}

function LocalTools() {
  return (
    <section id="local-tools" className="panel local-tools" aria-labelledby="local-tools-heading">
      <div className="panel-head">
        <h2 id="local-tools-heading">CLI and MCP</h2>
      </div>
      <p className="lede">Use the published package from any Node.js 20+ repository.</p>
      <div className="tool-grid">
        <article className="tool-card">
          <span className="tag">CLI</span>
          <h3>Create a target, then verify it</h3>
          <pre className="pre-block" tabIndex={0}><code>{`npx --yes @timidan/rite@0.1.1 init
npx --yes @timidan/rite@0.1.1 verify \\
  --config rite.config.json \\
  --out rite-report.json --sarif rite-report.sarif
npx --yes @timidan/rite@0.1.1 report rite-report.json`}</code></pre>
          <p className="note">
            Edit the generated <code>rite.config.json</code> and <code>rite.adapter.mjs</code> before
            running verify. Exit codes: <code>0</code> PASS, <code>1</code> FAIL, <code>2</code> ERROR,{' '}
            <code>3</code> usage error.
          </p>
        </article>
        <article className="tool-card">
          <span className="tag">MCP</span>
          <h3>Expose Rite to an MCP client</h3>
          <pre className="pre-block" tabIndex={0}><code>{`{
  "mcpServers": {
    "rite": {
      "command": "npx",
      "args": ["--yes", "@timidan/rite@0.1.1", "mcp"]
    }
  }
}`}</code></pre>
          <dl className="tool-list">
            <div><dt><code>rite_analyze</code></dt><dd>Read a config: rule, mapped paths, case summary. Input: <code>config</code></dd></div>
            <div><dt><code>rite_verify</code></dt><dd>Run the checks with the CLI's engine; returns the report. Input: <code>config</code>, optional <code>out</code></dd></div>
            <div><dt><code>rite_report</code></dt><dd>Render a saved report. Input: <code>file</code></dd></div>
          </dl>
        </article>
      </div>
    </section>
  );
}

// ============================================================
// App
// ============================================================

function deriveVerdict({ status, lastRun, runError }) {
  const report = lastRun?.data ?? null;
  if (status === 'idle') {
    return { tone: 'idle', label: 'Not run', sub: 'Checks run in this browser against the fixed sample.' };
  }
  if (status === 'running') return { tone: 'idle', label: 'Running', sub: '' };
  if (status === 'error') {
    return { tone: 'fail', label: 'ERROR', sub: runError || 'Checks could not complete.' };
  }
  if (lastRun?.kind === 'case') {
    return { tone: 'idle', label: 'Single case', sub: 'Run all current checks for an aggregate result.' };
  }
  if (!Array.isArray(report?.results) || report.results.length === 0) {
    return { tone: 'fail', label: 'ERROR', sub: 'No results produced.' };
  }
  const total = report.results.length;
  const failed = report.results.filter(r => r.status !== 'PASS').length;
  const overall = report.status?.toLowerCase();
  if (overall === 'pass') {
    return { tone: 'pass', label: 'PASS', sub: `${total} of ${total} current checks passed across two mapped entry paths.` };
  }
  if (overall === 'fail') {
    return { tone: 'fail', label: 'FAIL', sub: `${failed} of ${total} current checks failed.` };
  }
  return {
    tone: 'fail',
    label: 'ERROR',
    sub: report.results.find(r => r.status === 'ERROR')?.error ?? 'Unknown error.',
  };
}

export default function App() {
  const [status, setStatus]       = useState('idle');      // 'idle'|'running'|'complete'|'error'
  const [lastRun, setLastRun]     = useState(null);         // {kind:'suite'|'case', data}
  const [runError, setRunError]   = useState(null);
  const [selectedKey, setSelectedKey] = useState(null);
  const [pathFilter, setPathFilter]   = useState('all');
  const [pulse, setPulse]         = useState(0);            // restarts the signal trace after each run
  const { gh, refreshing, refresh } = useGitHubSession();

  const running = status === 'running';
  const report = lastRun?.data ?? null;

  // Auto-select first failing/error result after a run
  useEffect(() => {
    if (status !== 'complete' || !report?.results?.length) return;
    const failOrError = report.results.find(r => r.status === 'FAIL' || r.status === 'ERROR');
    if (failOrError) {
      setSelectedKey(failOrError.id);
    } else if (!selectedKey || !report.results.find(r => r.id === selectedKey)) {
      setSelectedKey(report.results[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, report]);

  async function handleRunAll() {
    setStatus('running');
    setRunError(null);
    try {
      const data = runSuite();
      setLastRun({ kind: 'suite', data });
      setStatus('complete');
    } catch (e) {
      setRunError(String(e?.message ?? e));
      setLastRun(null);
      setStatus('error');
    }
    setPulse(n => n + 1);
  }

  async function handleRunCase(caseSpec, entry) {
    setStatus('running');
    setRunError(null);
    try {
      const result = runCase(caseSpec, entry);
      setLastRun({ kind: 'case', data: { status: result.status, results: [result] } });
      setSelectedKey(result.id);
      setStatus('complete');
    } catch (e) {
      setRunError(String(e?.message ?? e));
      setLastRun(null);
      setStatus('error');
    }
    setPulse(n => n + 1);
  }

  function handleReset() {
    setStatus('idle');
    setLastRun(null);
    setRunError(null);
    setSelectedKey(null);
  }

  const verdict = deriveVerdict({ status, lastRun, runError });
  const logoSrc = `${import.meta.env.BASE_URL}assets/rite-logo-primary-1200.png`;

  return (
    <>
      <header className="header">
        <a className="brand" href="#top" aria-label="Rite, top of page">
          <img src={logoSrc} alt="Rite" width={1200} height={400} />
        </a>
        <nav className="nav" aria-label="Sections">
          <a href="#sample">Checks</a>
          <a href="#proof">Proof</a>
          <a href="#github-evidence">Repository</a>
          <a href="#setup">Setup</a>
        </nav>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-heading">
          <div className="hero-copy">
            <p className="eyebrow hero-rise">Authorization checks</p>
            <h1 id="hero-heading" className="hero-rise">
              One rule. <span className="h1-line">Every mapped path.</span>
            </h1>
            <p className="lead hero-rise">
              Black-box checks that every path you map to a sensitive operation enforces the same rule.
            </p>
            <div className="actions hero-rise">
              <button
                className="btn"
                onClick={handleRunAll}
                disabled={running}
                aria-busy={running ? 'true' : undefined}
              >
                {running ? 'Running…' : 'Run sample checks'}
              </button>
              <GitHubStatus gh={gh} />
            </div>
          </div>

          <Instrument lastRun={lastRun} verdict={verdict} pulse={pulse} />
        </section>

        <section className="workbench" id="sample" aria-label="Sample workbench">
          <div className="results-col">
            <div className="results-head">
              <div className="run-controls">
                <button
                  className="btn"
                  onClick={handleRunAll}
                  disabled={running}
                  aria-busy={running ? 'true' : undefined}
                >
                  {running ? 'Running…' : 'Run all current checks'}
                </button>
                <button className="btn btn-secondary" onClick={handleReset} disabled={running}>
                  Reset
                </button>
              </div>
            </div>
            <ResultsTable
              lastRun={lastRun}
              pathFilter={pathFilter}
              setPathFilter={setPathFilter}
              selectedKey={selectedKey}
              setSelectedKey={setSelectedKey}
              onRunCase={handleRunCase}
              running={running}
            />
            <p className="note">
              Orders and actors are in-memory simulation, not sign-in; no money moves. Paths outside
              this map are not checked.
            </p>
          </div>

          <div className="case-detail-col">
            <CaseDetail selectedKey={selectedKey} lastRun={lastRun} />
          </div>
        </section>

        <RecordedProof />

        <div className="duo">
          <GitHubEvidence gh={gh} refreshing={refreshing} refresh={refresh} />
          <Setup />
        </div>

        <LocalTools />
      </main>

      <footer className="footer">
        Built with IBM Bob for the IBM Bob 2.0 Hackathon 2026. Not affiliated with or endorsed by
        IBM. Rite reads the reports a repository's own workflow produces; it does not analyze that
        repository's code.
      </footer>
    </>
  );
}
