import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createReadClient, CompatibilityError, ReadClientError, parseErrorEnvelope } from '../dist/client.js';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const wallet = fixture('alert-history').walletAddress;
const clientFor = (body, status = 200, seen = {}) => createReadClient({
  baseUrl: 'https://example.test',
  retries: 0,
  fetch: async (url, init) => {
    seen.path = url.pathname;
    seen.query = url.searchParams;
    seen.init = init;
    return Response.json(body, { status });
  },
});

test('alert history: runtime contract, exact identity and GET transport', async () => {
  const expected = fixture('alert-history');
  const seen = {};
  const client = clientFor(expected, 200, seen);
  assert.deepEqual(
    await client.alerts.history({ walletAddress: wallet, status: 'triggered', limit: 200 }),
    expected,
  );
  assert.equal(seen.path, '/api/alerts/alerts');
  assert.equal(seen.query.get('walletAddress'), wallet);
  assert.equal(seen.query.get('status'), 'triggered');
  assert.equal(seen.query.get('limit'), '200');
  assert.equal(seen.init.method, 'GET');
});

test('alert history: missing evidence and unknown enum values fail gracefully', async () => {
  const missing = fixture('alert-history');
  delete missing.alerts[0].evidenceData;
  await assert.rejects(clientFor(missing).alerts.history(), (error) =>
    error instanceof CompatibilityError && error.message.includes('evidenceData'));

  const unknown = fixture('alert-history');
  unknown.alerts[0].status = 'archived';
  await assert.rejects(clientFor(unknown).alerts.history(), CompatibilityError);
  await assert.rejects(clientFor({ alerts: [] }).alerts.history(), CompatibilityError);
});

test('deliveries: runtime contract and typed channels', async () => {
  const expected = fixture('deliveries');
  const seen = {};
  assert.deepEqual(await clientFor(expected, 200, seen).alerts.deliveries({ alertId: 'alert_1' }), expected);
  assert.equal(seen.path, '/api/alerts/deliveries');
  assert.equal(seen.query.get('alertId'), 'alert_1');

  const broken = structuredClone(expected);
  broken[0].channel = 'carrier_pigeon';
  await assert.rejects(clientFor(broken).alerts.deliveries(), CompatibilityError);
});

test('agent run detail: nullable snapshots and source signal validation', async () => {
  const expected = fixture('agent-run');
  const seen = {};
  assert.deepEqual(await clientFor(expected, 200, seen).history.agentRun('run_1'), expected);
  assert.equal(seen.path, '/api/history/agent-runs/run_1');

  const nullable = { ...expected, sourceSnapshots: null, decisionDetail: null };
  assert.deepEqual(await clientFor(nullable).history.agentRun('run_1'), nullable);

  const broken = structuredClone(expected);
  delete broken.sourceSnapshots[0].agent;
  await assert.rejects(clientFor(broken).history.agentRun('run_1'), (error) =>
    error instanceof CompatibilityError && error.message.includes('agent'));
  await assert.rejects(async () => clientFor(expected).history.agentRun('../run_1'), ReadClientError);
});

test('watchlist: richer entries validate and additive fields survive', async () => {
  const payload = {
    entries: [{
      ...fixture('watchlist').entries[0],
      lastScannedAt: '2026-09-12T00:00:00.000Z',
      latestClassification: 'risky',
      latestScore: 82,
      latestStatus: 'stale',
      futureField: { additive: true },
    }],
  };
  const result = await clientFor(payload).watchlist.list({ walletAddress: wallet });
  assert.deepEqual(result, payload);

  const unknownSource = structuredClone(payload);
  unknownSource.entries[0].source = 'mailing_list';
  await assert.rejects(clientFor(unknownSource).watchlist.list(), CompatibilityError);
});

test('structured API error envelopes expose code, retryable and recoveryAction', async () => {
  const retryable = createReadClient({
    baseUrl: 'https://example.test',
    retries: 0,
    fetch: async () => Response.json({
      error: {
        code: 'provider_timeout',
        message: 'The provider did not answer in time.',
        retryable: true,
        recoveryAction: 'retry_after_delay',
        requestId: 'req_1',
      },
    }, { status: 503, headers: { 'Retry-After': '0' } }),
  });
  await assert.rejects(retryable.health.get(), (error) =>
    error instanceof ReadClientError
    && error.code === 'provider_timeout'
    && error.message === 'The provider did not answer in time.'
    && error.retryable === true
    && error.recoveryAction === 'retry_after_delay'
    && error.requestId === 'req_1');

  const denied = createReadClient({
    baseUrl: 'https://example.test',
    retries: 0,
    fetch: async () => Response.json({ code: 'auth_error', message: 'Connect a wallet.' }, { status: 401 }),
  });
  await assert.rejects(denied.health.get(), (error) =>
    error instanceof ReadClientError
    && error.code === 'auth_error'
    && error.message === 'Connect a wallet.'
    && error.retryable === false
    && error.recoveryAction === 'reconnect');

  const broken = clientFor({ unexpected: true });
  await assert.rejects(broken.health.get(), (error) =>
    error instanceof CompatibilityError && error.recoveryAction === 'refresh_data');
});

test('parseErrorEnvelope keeps only bounded, machine-readable fields', () => {
  const parsed = parseErrorEnvelope({
    error: {
      code: 'rate_limited',
      message: 'x'.repeat(400),
      retryable: true,
      recoveryAction: 'unsupported_action',
      requestId: 'req_2',
      secrets: 'ignored',
    },
    unrelated: 'ignored',
  });
  assert.deepEqual(parsed, {
    code: 'rate_limited',
    message: 'x'.repeat(200),
    retryable: true,
    recoveryAction: undefined,
    requestId: 'req_2',
  });
  assert.deepEqual(parseErrorEnvelope('not an object'), {});
});
