import test from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/test-env.js';
import { JsonStore } from '../../backend/src/db/json-store.js';

test('json store document CRUD round trip', async () => {
  const store = new JsonStore();
  await store.doc.set('users/u1/bots/b1', { displayName: 'Demo', environment: 'development' });
  const doc = await store.doc.get('users/u1/bots/b1');
  assert.equal(doc.displayName, 'Demo');
  assert.equal(doc.id, 'b1');

  await store.doc.update('users/u1/bots/b1', { displayName: 'Renamed' });
  assert.equal((await store.doc.get('users/u1/bots/b1')).displayName, 'Renamed');
  assert.equal(await store.doc.update('users/u1/bots/missing', { a: 1 }), false);

  assert.equal(await store.doc.delete('users/u1/bots/b1'), true);
  assert.equal(await store.doc.get('users/u1/bots/b1'), null);
});

test('json store create() is atomic (webhook deduplication)', async () => {
  const store = new JsonStore();
  assert.equal(await store.doc.create('webhookReceipts/bot1_99', { seen: true }), true);
  assert.equal(await store.doc.create('webhookReceipts/bot1_99', { seen: true }), false);
});

test('json store queries only direct children with filters and ordering', async () => {
  const store = new JsonStore();
  await store.doc.set('users/u1/bots/b1', { status: 'connected', createdAt: '2026-01-01T00:00:00.000Z' });
  await store.doc.set('users/u1/bots/b2', { status: 'revoked', createdAt: '2026-02-01T00:00:00.000Z' });
  await store.doc.set('users/u1/bots/b1/workflows/w1', { status: 'connected' });

  const all = await store.query('users/u1/bots');
  assert.equal(all.length, 2);

  const connected = await store.query('users/u1/bots', {
    where: [{ field: 'status', op: '==', value: 'connected' }],
  });
  assert.equal(connected.length, 1);
  assert.equal(connected[0].id, 'b1');

  const sorted = await store.query('users/u1/bots', { orderBy: { field: 'createdAt', direction: 'desc' } });
  assert.deepEqual(sorted.map((d) => d.id), ['b2', 'b1']);

  const page = await store.query('users/u1/bots', {
    orderBy: { field: 'createdAt', direction: 'asc' },
    limit: 1,
    offset: 1,
  });
  assert.equal(page[0].id, 'b2');
});

test('json store rejects traversal paths and deletes trees', async () => {
  const store = new JsonStore();
  await assert.rejects(() => store.doc.get('users/u1/../u2'), /Invalid store path/);
  await store.doc.set('users/u1/bots/b1', { id: 'b1' });
  await store.doc.set('users/u1/bots/b1/commands/c1', { id: 'c1' });
  const removed = await store.deleteTree('users/u1/bots/b1');
  assert.equal(removed, 2);
  assert.equal(await store.doc.get('users/u1/bots/b1/commands/c1'), null);
});
