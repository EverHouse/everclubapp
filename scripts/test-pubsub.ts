import { LocalPubSubAdapter, PgPubSubAdapter, getInstanceId } from '../server/core/pubsub';
import type { PubSubMessage, BroadcastTarget } from '../server/core/pubsub';

function makeMessage(target: BroadcastTarget, payload: string, overrideInstanceId?: string): PubSubMessage {
  return {
    instanceId: overrideInstanceId ?? getInstanceId(),
    target,
    payload,
  };
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

console.log('--- LocalPubSubAdapter ---');

const localAdapter = new LocalPubSubAdapter();
const localHandler = { called: false };
localAdapter.onRemoteMessage(() => { localHandler.called = true; });
localAdapter.publishToRemote(makeMessage({ type: 'all' }, '{"type":"test"}'));
assert(!localHandler.called, 'publishToRemote is a no-op (handler not invoked)');

console.log('\n--- PgPubSubAdapter (unit, mocked pool) ---');

{
  const queries: { text: string; params: unknown[] }[] = [];
  const mockPool = {
    query: (text: string, params: unknown[]) => {
      queries.push({ text, params });
      return Promise.resolve({});
    },
    connect: () => Promise.reject(new Error('mock: no real PG')),
  } as any;

  const adapter = new PgPubSubAdapter(mockPool);
  const msg = makeMessage({ type: 'staff' }, '{"type":"booking_event"}');
  adapter.publishToRemote(msg);

  await new Promise(r => setTimeout(r, 100));

  assert(queries.length === 1, 'publishToRemote sends one NOTIFY query');
  assert(queries[0]?.text === 'SELECT pg_notify($1, $2)', 'Uses pg_notify($1, $2)');
  assert(queries[0]?.params[0] === 'ws_broadcast', 'Channel is ws_broadcast');

  await adapter.shutdown();
}

{
  const mockPool = {
    query: () => Promise.resolve({}),
    connect: () => Promise.reject(new Error('mock: no real PG')),
  } as any;

  const adapter = new PgPubSubAdapter(mockPool);
  const hugePayload = 'x'.repeat(8000);
  let queryCalled = false;
  (mockPool as any).query = () => { queryCalled = true; return Promise.resolve({}); };
  adapter.publishToRemote(makeMessage({ type: 'all' }, hugePayload));
  assert(!queryCalled, 'Skips oversized payloads for NOTIFY');

  await adapter.shutdown();
}

{
  let notificationHandler: any = null;
  const mockClient = {
    on: (event: string, handler: any) => {
      if (event === 'notification') notificationHandler = handler;
    },
    query: () => Promise.resolve({}),
    release: () => {},
  };
  const mockPool = {
    connect: () => Promise.resolve(mockClient),
    query: () => Promise.resolve({}),
  } as any;

  const adapter = new PgPubSubAdapter(mockPool);
  const received: PubSubMessage[] = [];
  adapter.onRemoteMessage((msg) => received.push(msg));

  await adapter.connect();

  const remoteMsg: PubSubMessage = {
    instanceId: 'remote-instance-id',
    target: { type: 'all' },
    payload: '{"type":"test_event"}',
  };
  notificationHandler({ channel: 'ws_broadcast', payload: JSON.stringify(remoteMsg) });

  assert(received.length === 1, 'Handler receives remote instance messages');
  assert(received[0]?.instanceId === 'remote-instance-id', 'Message has correct instanceId');

  const selfMsg: PubSubMessage = {
    instanceId: getInstanceId(),
    target: { type: 'all' },
    payload: '{"type":"self_event"}',
  };
  notificationHandler({ channel: 'ws_broadcast', payload: JSON.stringify(selfMsg) });
  assert(received.length === 1, 'Self-instance messages are filtered out');

  await adapter.shutdown();
}

{
  let unlistenCalled = false;
  let releaseCalled = false;
  const mockClient = {
    on: () => {},
    query: (text: string) => {
      if (text === 'UNLISTEN ws_broadcast') unlistenCalled = true;
      return Promise.resolve({});
    },
    release: () => { releaseCalled = true; },
  };
  const mockPool = {
    connect: () => Promise.resolve(mockClient),
    query: () => Promise.resolve({}),
  } as any;

  const adapter = new PgPubSubAdapter(mockPool);
  await adapter.connect();
  await adapter.shutdown();

  assert(unlistenCalled, 'Shutdown sends UNLISTEN');
  assert(releaseCalled, 'Shutdown releases client');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
