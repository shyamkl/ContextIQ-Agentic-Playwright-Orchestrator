# Devpost Submission Draft: ContextIQ

## Project Name
ContextIQ: Agentic Playwright Orchestrator

## Elevator Pitch (Tagline)
Turn Jira status transitions into automated cross-browser Playwright runs with cryptographic callbacks and Rovo AI failure diagnostics.

## Built With
`atlassian-forge`, `jira`, `rovo`, `playwright`, `typescript`, `node.js`, `github-actions`, `react`

---

## Inspiration
In fast-paced Agile teams, moving a Jira ticket to "Ready for Testing" often triggers a manual handoff. Even when teams have automated Playwright suites, test results live in isolated CI/CD logs, forcing QA engineers and developers to manually parse stack traces and inspect DOM diffs to figure out why a test broke. We wanted to eliminate that friction by turning Jira itself into an intelligent, self-verifying QA command center.

## What It Does
**ContextIQ** connects Jira issue lifecycle events directly to cloud-hosted Playwright automation and AI-powered triage:
1. **Zero-Click Test Dispatch:** Transitioning a Jira ticket to **Ready for Testing** automatically triggers a cross-browser Playwright + TypeScript suite (`Chromium`, `Firefox`, and `WebKit`) via GitHub Actions.
2. **Visual & Functional Validation:** Executes end-to-end user flows alongside OS-agnostic visual regression snapshot checks.
3. **Tamper-Proof Result Delivery:** Packages test counts, execution durations, and structured `[ContextIQ-Error]` logs, signing them with **HMAC-SHA256** and timestamp replay protection before sending them back to Atlassian Forge.
4. **Actionable Jira Dashboard & AI Triage:** Displays live test history, pass/fail badges, and plain-English Rovo AI root-cause recommendations right inside the Jira Issue Panel.

## How We Built It
* **Atlassian Forge Backend (`src/backend/index.js`):** Built serverless resolvers and event triggers (`avi:jira:updated:issue`) using `@forge/api`, `@forge/resolver`, and `@forge/kvs` for fast state persistence.
* **Forge UI Kit Frontend (`src/frontend/index.jsx`):** Built a native React dashboard inside Jira that asynchronously invokes backend resolvers to render live run histories and Markdown AI summaries.
* **Playwright & TypeScript Engine (`tests/`):** Engineered modular E2E suites featuring dynamic environment routing, video masking for deterministic visual baselines, and granular diagnostic error logging.
* **GitHub Actions CI/CD (`.github/workflows/run-tests.yml`):** Configured `repository_dispatch` workflows paired with a custom Node.js webhook reporter implementing `crypto.createHmac('sha256', ...)` authentication.

## Challenges We Ran Into
* **Cross-Platform Visual Baselines:** Generating baseline screenshots locally on Windows appended `-win32.png` to filenames, which caused mismatches on Ubuntu Linux GitHub Actions runners. We solved this by configuring a custom `snapshotPathTemplate` in `playwright.config.ts` to enforce OS-agnostic snapshot naming.
* **Securing Inbound Webhooks:** Exposing a public Forge Web Trigger URL risked unauthorized payload injection. We engineered mutual HMAC-SHA256 signature verification (`x-rovotest-signature`) paired with a 5-minute timestamp expiration window (`x-rovotest-timestamp`) in our Forge backend.

## Accomplishments That We're Proud Of
* Building a complete, bi-directional closed-loop integration between Jira Cloud and GitHub Actions with zero manual intervention.
* Implementing production-grade cryptographic webhook verification inside a serverless Forge function.
* Unifying functional E2E assertions, visual regression baselines, and AI-driven root-cause diagnostics inside a single Jira issue view.

## What's Next for ContextIQ
* **Automated PR Creation:** Enabling Atlassian Rovo to automatically open a pull request with the updated Playwright locator when a frontend DOM selector changes.
* **Historical Flakiness Scoring:** Expanding analytics to calculate multi-run stability scores and automatically quarantine flaky tests.
