// src/migrations.js
// Forge SQL (TiDB / MySQL-compatible) schema for ContextIQ: Agentic Playwright Orchestrator
//
// manifest.yml requirements:
//   modules:
//     sql:
//       - key: main
//         engine: mysql
//   permissions:
//     scopes:
//       - storage:app

import { migrationRunner } from "@forge/sql";

export const runMigrations = () =>
  migrationRunner

    // 001: Parent table - one row per Playwright execution
    .enqueue(
      "v001_create_test_runs",
      `CREATE TABLE IF NOT EXISTS test_runs (
        id                BIGINT       NOT NULL PRIMARY KEY AUTO_RANDOM,
        jira_issue_key    VARCHAR(50)  NOT NULL,
        trigger_type      VARCHAR(50)  NOT NULL,
        execution_time    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        overall_status    VARCHAR(20)  NOT NULL,
        ai_summary_report TEXT,
        INDEX idx_test_runs_jira_issue_key (jira_issue_key),
        INDEX idx_test_runs_execution_time (execution_time)
      )`
    )

    // 002: Child table - individual test cases belonging to a run
    .enqueue(
      "v002_create_test_cases",
      `CREATE TABLE IF NOT EXISTS test_cases (
        id          BIGINT       NOT NULL PRIMARY KEY AUTO_RANDOM,
        run_id      BIGINT       NOT NULL,
        case_name   VARCHAR(255) NOT NULL,
        browser     VARCHAR(50)  NOT NULL,
        duration_ms INT          NOT NULL DEFAULT 0,
        status      VARCHAR(20)  NOT NULL,
        error_log   TEXT,
        INDEX idx_test_cases_run_id (run_id),
        INDEX idx_test_cases_status (status)
      )`
    )

    // 003: Relational link test_cases.run_id -> test_runs.id
    // Kept as its own migration step so the tables above are created independently.
    .enqueue(
      "v003_add_fk_test_cases_run_id",
      `ALTER TABLE test_cases
        ADD CONSTRAINT fk_test_cases_run_id
        FOREIGN KEY (run_id) REFERENCES test_runs (id)
        ON DELETE CASCADE`
    );