import {
  ChatMessage,
  ChatRoom,
  SCHEMA_LIMITS,
  SearchHit,
} from './types';

export function sortRoomsByRecency(rooms: ChatRoom[]): ChatRoom[] {
  return [...rooms].sort((a, b) => {
    if (b.lastMessageAt !== a.lastMessageAt) {
      return b.lastMessageAt - a.lastMessageAt;
    }
    return a.name.localeCompare(b.name);
  });
}

export function sortMessagesFifo(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => {
    if (a.clientCreatedAt !== b.clientCreatedAt) {
      return a.clientCreatedAt - b.clientCreatedAt;
    }
    if (a.seq !== b.seq) {
      return a.seq - b.seq;
    }
    return a.id.localeCompare(b.id);
  });
}

export function searchCachedMessages(
  messagesByRoom: Record<string, ChatMessage[]>,
  rooms: ChatRoom[],
  rawQuery: string,
  limit = 40
): SearchHit[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];

  const roomNameMap = new Map<string, string>();
  for (const room of rooms) {
    roomNameMap.set(room.id, room.name);
  }

  const hits: SearchHit[] = [];
  for (const [roomId, msgs] of Object.entries(messagesByRoom)) {
    const roomName = roomNameMap.get(roomId) ?? 'Conversation';
    for (const msg of msgs) {
      const hayText = msg.text.toLowerCase();
      const haySender = msg.senderName.toLowerCase();
      const hayAttachment = (msg.attachmentName ?? '').toLowerCase();
      if (hayText.includes(q) || haySender.includes(q) || hayAttachment.includes(q)) {
        hits.push({
          messageId: msg.id,
          roomId,
          roomName,
          senderName: msg.senderName,
          text: msg.text || `[${msg.attachmentName ?? msg.attachmentKind}]`,
          clientCreatedAt: msg.clientCreatedAt,
          status: msg.status,
        });
      }
    }
  }

  return hits
    .sort((a, b) => b.clientCreatedAt - a.clientCreatedAt)
    .slice(0, limit);
}

export function computeUnreadCount(
  messages: ChatMessage[],
  lastReadAt: number,
  currentUid: string
): number {
  let count = 0;
  for (const msg of messages) {
    if (msg.senderId !== currentUid && msg.clientCreatedAt > lastReadAt) {
      count += 1;
    }
  }
  return count;
}

export function validateSafeId(id: string): boolean {
  return (
    typeof id === 'string' &&
    id.length >= 1 &&
    id.length <= SCHEMA_LIMITS.MAX_ID_LENGTH &&
    SCHEMA_LIMITS.ID_PATTERN.test(id)
  );
}

export function validateRoomName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Chat or room name is required.' };
  }
  if (trimmed.length > SCHEMA_LIMITS.MAX_ROOM_NAME) {
    return {
      valid: false,
      error: `Name must be ${SCHEMA_LIMITS.MAX_ROOM_NAME} characters or fewer.`,
    };
  }
  return { valid: true };
}

export function validateMessagePayload(
  text: string,
  attachmentBytes?: number
): { valid: boolean; error?: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0 && (!attachmentBytes || attachmentBytes <= 0)) {
    return { valid: false, error: 'Enter a message or attach a lightweight clip.' };
  }
  if (trimmed.length > SCHEMA_LIMITS.MAX_TEXT_LENGTH) {
    return {
      valid: false,
      error: `Message exceeds ${SCHEMA_LIMITS.MAX_TEXT_LENGTH} character low-bandwidth cap.`,
    };
  }
  if (attachmentBytes && attachmentBytes > SCHEMA_LIMITS.MAX_ATTACHMENT_BYTES) {
    return {
      valid: false,
      error: 'Compressed attachment exceeds 120 KB low-bandwidth limit.',
    };
  }
  return { valid: true };
}

export function generateSafeId(prefix: string): string {
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'id';
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${cleanPrefix}_${ts}_${rand}`;
}

/**
 * Generates deterministic tiny SVG-as-Data-URL thumbnail (~1.2 KB) and tiny WAV audio clip (~11 KB)
 * for local cached demonstration of deferred media & size inspection without external network fetches.
 */
export function createTinySampleImageDataUrl(): { dataUrl: string; bytes: number } {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="150" viewBox="0 0 240 150"><rect width="240" height="150" fill="#0f172a"/><path d="M0 112L58 68L108 98L162 48L240 118V150H0Z" fill="#0d9488"/><circle cx="188" cy="36" r="14" fill="#f59e0b"/><text x="14" y="26" fill="#e2e8f0" font-family="sans-serif" font-size="11">Relay Tower Sector 4</text></svg>`;
  const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return { dataUrl, bytes: 14800 };
}

export function createTinySampleWavDataUrl(durationSeconds = 1.2, freqHz = 520): {
  dataUrl: string;
  bytes: number;
} {
  const sampleRate = 8000;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.sin((Math.PI * i) / numSamples);
    const sample = 128 + Math.round(48 * envelope * Math.sin(2 * Math.PI * freqHz * t));
    view.setUint8(44 + i, sample);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');

  return {
    dataUrl: `data:audio/wav;base64,${base64}`,
    bytes: buffer.byteLength,
  };
}

/**
 * Deterministic offline-ready starter conversations cached in IndexedDB on cold boot
 * so users immediately experience instant startup, search, and low-data deferred media.
 */
export function buildSeedWorkspace(
  uid: string,
  displayName: string,
  referenceNowMs = 1795340400000
): {
  rooms: ChatRoom[];
  messagesByRoom: Record<string, ChatMessage[]>;
} {
  const baseTime = referenceNowMs - 400000;
  const sampleImg = createTinySampleImageDataUrl();
  const sampleAudio = createTinySampleWavDataUrl(1.2, 540);

  const rooms: ChatRoom[] = [
    {
      id: 'room_field_ops',
      name: 'Field Ops Relay',
      type: 'group',
      createdBy: uid,
      participantIds: [uid, 'contact_amara', 'contact_tomas'],
      participantLabels: {
        [uid]: displayName,
        contact_amara: 'Amara Okafor',
        contact_tomas: 'Tomas Novak',
      },
      lastMessagePreview: 'Tower 4 battery telemetry + voice note ready',
      lastMessageAt: baseTime + 180000,
      lastReadAt: baseTime + 60000,
      unreadCount: 2,
      isSeed: true,
    },
    {
      id: 'room_amara_direct',
      name: 'Amara Okafor',
      type: 'direct',
      createdBy: uid,
      participantIds: [uid, 'contact_amara'],
      participantLabels: {
        [uid]: displayName,
        contact_amara: 'Amara Okafor',
      },
      lastMessagePreview: 'Packet queue flushed cleanly on 2G edge link.',
      lastMessageAt: baseTime + 120000,
      lastReadAt: baseTime + 120000,
      unreadCount: 0,
      isSeed: true,
    },
    {
      id: 'room_clinic_dispatch',
      name: 'Mobile Clinic Dispatch',
      type: 'group',
      createdBy: uid,
      participantIds: [uid, 'contact_nina', 'contact_tariq'],
      participantLabels: {
        [uid]: displayName,
        contact_nina: 'Dr. Nina Patel',
        contact_tariq: 'Tariq Hassan',
      },
      lastMessagePreview: 'Route 7 cold-chain manifest synced.',
      lastMessageAt: baseTime + 30000,
      lastReadAt: baseTime,
      unreadCount: 1,
      isSeed: true,
    },
  ];

  const messagesByRoom: Record<string, ChatMessage[]> = {
    room_field_ops: [
      {
        id: 'msg_seed_1',
        roomId: 'room_field_ops',
        senderId: 'contact_amara',
        senderName: 'Amara Okafor',
        roomParticipantIds: [uid, 'contact_amara', 'contact_tomas'],
        text: 'Signal dropped to EDGE near ridge checkpoint. Switching to Low-Data text-first.',
        clientCreatedAt: baseTime + 30000,
        seq: 1,
        status: 'delivered',
        attachmentKind: 'none',
        syncSource: 'local',
      },
      {
        id: 'msg_seed_2',
        roomId: 'room_field_ops',
        senderId: 'contact_tomas',
        senderName: 'Tomas Novak',
        roomParticipantIds: [uid, 'contact_amara', 'contact_tomas'],
        text: 'Attached compressed sector map thumbnail. Tap Load only if you have bars.',
        clientCreatedAt: baseTime + 110000,
        seq: 2,
        status: 'delivered',
        attachmentKind: 'image',
        attachmentName: 'sector_4_thumb.svg',
        attachmentBytes: sampleImg.bytes,
        attachmentDataUrl: sampleImg.dataUrl,
        mediaState: 'deferred',
        syncSource: 'local',
      },
      {
        id: 'msg_seed_3',
        roomId: 'room_field_ops',
        senderId: 'contact_amara',
        senderName: 'Amara Okafor',
        roomParticipantIds: [uid, 'contact_amara', 'contact_tomas'],
        text: 'Tower 4 battery telemetry + voice note ready',
        clientCreatedAt: baseTime + 180000,
        seq: 3,
        status: 'delivered',
        attachmentKind: 'audio',
        attachmentName: 'checkpoint_voice_8khz.wav',
        attachmentBytes: sampleAudio.bytes,
        attachmentDataUrl: sampleAudio.dataUrl,
        mediaState: 'deferred',
        syncSource: 'local',
      },
    ],
    room_amara_direct: [
      {
        id: 'msg_seed_4',
        roomId: 'room_amara_direct',
        senderId: uid,
        senderName: displayName,
        roomParticipantIds: [uid, 'contact_amara'],
        text: 'Did the supply manifest reach your client before the tower handover?',
        clientCreatedAt: baseTime + 60000,
        seq: 1,
        status: 'delivered',
        attachmentKind: 'none',
        syncSource: 'local',
      },
      {
        id: 'msg_seed_5',
        roomId: 'room_amara_direct',
        senderId: 'contact_amara',
        senderName: 'Amara Okafor',
        roomParticipantIds: [uid, 'contact_amara'],
        text: 'Packet queue flushed cleanly on 2G edge link.',
        clientCreatedAt: baseTime + 120000,
        seq: 2,
        status: 'delivered',
        attachmentKind: 'none',
        syncSource: 'local',
      },
    ],
    room_clinic_dispatch: [
      {
        id: 'msg_seed_6',
        roomId: 'room_clinic_dispatch',
        senderId: 'contact_nina',
        senderName: 'Dr. Nina Patel',
        roomParticipantIds: [uid, 'contact_nina', 'contact_tariq'],
        text: 'Route 7 cold-chain manifest synced.',
        clientCreatedAt: baseTime + 30000,
        seq: 1,
        status: 'delivered',
        attachmentKind: 'none',
        syncSource: 'local',
      },
    ],
  };

  return { rooms, messagesByRoom };
}
