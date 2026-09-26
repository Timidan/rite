/**
 * src/watsonx/draft.js — watsonx.ai case and path drafting.
 *
 * Sends a rule + limited code snippet to IBM watsonx.ai (via the chat API)
 * and returns a candidate config diff for developer review.
 *
 * Authentication: IBM Cloud IAM API key → bearer token exchange.
 * The token is never written to disk or logged.
 *
 * Environment variables (never passed to verify; server-side only):
 *   IBMCLOUD_API_KEY     — IBM Cloud IAM API key
 *   WATSONX_PROJECT_ID   — watsonx.ai project ID
 *   WATSONX_REGION       — e.g. us-south (default)
 *   WATSONX_MODEL_ID     — e.g. ibm/granite-3-3-8b-instruct (checked at runtime)
 *
 * If any credential is absent, draftCases() returns { available: false, reason }.
 * The caller must display this state and never show a mocked response as live.
 *
 * API reference: https://cloud.ibm.com/docs/apis/watsonx-ai
 */

const IAM_TOKEN_URL = 'https://iam.cloud.ibm.com/identity/token';
const DEFAULT_REGION = 'us-south';

// ------------------------------------------------------------------ //
// IAM token exchange                                                   //
// ------------------------------------------------------------------ //

/**
 * Exchange an IBM Cloud API key for a short-lived bearer token.
 * @param {string} apiKey
 * @returns {Promise<string>} access token
 */
async function getIamToken(apiKey) {
  const body = new URLSearchParams({
    grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
    apikey: apiKey,
  });

  const resp = await fetch(IAM_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`IAM token exchange failed (${resp.status}): ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  if (!data.access_token) throw new Error('IAM response missing access_token');
  return data.access_token;
}

// ------------------------------------------------------------------ //
// Model listing — verify entitlement at runtime                       //
// ------------------------------------------------------------------ //

/**
 * List available foundation models in the project.
 * Returns the first Granite text model found, or null.
 * @param {string} token
 * @param {string} projectId
 * @param {string} region
 * @returns {Promise<string|null>}
 */
async function resolveModelId(token, projectId, region) {
  const url = `https://${region}.ml.cloud.ibm.com/ml/v1/foundation_model_specs?version=2024-09-16&limit=50`;
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const models = data.resources ?? [];
    // Prefer a granite instruct model
    const granite = models.find(m =>
      m.model_id?.includes('granite') && m.model_id?.includes('instruct')
    );
    return granite?.model_id ?? models[0]?.model_id ?? null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ //
// Prompt construction                                                  //
// ------------------------------------------------------------------ //

/**
 * Build the prompt asking watsonx for candidate config entries.
 * Sends ONLY the rule and explicitly selected code snippet (size-limited).
 * @param {string} rule
 * @param {string} snippet  — public/synthetic only, reviewed before sending
 * @returns {string}
 */
function buildPrompt(rule, snippet) {
  return `You are helping a developer configure an authorization verification tool called Rite.

The developer has written this authorization rule:
"${rule}"

Here is a limited code snippet from their service (synthetic/public data only):
\`\`\`js
${snippet.slice(0, 2000)}
\`\`\`

Please identify:
1. Candidate entry point function names that could reach a sensitive operation.
2. The likely sink function name (the sensitive operation).
3. Three to five test cases: at least one that should be ALLOWED and at least two that should be DENIED (with different denial reasons).
4. For each case: a unique ID, which entry path, a test actor ID, a minimal input object, expected decision (allow/deny), and a brief reason.

IMPORTANT:
- Only cite functions that appear in the snippet above. Label anything inferred as a hypothesis.
- Do not invent actors, amounts, or resource IDs beyond what the snippet implies.
- Return ONLY valid JSON matching this schema (no prose, no markdown fences):

{
  "hypothesis": true,
  "paths": [
    { "entry": "functionName", "sink": "sinkName", "source": "filename.js" }
  ],
  "cases": [
    {
      "id": "case-id",
      "path": "entryFunctionName",
      "actor": "actor-id",
      "input": { "resourceId": "resource-1" },
      "expected": { "decision": "allow|deny", "effects": [], "stateChanged": false },
      "reason": "One sentence."
    }
  ]
}`;
}

// ------------------------------------------------------------------ //
// Main draft function                                                  //
// ------------------------------------------------------------------ //

/**
 * @typedef {{
 *   available: true,
 *   modelId: string,
 *   hypothesis: true,
 *   paths: object[],
 *   cases: object[],
 *   rawResponse: string,
 * } | {
 *   available: false,
 *   reason: string,
 * }} DraftResult
 */

/**
 * Call watsonx.ai to draft candidate paths and cases from a rule + snippet.
 * Returns available:false when credentials are missing or the call fails.
 * Never throws — errors are returned as available:false with a reason.
 *
 * @param {{ rule: string, snippet: string }} opts
 * @returns {Promise<DraftResult>}
 */
export async function draftCases({ rule, snippet }) {
  const apiKey     = process.env.IBMCLOUD_API_KEY;
  const projectId  = process.env.WATSONX_PROJECT_ID;
  const region     = process.env.WATSONX_REGION ?? DEFAULT_REGION;
  const modelIdEnv = process.env.WATSONX_MODEL_ID;

  if (!apiKey)    return { available: false, reason: 'IBMCLOUD_API_KEY not set' };
  if (!projectId) return { available: false, reason: 'WATSONX_PROJECT_ID not set' };

  let token;
  try {
    token = await getIamToken(apiKey);
  } catch (e) {
    return { available: false, reason: `IAM auth failed: ${e.message}` };
  }

  // Resolve model at runtime — do not guess a model ID
  const modelId = modelIdEnv ?? await resolveModelId(token, projectId, region);
  if (!modelId) {
    return { available: false, reason: 'No foundation model available in this project. Set WATSONX_MODEL_ID or check project entitlements.' };
  }

  const prompt = buildPrompt(rule, snippet);
  const url = `https://${region}.ml.cloud.ibm.com/ml/v1/text/chat?version=2024-09-16`;

  let rawResponse;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: modelId,
        project_id: projectId,
        messages: [{ role: 'user', content: prompt }],
        parameters: {
          max_new_tokens: 1200,
          temperature: 0.2,
        },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { available: false, reason: `watsonx API error (${resp.status}): ${text.slice(0, 300)}` };
    }

    const data = await resp.json();
    rawResponse = data?.results?.[0]?.generated_text
      ?? data?.choices?.[0]?.message?.content
      ?? JSON.stringify(data);
  } catch (e) {
    return { available: false, reason: `Network error calling watsonx: ${e.message}` };
  }

  // Parse response — treat as untrusted
  let parsed;
  try {
    // Strip markdown fences if present
    const cleaned = rawResponse.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return { available: false, reason: `watsonx returned non-JSON response. Raw: ${rawResponse.slice(0, 300)}` };
  }

  // Validate required fields
  if (!Array.isArray(parsed.paths) || !Array.isArray(parsed.cases)) {
    return { available: false, reason: 'watsonx response missing paths or cases arrays. Check prompt and model.' };
  }

  // Verify all path/case citations are in the snippet
  for (const p of parsed.paths) {
    if (typeof p.entry === 'string' && !snippet.includes(p.entry)) {
      // Label as unverified hypothesis rather than reject
      p.hypothesis = true;
    }
  }

  return {
    available: true,
    modelId,
    hypothesis: true,  // Always label model output as hypothesis
    paths: parsed.paths,
    cases: parsed.cases,
    rawResponse,
  };
}
