export type MessageDeliveryStatus =
  | 'queued_offline'
  | 'sending'
  | 'sent'
  | 'delivered';

export type NetworkQuality = 'online' | 'weak' | 'offline';

export type AttachmentKind = 'none' | 'audio' | 'image';

export type MediaTransferState =
  | 'deferred'
  | 'wifi_only'
  | 'loading'
  | 'loaded'
  | 'cancelled'
  | 'error';

export type RoomType = 'direct' | 'group';

/**
 * Validation limits synchronized with firebase-blueprint.json
 * and mirrored in Android / Windows clients.
 */
export const SCHEMA_LIMITS = {
  MAX_ID_LENGTH: 128,
  ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  HANDLE_PATTERN: /^[a-z0-9_]+$/,
  MAX_DISPLAY_NAME: 60,
  MAX_HANDLE_LENGTH: 32,
  MIN_HANDLE_LENGTH: 2,
  MAX_ROOM_NAME: 80,
  MAX_PARTICIPANTS: 20,
  MAX_TEXT_LENGTH: 2000,
  MAX_PREVIEW_LENGTH: 160,
  MAX_ATTACHMENT_NAME: 120,
  MAX_ATTACHMENT_BYTES: 120000,
} as const;

export interface UserProfile {
  uid: string;
  displayName: string;
  handle: string;
  statusText?: string;
  email?: string;
  lowDataDefault: boolean;
  authMode: 'local' | 'google';
  updatedAt: number;
}

export interface ChatRoom {
  id: string;
  name: string;
  type: RoomType;
  createdBy: string;
  participantIds: string[];
  participantLabels?: Record<string, string>;
  lastMessagePreview: string;
  lastMessageAt: number;
  lastReadAt: number;
  unreadCount: number;
  isSeed?: boolean;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  roomParticipantIds: string[];
  text: string;
  clientCreatedAt: number;
  seq: number;
  status: MessageDeliveryStatus;
  attachmentKind: AttachmentKind;
  attachmentName?: string;
  attachmentBytes?: number;
  attachmentDataUrl?: string;
  mediaState?: MediaTransferState;
  errorReason?: string;
  syncSource: 'local' | 'cloud';
}

export interface OutboxEntry {
  messageId: string;
  roomId: string;
  seq: number;
  enqueuedAt: number;
  attemptCount: number;
  nextAttemptAt: number;
  inFlight: boolean;
  lastError?: string;
  payloadBytes: number;
}

export interface BandwidthConfig {
  lowDataMode: boolean;
  simulatedCondition: 'auto' | 'online' | 'weak' | 'offline';
  deferMediaToWifi: boolean;
}

export interface SyncHealthSnapshot {
  networkQuality: NetworkQuality;
  isSyncing: boolean;
  queuedCount: number;
  sendingCount: number;
  lastSyncedAt: number | null;
  bytesSavedEstimate: number;
  lastTransitionNote: string;
}

export interface SearchHit {
  messageId: string;
  roomId: string;
  roomName: string;
  senderName: string;
  text: string;
  clientCreatedAt: number;
  status: MessageDeliveryStatus;
}
