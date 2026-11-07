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
import { randomUUID } from 'crypto';

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
    trigger: 'Jira Transition',
    executedAt: startedAt,
    duration: '-',
  };

  try {
    await dispatchPlaywrightRun({
      issueKey,
      issueId,
      runId,
      fromStatus: statusChange.fromString,
      toStatus: statusChange.toString,
    });

    await saveRun(issueKey, { ...baseRun, status: 'RUNNING' });

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
    console.error(`Playwright dispatch failed for ${issueKey}:`, error);

    await saveRun(issueKey, { ...baseRun, status: 'FAILED' }).catch((storageError) =>
      console.error('Could not persist failed run:', storageError)
    );

    return { triggered: false, error: error.message };
  }
};
