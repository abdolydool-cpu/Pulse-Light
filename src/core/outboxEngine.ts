import {
  AttachmentKind,
  ChatMessage,
  NetworkQuality,
  OutboxEntry,
  SCHEMA_LIMITS,
} from './types';

export const STATUS_LABELS: Record<ChatMessage['status'], string> = {
  queued_offline: 'Queued (Offline)',
  sending: 'Sending...',
  sent: 'Sent',
  delivered: 'Delivered',
};

/**
 * Normalize whitespace and line endings to minimize UTF-8 wire bytes
 * on low-bandwidth links while preserving user intent.
 */
export function compressTextPayload(rawText: string): string {
  return rawText
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, SCHEMA_LIMITS.MAX_TEXT_LENGTH);
}

/**
 * Estimate compact JSON wire payload size in bytes.
 */
export function estimatePayloadBytes(message: Pick<ChatMessage, 'text' | 'attachmentDataUrl' | 'senderName'>): number {
  const baseOverhead = 140;
  const textBytes = new TextEncoder().encode(message.text).length;
  const senderBytes = new TextEncoder().encode(message.senderName).length;
  const attachmentBytes = message.attachmentDataUrl
    ? new TextEncoder().encode(message.attachmentDataUrl).length
    : 0;
  return baseOverhead + textBytes + senderBytes + attachmentBytes;
}

/**
 * Deterministic exponential backoff with configurable cap (default 1.5s -> 60s).
 */
export function computeBackoffMs(
  attemptCount: number,
  baseMs = 1500,
  maxMs = 60000,
  jitterMs = 0
): number {
  const safeAttempt = Math.max(0, Math.floor(attemptCount));
  const exp = Math.min(maxMs, baseMs * Math.pow(2, safeAttempt));
  return Math.min(maxMs, exp + Math.max(0, jitterMs));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export interface CreateOutgoingParams {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  roomParticipantIds: string[];
  rawText: string;
  nowMs: number;
  seq: number;
  attachmentKind?: AttachmentKind;
  attachmentName?: string;
  attachmentBytes?: number;
  attachmentDataUrl?: string;
}

export function createOutgoingMessageAndOutbox(params: CreateOutgoingParams): {
  message: ChatMessage;
  outboxEntry: OutboxEntry;
} {
  const compressedText = compressTextPayload(params.rawText);
  const attachmentKind: AttachmentKind = params.attachmentKind ?? 'none';

  const message: ChatMessage = {
    id: params.id,
    roomId: params.roomId,
    senderId: params.senderId,
    senderName: params.senderName.slice(0, SCHEMA_LIMITS.MAX_DISPLAY_NAME),
    roomParticipantIds: params.roomParticipantIds.slice(0, SCHEMA_LIMITS.MAX_PARTICIPANTS),
    text: compressedText,
    clientCreatedAt: params.nowMs,
    seq: params.seq,
    status: 'queued_offline',
    attachmentKind,
    attachmentName: params.attachmentName?.slice(0, SCHEMA_LIMITS.MAX_ATTACHMENT_NAME),
    attachmentBytes: params.attachmentBytes,
    attachmentDataUrl: params.attachmentDataUrl,
    mediaState: attachmentKind === 'none' ? undefined : 'loaded',
    syncSource: 'local',
  };

  const payloadBytes = estimatePayloadBytes(message);

  const outboxEntry: OutboxEntry = {
    messageId: message.id,
    roomId: message.roomId,
    seq: message.seq,
    enqueuedAt: params.nowMs,
    attemptCount: 0,
    nextAttemptAt: params.nowMs,
    inFlight: false,
    payloadBytes,
  };

  return { message, outboxEntry };
}

/**
 * Selects the next outbox items ready to send while strictly preserving
 * FIFO ordering per room (head-of-line blocking prevents out-of-order delivery).
 */
export function selectReadyOutboxBatch(
  queue: OutboxEntry[],
  nowMs: number,
  networkQuality: NetworkQuality,
  maxBatchSize = 1
): OutboxEntry[] {
  if (networkQuality === 'offline' || queue.length === 0) {
    return [];
  }

  const sorted = [...queue].sort((a, b) => {
    if (a.enqueuedAt !== b.enqueuedAt) return a.enqueuedAt - b.enqueuedAt;
    return a.seq - b.seq;
  });

  // Track rooms whose head-of-line message is blocked (either inFlight or in backoff)
  const blockedRooms = new Set<string>();
  const ready: OutboxEntry[] = [];

  for (const entry of sorted) {
    if (blockedRooms.has(entry.roomId)) {
      continue;
    }

    if (entry.inFlight || entry.nextAttemptAt > nowMs) {
      // Head of this room's queue is not ready; block subsequent messages in same room
      blockedRooms.add(entry.roomId);
      continue;
    }

    ready.push(entry);
    // Strict single-message-at-a-time per room guarantees ordered arrival on flaky links
    blockedRooms.add(entry.roomId);

    if (ready.length >= maxBatchSize) {
      break;
    }
  }

  return ready;
}

export function markOutboxInFlight(queue: OutboxEntry[], messageId: string): OutboxEntry[] {
  return queue.map((item) =>
    item.messageId === messageId ? { ...item, inFlight: true } : item
  );
}

export function markOutboxDelivered(queue: OutboxEntry[], messageId: string): OutboxEntry[] {
  return queue.filter((item) => item.messageId !== messageId);
}

export function markOutboxRetry(
  queue: OutboxEntry[],
  messageId: string,
  nowMs: number,
  errorReason: string,
  baseMs = 1500,
  maxMs = 60000
): OutboxEntry[] {
  return queue.map((item) => {
    if (item.messageId !== messageId) return item;
    const nextAttemptCount = item.attemptCount + 1;
    const delay = computeBackoffMs(nextAttemptCount - 1, baseMs, maxMs);
    return {
      ...item,
      inFlight: false,
      attemptCount: nextAttemptCount,
      nextAttemptAt: nowMs + delay,
      lastError: errorReason,
    };
  });
}

export function resetAllOutboxBackoff(queue: OutboxEntry[], nowMs: number): OutboxEntry[] {
  return queue.map((item) => ({
    ...item,
    inFlight: false,
    nextAttemptAt: nowMs,
  }));
}

/**
 * Determines whether media should auto-load or stay deferred behind an explicit size preview.
 */
export function shouldAutoLoadAttachment(
  attachmentBytes: number,
  lowDataMode: boolean,
  networkQuality: NetworkQuality,
  deferMediaToWifi: boolean
): boolean {
  if (lowDataMode) return false;
  if (networkQuality !== 'online') return false;
  if (deferMediaToWifi) return false;
  return attachmentBytes <= 32768;
}
