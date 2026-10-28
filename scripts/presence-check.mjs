import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.TEST_URL ?? 'http://localhost:8787';
const first = randomUUID(),
  second = randomUUID();
const tab1 = randomUUID(),
  tab2 = randomUUID(),
  tab3 = randomUUID();
async function presence(visitor, session, action = 'join') {
  const response = await fetch(`${base}/api/presence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitor, session, action }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return (await response.json()).count;
}
try {
  const initial = await presence(first, tab1);
  assert.ok(initial >= 1);
  assert.equal(await presence(first, tab1), initial, 'heartbeat does not inflate count');
  assert.equal(await presence(first, tab2), initial, 'same browser counted once');
  assert.equal(await presence(second, tab3), initial + 1, 'second browser counted');
  assert.equal(
    await presence(first, tab1, 'leave'),
    initial + 1,
    'other tab keeps browser present',
  );
  assert.equal(await presence(first, tab2, 'leave'), initial, 'last tab removes browser');
  assert.equal(await presence(second, tab3, 'leave'), initial - 1);
  const invalid = await fetch(`${base}/api/presence`, {
    method: 'POST',
    body: '{"visitor":"bad"}',
  });
  assert.equal(invalid.status, 400);
  const crossOrigin = await fetch(`${base}/api/presence`, {
    method: 'POST',
    headers: { Origin: 'https://other.example' },
  });
  assert.equal(crossOrigin.status, 403);
  console.log(
    'Presence: browser deduplication, heartbeat, leave, validation and origin checks passed.',
  );
} finally {
  await presence(first, tab1, 'leave');
  await presence(first, tab2, 'leave');
  await presence(second, tab3, 'leave');
}
