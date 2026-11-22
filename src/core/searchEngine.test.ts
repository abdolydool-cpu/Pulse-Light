import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeedWorkspace,
  computeUnreadCount,
  searchCachedMessages,
  sortMessagesFifo,
  sortRoomsByRecency,
  validateMessagePayload,
  validateRoomName,
  validateSafeId,
} from './searchEngine';

test('searchCachedMessages finds matches across text, senderName, and attachmentName', () => {
  const seed = buildSeedWorkspace('u_local', 'Operator');
  const textHits = searchCachedMessages(seed.messagesByRoom, seed.rooms, 'ridge checkpoint');
  assert.equal(textHits.length, 1);
  assert.equal(textHits[0].roomId, 'room_field_ops');

  const attachmentHits = searchCachedMessages(seed.messagesByRoom, seed.rooms, 'sector_4_thumb');
  assert.equal(attachmentHits.length, 1);
  assert.equal(attachmentHits[0].messageId, 'msg_seed_2');

  assert.equal(searchCachedMessages(seed.messagesByRoom, seed.rooms, '   ').length, 0);
});

test('computeUnreadCount ignores own messages and counts newer remote messages', () => {
  const seed = buildSeedWorkspace('u_local', 'Operator');
  const msgs = seed.messagesByRoom['room_field_ops'];
  const count = computeUnreadCount(msgs, 1795340060000, 'u_local');
  assert.equal(count, 2);
});

test('sortRoomsByRecency and sortMessagesFifo return deterministic ordering', () => {
  const seed = buildSeedWorkspace('u_local', 'Operator');
  const sortedRooms = sortRoomsByRecency(seed.rooms);
  assert.equal(sortedRooms[0].id, 'room_field_ops');
  assert.equal(sortedRooms[1].id, 'room_amara_direct');
  assert.equal(sortedRooms[2].id, 'room_clinic_dispatch');

  const reversed = [...seed.messagesByRoom['room_field_ops']].reverse();
  const sortedMsgs = sortMessagesFifo(reversed);
  assert.deepEqual(
    sortedMsgs.map((m) => m.id),
    ['msg_seed_1', 'msg_seed_2', 'msg_seed_3']
  );
});

test('blueprint-aligned validation guards IDs, room names, and message payload bounds', () => {
  assert.equal(validateSafeId('room_field_ops-1'), true);
  assert.equal(validateSafeId('../bad/id'), false);
  assert.equal(validateRoomName('').valid, false);
  assert.equal(validateRoomName('Relief Ops').valid, true);
  assert.equal(validateMessagePayload('').valid, false);
  assert.equal(validateMessagePayload('Ping').valid, true);
  assert.equal(validateMessagePayload('x'.repeat(2001)).valid, false);
  assert.equal(validateMessagePayload('photo', 130000).valid, false);
});
