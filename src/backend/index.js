/**
 * RovoTest: Agentic Playwright Orchestrator - Backend
 * File: src/backend/index.js
 *
 * REQUIRED manifest.yml wiring for this file:
 *
 * modules:
 *   trigger:
 *     - key: ready-for-testing-trigger
 *       function: ready-for-testing-fn
 *       events:
 *         - avi:jira:updated:issue
 *   function:
 *     - key: resolver-fn
 *       handler: backend/index.handler
 *     - key: ready-for-testing-fn
 *       handler: backend/index.onIssueTransition
 * permissions:
 *   scopes:
 *     - read:jira-work
 *     - write:jira-work
 *     - storage:app
 *   external:
 *     fetch:
 *       backend:
 *         - address: api.github.com
 *
 * REQUIRED encrypted environment variables (set per environment):
 *   forge variables set --encrypt GITHUB_TOKEN <fine-grained PAT with repo "Contents: write">
 *   forge variables set GITHUB_OWNER <org-or-user>
 *   forge variables set GITHUB_REPO <repository-name>
 *   forge variables set PLAYWRIGHT_SUITE "Checkout Flow - Cross-Browser"   (optional)
 */

import Resolver from '@forge/resolver';
import api, { fetch, route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

/* ---------- Constants ---------- */

const TARGET_STATUS = 'Ready for Testing';
const DISPATCH_EVENT_TYPE = 'rovotest-run';
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const MAX_STORED_RUNS = 20;

const runsKey = (issueKey) => `rovotest:runs:${issueKey}`;
const summaryKey = (issueKey) => `rovotest:ai-summary:${issueKey}`;

/* ---------- Database layer (Forge KVS) ---------- */

const loadRuns = async (issueKey) => (await kvs.get(runsKey(issueKey))) || [];

const loadAiSummary = async (issueKey) =>
  (await kvs.get(summaryKey(issueKey))) ||
  'No AI-agent feedback has been recorded for this issue yet. Move the issue to **Ready for Testing** to trigger a Playwright run.';

const saveRun = async (issueKey, run) => {
  const existing = await loadRuns(issueKey);
  const updated = [run, ...existing].slice(0, MAX_STORED_RUNS);
  await kvs.set(runsKey(issueKey), updated);
  return updated;
};

const deriveLatestStatus = (runs) => (runs.length > 0 ? runs[0].status : 'QUEUED');

/* ---------- Resolver: consumed by the Forge UI Kit frontend ---------- */
/* Registered in manifest.yml as function key "resolver-fn" -> backend/index.handler */

const resolver = new Resolver();

resolver.define('getTestResults', async ({ context }) => {
  const issueKey = context?.extension?.issue?.key;

  if (!issueKey) {
    return {
      success: false,
      error: 'Issue context is unavailable. This resolver must be called from a Jira issue panel.',
      latestStatus: 'QUEUED',
      runs: [],
      aiFeedbackMarkdown: '',
    };
  }

  try {
    const [runs, aiFeedbackMarkdown] = await Promise.all([
      loadRuns(issueKey),
      loadAiSummary(issueKey),
    ]);

    return {
      success: true,
      issueKey,
      latestStatus: deriveLatestStatus(runs),
      runs,
      aiFeedbackMarkdown,
    };
  } catch (error) {
    console.error(`getTestResults failed for ${issueKey}:`, error);
    return {
      success: false,
      error: 'Unable to load test results from storage.',
      latestStatus: 'QUEUED',
      runs: [],
      aiFeedbackMarkdown: '',
    };
  }
});

export const handler = resolver.getDefinitions();

/* ---------- GitHub Actions repository_dispatch ---------- */

const dispatchPlaywrightRun = async ({ issueKey, issueId, runId, fromStatus, toStatus }) => {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    throw new Error(
      'Missing GITHUB_TOKEN, GITHUB_OWNER or GITHUB_REPO. Set them with "forge variables set".'
    );
  }

  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_type: DISPATCH_EVENT_TYPE,
        client_payload: {
          runId,
          issueKey,
          issueId,
          fromStatus,
          toStatus,
          trigger: 'jira-transition',
        },
      }),
    }
  );

  // GitHub responds with 204 No Content when the dispatch is accepted.
  if (response.status !== 204) {
    const details = await response.text();
    throw new Error(`GitHub dispatch failed (${response.status}): ${details}`);
  }
};

const postIssueComment = async (issueKey, message) => {
  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: message }],
          },
        ],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Jira comment failed (${response.status}): ${await response.text()}`);
  }
};

/* ---------- Jira trigger: fires when an issue is updated ---------- */
/* Registered in manifest.yml as function key "ready-for-testing-fn" -> backend/index.onIssueTransition */

export const onIssueTransition = async (event) => {
  const issueKey = event?.issue?.key;
  const issueId = event?.issue?.id;
  const changeItems = event?.changelog?.items || [];

  const statusChange = changeItems.find(
    (item) =>
      item.field === 'status' &&
      typeof item.toString === 'string' &&
      item.toString.trim().toLowerCase() === TARGET_STATUS.toLowerCase()
  );

  // Ignore every update that is not a transition into "Ready for Testing".
  if (!issueKey || !statusChange) {
    return { triggered: false };
  }

  const runId = `run-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const baseRun = {
    id: runId,
    suite: process.env.PLAYWRIGHT_SUITE || 'Playwright E2E Suite',
    suite_name: process.env.PLAYWRIGHT_SUITE || 'Playwright E2E Suite',
    trigger: 'Jira Transition',
    executedAt: startedAt,
    duration: '-',
  };

  try {
    // Persist before dispatch so an immediate callback can find the run.
    await saveRun(issueKey, { ...baseRun, status: 'RUNNING' });

    await dispatchPlaywrightRun({
      issueKey,
      issueId,
      runId,
      fromStatus: statusChange.fromString,
      toStatus: statusChange.toString,
    });

    try {
      await postIssueComment(
        issueKey,
        `RovoTest: Playwright run ${runId} was dispatched to GitHub Actions after this issue moved to "${TARGET_STATUS}".`
      );
    } catch (commentError) {
      // A failed comment must never mask a successful dispatch.
      console.error(`Could not comment on ${issueKey}:`, commentError);
    }

    return { triggered: true, runId };
  } catch (error) {
    console.error(`Playwright run dispatch failed for ${issueKey}:`, error);

    await updateRun(issueKey, runId, {
      status: 'FAILED',
      completedAt: new Date().toISOString(),
    }).catch((storageError) =>
      console.error('Could not update failed run:', storageError)
    );

    return { triggered: false, error: error.message };
  }
};
/* ---------- Secure GitHub Actions result callback ---------- */

const callbackResponse = (statusCode, message) => ({
  statusCode,
  headers: {
    'Content-Type': ['application/json'],
  },
  body: JSON.stringify({ success: statusCode >= 200 && statusCode < 300, message }),
});

const getRequestHeader = (headers, name) => {
  const entry = Object.entries(headers || {}).find(
    ([key]) => key.toLowerCase() === name.toLowerCase()
  );

  const value = entry?.[1];
  return Array.isArray(value) ? value[0] : value;
};

const updateRun = async (issueKey, runId, result) => {
  const runs = await loadRuns(issueKey);
  const index = runs.findIndex((run) => run.id === runId);

  if (index === -1) {
    return false;
  }

  const currentStatus = String(runs[index].status || '').toUpperCase();
  if (['PASSED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(currentStatus)) {
    return false;
  }

  const updatedRuns = [...runs];

  updatedRuns[index] = {
    ...updatedRuns[index],
    ...result,
  };

  await kvs.set(runsKey(issueKey), updatedRuns);

  return true;
};

export const handleGithubResult = async (request) => {
  try {
    if (request?.method !== 'POST') {
      return callbackResponse(405, 'POST method required.');
    }

    const secret = process.env.GITHUB_CALLBACK_SECRET;
    const rawBody = request?.body;

    if (!secret) {
      console.error('GITHUB_CALLBACK_SECRET is not configured.');
      return callbackResponse(500, 'Callback authentication is not configured.');
    }

    if (typeof rawBody !== 'string' || rawBody.length === 0 || rawBody.length > 100000) {
      return callbackResponse(400, 'Invalid request body.');
    }

    const timestamp = getRequestHeader(
      request.headers,
      'x-rovotest-timestamp'
    );

    const signature = getRequestHeader(
      request.headers,
      'x-rovotest-signature'
    );

    if (
      typeof timestamp !== 'string' ||
      !/^\d{10}$/.test(timestamp) ||
      typeof signature !== 'string' ||
      !/^sha256=[a-f0-9]{64}$/i.test(signature)
    ) {
      return callbackResponse(401, 'Missing or invalid authentication headers.');
    }

    const timestampSeconds = Number(timestamp);
    const currentTimestamp = Math.floor(Date.now() / 1000);

    if (Math.abs(currentTimestamp - timestampSeconds) > 300) {
      return callbackResponse(401, 'Callback timestamp has expired.');
    }

    const expectedSignature = createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`, 'utf8')
      .digest();

    const suppliedSignature = Buffer.from(signature.slice(7), 'hex');

    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return callbackResponse(401, 'Callback signature verification failed.');
    }

    let payload;

    try {
      payload = JSON.parse(rawBody);
    } catch {
      return callbackResponse(400, 'Invalid JSON payload.');
    }

    const { runId, issueKey, status } = payload || {};

    if (
      typeof runId !== 'string' ||
      !/^run-[a-f0-9-]{36}$/i.test(runId) ||
      typeof issueKey !== 'string' ||
      !/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey) ||
      typeof status !== 'string'
    ) {
      return callbackResponse(400, 'Missing or invalid run information.');
    }

    const statusMap = {
      success: 'PASSED',
      passed: 'PASSED',
      failure: 'FAILED',
      failed: 'FAILED',
      cancelled: 'CANCELLED',
      timed_out: 'TIMED_OUT',
    };

    const finalStatus = statusMap[status.toLowerCase()];

    if (!finalStatus) {
      return callbackResponse(400, 'Unsupported test result status.');
    }

    const durationMs = Number(payload.durationMs);

    if (
      !Number.isFinite(durationMs) ||
      durationMs < 0 ||
      durationMs > 86400000
    ) {
      return callbackResponse(400, 'Invalid test duration.');
    }

    const {
      totalTests,
      passedTests,
      failedTests,
      skippedTests,
    } = payload;

    const calculatedTotal = passedTests + failedTests + skippedTests;

    if (
      ![totalTests, passedTests, failedTests, skippedTests].every(
        (count) => Number.isSafeInteger(count) && count >= 0
      ) ||
      !Number.isSafeInteger(calculatedTotal) ||
      totalTests !== calculatedTotal
    ) {
      return callbackResponse(400, 'Invalid or inconsistent test counts.');
    }

    const result = {
      status: finalStatus,
      duration_ms: Math.round(durationMs),
      suite_name:
        typeof payload.suiteName === 'string'
          ? payload.suiteName.slice(0, 200)
          : 'Playwright E2E Suite',
      browser:
        typeof payload.browser === 'string'
          ? payload.browser.slice(0, 100)
          : 'Multiple browsers',
      total_tests: totalTests,
      passed_tests: passedTests,
      failed_tests: failedTests,
      skipped_tests: skippedTests,
      ai_summary_report:
        typeof payload.aiSummaryMarkdown === 'string'
          ? payload.aiSummaryMarkdown.slice(0, 30000)
          : '',
      report_url:
        typeof payload.reportUrl === 'string' &&
        payload.reportUrl.startsWith('https://github.com/')
          ? payload.reportUrl.slice(0, 1000)
          : '',
      completedAt: new Date().toISOString(),
    };

    const updated = await updateRun(issueKey, runId, result);

    if (!updated) {
      return callbackResponse(409, 'No matching dispatched run was found.');
    }

    console.log(`GitHub result received for ${issueKey}, run ${runId}: ${finalStatus}`);

    return callbackResponse(200, 'Test result successfully recorded.');
  } catch (error) {
    console.error('GitHub result callback failed:', error);
    return callbackResponse(500, 'Unable to record the test result.');
  }
};
