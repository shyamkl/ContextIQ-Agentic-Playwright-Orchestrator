# ContextIQ: Agentic Playwright Orchestrator

**ContextIQ** is an AI-driven Quality Assurance orchestration platform built for **Atlassian Codegeist 2026**. It bridges **Jira**, **GitHub Actions**, **Playwright (TypeScript)**, and **Atlassian Rovo AI** into an automated, two-way testing and failure-triage pipeline.

When a developer or QA engineer transitions a Jira issue to **Ready for Testing**, ContextIQ automatically triggers cross-browser Playwright regression tests in the cloud, verifies execution metrics via cryptographic HMAC-SHA256 webhooks, and surfaces plain-English root-cause diagnostics directly inside the Jira issue panel.

---

## 🏗️ System Architecture & Operational Flow

```text
┌───────────────────────────┐       1. Issue Transition        ┌───────────────────────────┐
│     Jira Cloud Issue      │ ───────────────────────────────► │  Atlassian Forge Backend  │
│ ("Ready for Testing")     │                                  │  (src/backend/index.js)   │
└───────────────────────────┘                                  └─────────────┬─────────────┘
              ▲                                                              │
              │ 4. Render Live Results & AI Summary                          │ 2. repository_dispatch
              │    (@forge/react + @forge/kvs)                               │    ('rovotest-run')
              │                                                              ▼
┌─────────────┴─────────────┐       3. Signed HMAC-SHA256      ┌───────────────────────────┐
│  Forge Web Trigger API    │ ◄─────────────────────────────── │  GitHub Actions Runner    │
│  (handleGithubResult)     │          JSON Callback           │  (Playwright + TypeScript)│
└───────────────────────────┘                                  └───────────────────────────┘
```

1. **Automated Trigger:** Moving any Jira ticket to `Ready for Testing` fires the `avi:jira:updated:issue` Forge event listener.
2. **Cloud Execution:** The Forge backend dispatches a `rovotest-run` event to GitHub Actions, spinning up an Ubuntu runner with Chromium, Firefox, and WebKit.
3. **Cryptographic Callback:** Upon completion, the workflow packages pass/fail counts, duration metrics, and structured error logs into a JSON payload, signs it with **HMAC-SHA256** and a Unix timestamp, and posts it back to the Forge Web Trigger endpoint.
4. **AI Triage & Dashboard:** The Forge backend validates the signature, persists history in **Forge Key-Value Storage (`@forge/kvs`)**, and displays actionable test metrics and Rovo AI diagnostics inside the native Jira Issue Panel.

---

## 🛠️ Tech Stack

* **Platform & UI:** Atlassian Forge (`@forge/react`, `@forge/resolver`, `@forge/api`, `@forge/kvs`)
* **Test Automation Engine:** Playwright with TypeScript (`tests/e2e-pipeline.spec.ts`, `tests/demo-regression.spec.ts`)
* **CI/CD Orchestration:** GitHub Actions (`repository_dispatch` & Node.js cryptographic webhook reporter)
* **AI Diagnostics:** Atlassian Rovo AI Agent system prompt matrix (`src/ai/rovo-prompt.md`)
* **Security:** HMAC-SHA256 payload signing, timestamp replay protection (300-second window), and encrypted Forge environment variables

---

## 📂 Repository Structure

```text
ContextIQ-Agentic-Playwright-Orchestrator/
├── .github/workflows/
│   └── run-tests.yml             # GitHub Actions CI/CD runner & HMAC callback script
├── src/
│   ├── ai/
│   │   └── rovo-prompt.md        # System prompt rules for Rovo AI stack-trace analysis
│   ├── backend/
│   │   └── index.js              # Jira triggers, GitHub dispatch & HMAC webhook receiver
│   ├── database/
│   │   └── schema.sql            # Relational schema blueprint for test execution analytics
│   └── frontend/
│       └── index.jsx             # Native Jira Issue Panel UI Kit dashboard
├── tests/
│   ├── e2e-pipeline.spec.ts      # Cross-browser functional & visual baseline test suite
│   └── demo-regression.spec.ts   # Intentional selector mismatch test for Rovo AI triage demo
├── manifest.yml                  # Atlassian Forge app permissions, modules & triggers
└── playwright.config.ts          # Cross-browser configuration & OS-agnostic snapshot paths
```

---

## 🚀 Local Setup & Verification

### Prerequisites
* Node.js 22+
* Atlassian Forge CLI (`npm install -g @forge/cli`)

### 1. Install Dependencies & Browsers
```bash
npm install
npx playwright install
```

### 2. Run Playwright Suites Locally
```bash
# Run the full cross-browser test suite
npx playwright test

# Open the interactive HTML test report
npx playwright show-report
```

### 3. Configure Forge & GitHub Secrets
Set the required encrypted environment variables in Forge:
```bash
forge variables set --encrypt GITHUB_TOKEN <your-github-pat>
forge variables set GITHUB_OWNER <your-github-username>
forge variables set GITHUB_REPO ContextIQ-Agentic-Playwright-Orchestrator
forge variables set --encrypt GITHUB_CALLBACK_SECRET <your-hmac-secret>
```

Add the corresponding secrets in **GitHub Repository Settings → Secrets and variables → Actions**:
* `FORGE_CALLBACK_URL`: Generated via `forge webtrigger`
* `FORGE_CALLBACK_SECRET`: Must match the secret configured in Forge

---

## 👥 Team
Built by **Rmworkz Technology** for Atlassian Codegeist 2026.
