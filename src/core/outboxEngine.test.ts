import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compressTextPayload,
  computeBackoffMs,
  createOutgoingMessageAndOutbox,
  formatBytes,
  markOutboxDelivered,
  markOutboxInFlight,
  markOutboxRetry,
  resetAllOutboxBackoff,
  selectReadyOutboxBatch,
  shouldAutoLoadAttachment,
} from './outboxEngine';

test('compressTextPayload trims and collapses redundant blank lines and trailing spaces', () => {
  const input = '  Hello   \r\n\r\n\r\n\r\nWorld   \t\n  ';
  assert.equal(compressTextPayload(input), 'Hello\n\nWorld');
});

test('computeBackoffMs grows exponentially and caps at maxMs', () => {
  assert.equal(computeBackoffMs(0, 1500, 60000), 1500);
  assert.equal(computeBackoffMs(1, 1500, 60000), 3000);
  assert.equal(computeBackoffMs(2, 1500, 60000), 6000);
  assert.equal(computeBackoffMs(6, 1500, 60000), 60000);
});

test('outbox preserves strict per-room FIFO order even during retries and head-of-line blocking', () => {
  const t0 = 10000;
  const m1 = createOutgoingMessageAndOutbox({
    id: 'm1',
    roomId: 'roomA',
    senderId: 'u1',
    senderName: 'Alex',
    roomParticipantIds: ['u1', 'u2'],
    rawText: 'First',
    nowMs: t0,
    seq: 1,
  });
  const m2 = createOutgoingMessageAndOutbox({
    id: 'm2',
    roomId: 'roomA',
    senderId: 'u1',
    senderName: 'Alex',
    roomParticipantIds: ['u1', 'u2'],
    rawText: 'Second',
    nowMs: t0 + 10,
    seq: 2,
  });
  const m3 = createOutgoingMessageAndOutbox({
    id: 'm3',
    roomId: 'roomB',
    senderId: 'u1',
    senderName: 'Alex',
    roomParticipantIds: ['u1', 'u3'],
    rawText: 'Other room',
    nowMs: t0 + 20,
    seq: 3,
  });

  let queue = [m2.outboxEntry, m3.outboxEntry, m1.outboxEntry];

  // Offline yields zero ready messages
  assert.equal(selectReadyOutboxBatch(queue, t0 + 50, 'offline', 5).length, 0);

  // Online selects m1 (head of roomA) and m3 (head of roomB), NOT m2 behind m1
  const batch1 = selectReadyOutboxBatch(queue, t0 + 50, 'online', 5);
  assert.deepEqual(
    batch1.map((b) => b.messageId),
    ['m1', 'm3']
  );

  // If m1 fails and enters backoff, m2 in roomA MUST remain blocked behind m1
  queue = markOutboxInFlight(queue, 'm1');
  queue = markOutboxRetry(queue, 'm1', t0 + 100, 'timeout', 1500, 60000);
  const batchDuringBackoff = selectReadyOutboxBatch(queue, t0 + 500, 'online', 5);
  assert.deepEqual(
    batchDuringBackoff.map((b) => b.messageId),
    ['m3']
  );

  // Manual Retry Queue Now resets backoff so m1 becomes ready immediately
  queue = resetAllOutboxBackoff(queue, t0 + 600);
  const batchManualRetry = selectReadyOutboxBatch(queue, t0 + 600, 'online', 5);
  assert.equal(batchManualRetry[0].messageId, 'm1');

  // Once m1 is delivered and removed, m2 becomes ready
  queue = markOutboxDelivered(queue, 'm1');
  const batchAfterM1 = selectReadyOutboxBatch(queue, t0 + 700, 'online', 5);
  assert.equal(batchAfterM1[0].messageId, 'm2');
});

test('shouldAutoLoadAttachment blocks auto-loading when Low-Data mode is active', () => {
  assert.equal(shouldAutoLoadAttachment(4096, true, 'online', false), false);
  assert.equal(shouldAutoLoadAttachment(4096, false, 'weak', false), false);
  assert.equal(shouldAutoLoadAttachment(4096, false, 'online', true), false);
  assert.equal(shouldAutoLoadAttachment(4096, false, 'online', false), true);
  assert.equal(shouldAutoLoadAttachment(65000, false, 'online', false), false);
});

test('formatBytes formats B, KB, and MB cleanly', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(14800), '14.5 KB');
  assert.equal(formatBytes(1572864), '1.50 MB');
});
