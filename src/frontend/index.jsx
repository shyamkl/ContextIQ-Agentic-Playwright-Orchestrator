import React, { useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  DynamicTable,
  Heading,
  Inline,
  Lozenge,
  SectionMessage,
  Stack,
  Strong,
  Text,
  xcss,
} from '@forge/react';

/* ---------- Styling ---------- */

const cardStyles = xcss({
  backgroundColor: 'elevation.surface',
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'border.radius',
  padding: 'space.200',
});

const feedbackStyles = xcss({
  backgroundColor: 'color.background.neutral',
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'border.radius',
  padding: 'space.200',
});

/* ---------- Status helpers ---------- */

const STATUS_CONFIG = {
  PASSED: { appearance: 'success', label: 'PASSED' },
  FAILED: { appearance: 'removed', label: 'FAILED' },
  RUNNING: { appearance: 'inprogress', label: 'RUNNING' },
  QUEUED: { appearance: 'default', label: 'QUEUED' },
};

const StatusLozenge = ({ status, isBold = false }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.QUEUED;
  return (
    <Lozenge appearance={config.appearance} isBold={isBold}>
      {config.label}
    </Lozenge>
  );
};

/* ---------- Mock data (replace with resolver data via @forge/bridge invoke) ---------- */

const TEST_RUNS = [
  {
    id: 'run-1048',
    suite: 'Checkout Flow - Cross-Browser',
    trigger: 'Pull Request',
    executedAt: 'Nov 7, 2026, 1:42 PM',
    duration: '4m 12s',
    status: 'RUNNING',
  },
  {
    id: 'run-1047',
    suite: 'Login & Session Management',
    trigger: 'Pull Request',
    executedAt: 'Nov 7, 2026, 11:18 AM',
    duration: '2m 03s',
    status: 'FAILED',
  },
  {
    id: 'run-1046',
    suite: 'Search & Filter Regression',
    trigger: 'Manual',
    executedAt: 'Nov 6, 2026, 5:55 PM',
    duration: '6m 47s',
    status: 'PASSED',
  },
  {
    id: 'run-1045',
    suite: 'Account Settings Smoke Suite',
    trigger: 'Manual',
    executedAt: 'Nov 6, 2026, 2:30 PM',
    duration: '1m 29s',
    status: 'PASSED',
  },
  {
    id: 'run-1044',
    suite: 'Checkout Flow - Cross-Browser',
    trigger: 'Pull Request',
    executedAt: 'Nov 5, 2026, 9:12 AM',
    duration: '4m 40s',
    status: 'PASSED',
  },
];

const AI_FEEDBACK_MARKDOWN = [
  '**Run:** `run-1047` - Login & Session Management',
  '**Agent verdict:** 2 DOM mismatches and 1 layout regression detected across 3 of 14 test cases.',
  '',
  '### DOM Element Mismatches',
  '- **Locator not found:** `button[data-testid="login-submit"]` - the element was renamed to `button[data-testid="auth-submit"]` in the latest commit.',
  '- **Accessibility role changed:** the `Remember me` checkbox now renders as a `switch` instead of a `checkbox`, breaking `getByRole("checkbox")`.',
  '',
  '### Layout Mismatches',
  '- **Viewport 375px:** the error banner overlaps the password field by roughly **18px**, so the field is not clickable.',
  '',
  '### Suggested Fixes',
  '1. Update the submit-button locator to the new `data-testid`.',
  '2. Switch the `Remember me` assertion to `getByRole("switch")`.',
  '3. Review the mobile CSS for `.auth-error-banner` positioning.',
].join('\n');

/* ---------- Table definition ---------- */

const head = {
  cells: [
    { key: 'suite', content: 'Test Suite Name', isSortable: true },
    { key: 'trigger', content: 'Trigger Type', isSortable: true },
    { key: 'time', content: 'Execution Time', isSortable: true },
    { key: 'status', content: 'Status' },
  ],
};

const buildRows = (runs) =>
  runs.map((run) => ({
    key: run.id,
    cells: [
      { key: `${run.id}-suite`, content: <Strong>{run.suite}</Strong> },
      {
        key: `${run.id}-trigger`,
        content: (
          <Lozenge appearance={run.trigger === 'Pull Request' ? 'new' : 'default'}>
            {run.trigger}
          </Lozenge>
        ),
      },
      {
        key: `${run.id}-time`,
        content: `${run.executedAt} (${run.duration})`,
      },
      { key: `${run.id}-status`, content: <StatusLozenge status={run.status} /> },
    ],
  }));

/* ---------- Components ---------- */

const SummaryHeader = ({ runs }) => {
  const latest = runs[0];
  const passed = runs.filter((r) => r.status === 'PASSED').length;
  const failed = runs.filter((r) => r.status === 'FAILED').length;
  const running = runs.filter((r) => r.status === 'RUNNING').length;

  return (
    <Box xcss={cardStyles}>
      <Stack space="space.150">
        <Inline space="space.150" alignBlock="center" spread="space-between">
          <Stack space="space.050">
            <Heading size="large">RovoTest: Agentic Playwright Orchestrator</Heading>
            <Text>Latest run: {latest.suite}</Text>
          </Stack>
          <Inline space="space.100" alignBlock="center">
            <Text>Latest execution state</Text>
            <StatusLozenge status={latest.status} isBold />
          </Inline>
        </Inline>
        <Inline space="space.200" alignBlock="center">
          <Inline space="space.075" alignBlock="center">
            <Lozenge appearance="success">{passed} Passed</Lozenge>
          </Inline>
          <Inline space="space.075" alignBlock="center">
            <Lozenge appearance="removed">{failed} Failed</Lozenge>
          </Inline>
          <Inline space="space.075" alignBlock="center">
            <Lozenge appearance="inprogress">{running} Running</Lozenge>
          </Inline>
        </Inline>
      </Stack>
    </Box>
  );
};

const RecentRunsTable = ({ runs }) => (
  <Stack space="space.100">
    <Heading size="medium">Recent Test Runs</Heading>
    <DynamicTable
      head={head}
      rows={buildRows(runs)}
      rowsPerPage={5}
      defaultPage={1}
      emptyView="No test runs have been recorded for this issue yet."
    />
  </Stack>
);

const AiFeedbackPanel = ({ markdown }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <Stack space="space.100">
      <Inline spread="space-between" alignBlock="center">
        <Heading size="medium">AI-Agent Feedback Summary</Heading>
        <Button
          appearance="subtle"
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          {isExpanded ? 'Collapse' : 'Expand'}
        </Button>
      </Inline>
      {isExpanded ? (
        <Box xcss={feedbackStyles}>
          <Text>{markdown}</Text>
        </Box>
      ) : (
        <SectionMessage appearance="information">
          <Text>
            Feedback is collapsed. Expand to review DOM and layout mismatches caught by the Playwright agent.
          </Text>
        </SectionMessage>
      )}
    </Stack>
  );
};

const App = () => (
  <Stack space="space.300">
    <SummaryHeader runs={TEST_RUNS} />
    <RecentRunsTable runs={TEST_RUNS} />
    <AiFeedbackPanel markdown={AI_FEEDBACK_MARKDOWN} />
  </Stack>
);

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
