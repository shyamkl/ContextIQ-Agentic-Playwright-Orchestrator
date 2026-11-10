import Resolver from '@forge/resolver';
import { fetch } from '@forge/api';
import { sql } from '@forge/sql';
import { timingSafeEqual } from 'crypto';

const GITHUB_API_BASE = 'https://api.github.com';
const DISPATCH_EVENT_TYPE = 'trigger-playwright-validation';
const REQUEST_TIMEOUT_MS = 15000;

const resolver = new Resolver();

/**
 * Frontend resolver: returns all Playwright test runs, newest first.
 */
resolver.define('getTestResults', async () => {
  try {
    const result = await sql
      .prepare('SELECT * FROM test_runs ORDER BY execution_time DESC')
      .execute();
    return result.rows ?? [];
  } catch (error) {
    console.error('getTestResults: SQL query failed:', error?.message || error);
    throw new Error('Unable to retrieve test results at this time.');
  }
});

export const handler = resolver.getDefinitions();

/**
 * Jira issue-updated trigger (manifest function: handleJiraTrigger).
 * Fires a GitHub repository_dispatch event to start Playwright validation.
 */
export async function handleJiraTrigger(event, context) {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  const missing = [
    ['GITHUB_TOKEN', token],
    ['GITHUB_OWNER', owner],
    ['GITHUB_REPO', repo],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    console.error(`handleJiraTrigger: missing environment variables: ${missing.join(', ')}`);
    return { success: false, error: 'Missing required configuration.' };
  }

  const issue = event?.issue ?? {};
  const payload = {
    event_type: DISPATCH_EVENT_TYPE,
    client_payload: {
      issueKey: issue.key ?? null,
      issueId: issue.id ?? null,
      projectKey: issue.fields?.project?.key ?? null,
      status: issue.fields?.status?.name ?? null,
      changelog: event?.changelog?.items ?? [],
      eventType: event?.eventType ?? null,
      triggeredAt: new Date().toISOString(),
    },
  };

  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/dispatches`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ContextIQ-Playwright-Orchestrator',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    // GitHub returns 204 No Content on successful dispatch.
    if (response.status !== 204) {
      const detail = await response.text();
      console.error(`handleJiraTrigger: GitHub dispatch failed (${response.status}): ${detail}`);
      return { success: false, status: response.status };
    }

    console.log(`handleJiraTrigger: dispatched '${DISPATCH_EVENT_TYPE}' for issue ${issue.key ?? 'unknown'}`);
    return { success: true, status: response.status };
  } catch (error) {
    console.error('handleJiraTrigger: request error:', error?.message || error);
    return { success: false, error: 'GitHub dispatch request failed.' };
  } finally {
    clearTimeout(timer);
  }
}

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': ['application/json'] },
  body: JSON.stringify(body),
});

const readHeader = (headers, name) => {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) return undefined;
  const value = headers[key];
  return Array.isArray(value) ? value[0] : value;
};

const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

/**
 * Web trigger (manifest function: handlePlaywrightCallback).
 * Receives completed Playwright results from GitHub Actions and persists them to test_runs.
 *
 * Expected POST JSON body:
 *   { jiraIssueKey, suiteName, browser, durationMs, status, aiSummaryReport }
 *
 * Assumed test_runs columns:
 *   jira_issue_key, suite_name, browser, duration_ms, status, ai_summary_report, execution_time
 *
 * Auth: requests must send the shared secret in the 'x-callback-token' header,
 * matching process.env.CALLBACK_SECRET.
 */
export async function handlePlaywrightCallback(request) {
  if (request?.method && request.method.toUpperCase() !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed. Use POST.' });
  }

  const expectedSecret = process.env.CALLBACK_SECRET;
  if (!expectedSecret) {
    console.error('handlePlaywrightCallback: CALLBACK_SECRET is not configured.');
    return jsonResponse(500, { error: 'Server configuration error.' });
  }

  const providedSecret = readHeader(request?.headers, 'x-callback-token');
  if (!providedSecret || !safeEqual(providedSecret, expectedSecret)) {
    console.warn('handlePlaywrightCallback: rejected request with invalid or missing token.');
    return jsonResponse(401, { error: 'Unauthorized.' });
  }

  let data;
  try {
    data = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
  } catch (error) {
    return jsonResponse(400, { error: 'Request body must be valid JSON.' });
  }

  if (!data || typeof data !== 'object') {
    return jsonResponse(400, { error: 'Request body must be a JSON object.' });
  }

  const { jiraIssueKey, suiteName, browser, durationMs, status, aiSummaryReport } = data;

  const requiredStrings = { jiraIssueKey, suiteName, browser, status };
  const invalid = Object.entries(requiredStrings)
    .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
    .map(([name]) => name);

  const duration = Number(durationMs);
  if (!Number.isFinite(duration) || duration < 0) invalid.push('durationMs');

  if (aiSummaryReport !== undefined && aiSummaryReport !== null && typeof aiSummaryReport !== 'string') {
    invalid.push('aiSummaryReport');
  }

  if (invalid.length > 0) {
    return jsonResponse(400, { error: `Invalid or missing fields: ${invalid.join(', ')}` });
  }

  try {
    await sql
      .prepare(
        `INSERT INTO test_runs
           (jira_issue_key, suite_name, browser, duration_ms, status, ai_summary_report, execution_time)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`
      )
      .bindParams(
        jiraIssueKey.trim(),
        suiteName.trim(),
        browser.trim(),
        Math.round(duration),
        status.trim(),
        aiSummaryReport ?? null
      )
      .execute();

    console.log(`handlePlaywrightCallback: stored result for ${jiraIssueKey} (${suiteName}/${browser}, ${status}).`);
    return jsonResponse(201, { success: true });
  } catch (error) {
    console.error('handlePlaywrightCallback: SQL insert failed:', error?.message || error);
    return jsonResponse(500, { error: 'Failed to store test results.' });
  }
}