import React, { useCallback, useEffect, useRef, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  DynamicTable,
  Expand,
  Heading,
  Inline,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const STATUS_APPEARANCE = {
  passed: 'success',
  pass: 'success',
  success: 'success',
  failed: 'removed',
  fail: 'removed',
  error: 'removed',
  running: 'inprogress',
  in_progress: 'inprogress',
  pending: 'new',
  queued: 'new',
  skipped: 'default',
};

const getStatusAppearance = (status) =>
  STATUS_APPEARANCE[String(status ?? '').toLowerCase()] || 'default';

const formatDuration = (value) => {
  const ms = Number(value);
  if (value === null || value === undefined || value === '' || Number.isNaN(ms)) {
    return '—';
  }
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
};

const head = {
  cells: [
    { key: 'suiteName', content: 'Test Suite Name', isSortable: true },
    { key: 'browser', content: 'Browser', isSortable: true },
    { key: 'duration', content: 'Duration', isSortable: true },
    { key: 'status', content: 'Run Status', isSortable: true },
  ],
};

const buildRows = (testRuns) =>
  testRuns.map((run, index) => {
    const key = String(run?.id ?? `${run?.suite_name ?? 'run'}-${index}`);
    const status = run?.status ?? 'unknown';
    return {
      key,
      cells: [
        {
          key: `suite-${key}`,
          content: <Text>{run?.suite_name ?? 'Unnamed suite'}</Text>,
        },
        {
          key: `browser-${key}`,
          content: <Text>{run?.browser ?? '—'}</Text>,
        },
        {
          key: `duration-${key}`,
          content: <Text>{formatDuration(run?.duration_ms ?? run?.duration)}</Text>,
        },
        {
          key: `status-${key}`,
          content: (
            <Lozenge appearance={getStatusAppearance(status)}>
              {String(status).toUpperCase()}
            </Lozenge>
          ),
        },
      ],
    };
  });

const AiSummary = ({ run, index }) => {
  const report =
    typeof run?.ai_summary_report === 'string' ? run.ai_summary_report.trim() : '';
  const title = `${run?.suite_name ?? `Run ${index + 1}`}${
    run?.browser ? ` (${run.browser})` : ''
  }`;

  return (
    <Expand title={`Automated Run Summary: ${title}`}>
      {report ? (
        <Text>{report}</Text>
      ) : (
        <Text>No automated run summary is available for this run.</Text>
      )}
    </Expand>
  );
};

const App = () => {
  const [testRuns, setTestRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const isMounted = useRef(false);

  const fetchTestResults = useCallback(async (
    initialLoad = false,
    isActive = () => isMounted.current
  ) => {
    if (initialLoad) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    try {
      const response = await invoke('getTestResults');

      if (!isActive()) return;

      if (!Array.isArray(response) && response?.success === false) {
        throw new Error(
          response.error || 'Unable to load test results.'
        );
      }

      const runs = Array.isArray(response)
        ? response
        : Array.isArray(response?.runs)
        ? response.runs
        : Array.isArray(response?.testRuns)
        ? response.testRuns
        : [];

      setTestRuns(runs);
    } catch (err) {
      if (!isActive()) return;

      setError(
        err?.message || 'Failed to load test results. Please try again later.'
      );
    } finally {
      if (isActive()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    isMounted.current = true;

    fetchTestResults(true, () => active);

    return () => {
      active = false;
      isMounted.current = false;
    };
  }, [fetchTestResults]);

  if (loading) {
    return (
      <Inline space="space.100" alignBlock="center">
        <Spinner size="medium" label="Loading test results" />
        <Text>Loading test results...</Text>
      </Inline>
    );
  }

  return (
    <Stack space="space.200">
      <Heading size="medium">ContextIQ Test Runs</Heading>
      <Inline space="space.100" alignBlock="center">
        <Button
          appearance="subtle"
          text={refreshing ? 'Refreshing...' : 'Refresh Results'}
          disabled={refreshing}
          onClick={() => fetchTestResults(false)}
        />
        {refreshing && <Spinner size="small" label="Refreshing test results" />}
      </Inline>
      {error && (
        <SectionMessage title="Unable to load test results" appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      )}
      {testRuns.length === 0 ? (
        <SectionMessage title="No test runs found" appearance="information">
          <Text>
            No Playwright execution results are linked to this issue yet.
          </Text>
        </SectionMessage>
      ) : (
        <>
          <DynamicTable
            head={head}
            rows={buildRows(testRuns)}
            rowsPerPage={10}
            defaultSortKey="suiteName"
            defaultSortOrder="ASC"
            emptyView="No test runs available."
          />
          <Heading size="small">Automated Run Summaries</Heading>
          <Box>
            <Stack space="space.100">
              {testRuns.map((run, index) => (
                <AiSummary
                  key={String(run?.id ?? `${run?.suite_name ?? 'run'}-${index}`)}
                  run={run}
                  index={index}
                />
              ))}
            </Stack>
          </Box>
        </>
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
