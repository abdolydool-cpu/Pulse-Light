import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  ChatMessage,
  ChatRoom,
  SCHEMA_LIMITS,
  UserProfile,
} from '../core/types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<'reachable' | 'offline' | 'error'> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return 'reachable';
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return 'offline';
    }
    // Permission denied on default-deny test/connection still confirms server reachability
    return 'reachable';
  }
}

export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutFirebase(): Promise<void> {
  await signOut(auth);
}

export function sanitizeHandle(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (cleaned.length >= SCHEMA_LIMITS.MIN_HANDLE_LENGTH) {
    return cleaned.slice(0, SCHEMA_LIMITS.MAX_HANDLE_LENGTH);
  }
  return `user_${cleaned || 'pulse'}`.slice(0, SCHEMA_LIMITS.MAX_HANDLE_LENGTH);
}

export async function syncUserProfileToCloud(profile: UserProfile): Promise<void> {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid;
  const publicPath = `users/${uid}`;
  const privatePath = `users/${uid}/private/info`;

  try {
    await setDoc(
      doc(db, 'users', uid),
      {
        uid,
        displayName: profile.displayName.slice(0, SCHEMA_LIMITS.MAX_DISPLAY_NAME),
        handle: sanitizeHandle(profile.handle),
        statusText: (profile.statusText ?? 'Low-data mode active').slice(0, 100),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, publicPath);
  }

  try {
    await setDoc(
      doc(db, 'users', uid, 'private', 'info'),
      {
        uid,
        email: (auth.currentUser.email ?? '').slice(0, 160),
        lowDataDefault: profile.lowDataDefault,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, privatePath);
  }
}

export interface DirectoryUser {
  uid: string;
  displayName: string;
  handle: string;
  statusText?: string;
}

export async function fetchDirectoryContacts(currentUid: string): Promise<DirectoryUser[]> {
  const path = 'users';
  try {
    const q = query(collection(db, 'users'), limit(30));
    const snap = await getDocs(q);
    const list: DirectoryUser[] = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      if (d.uid && d.uid !== currentUid) {
        list.push({
          uid: String(d.uid),
          displayName: String(d.displayName ?? 'PulseLite User'),
          handle: String(d.handle ?? 'user'),
          statusText: d.statusText ? String(d.statusText) : undefined,
        });
      }
    });
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function createOrSyncRoomInCloud(room: ChatRoom): Promise<void> {
  if (!auth.currentUser) return;
  const path = `rooms/${room.id}`;
  try {
    await setDoc(doc(db, 'rooms', room.id), {
      id: room.id,
      name: room.name.slice(0, SCHEMA_LIMITS.MAX_ROOM_NAME),
      type: room.type,
      createdBy: room.createdBy,
      participantIds: room.participantIds.slice(0, SCHEMA_LIMITS.MAX_PARTICIPANTS),
      lastMessagePreview: room.lastMessagePreview.slice(0, SCHEMA_LIMITS.MAX_PREVIEW_LENGTH),
      lastMessageAt: room.lastMessageAt,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function sendMessageToCloud(message: ChatMessage): Promise<void> {
  if (!auth.currentUser) {
    throw new Error('Cloud sync requires authentication');
  }

  const msgPath = `rooms/${message.roomId}/messages/${message.id}`;
  const roomPath = `rooms/${message.roomId}`;

  const payload: Record<string, unknown> = {
    id: message.id,
    roomId: message.roomId,
    senderId: auth.currentUser.uid,
    senderName: message.senderName.slice(0, SCHEMA_LIMITS.MAX_DISPLAY_NAME),
    roomParticipantIds: message.roomParticipantIds.slice(0, SCHEMA_LIMITS.MAX_PARTICIPANTS),
    text: message.text.slice(0, SCHEMA_LIMITS.MAX_TEXT_LENGTH),
    clientCreatedAt: message.clientCreatedAt,
    seq: message.seq,
    status: 'sent',
    attachmentKind: message.attachmentKind,
    createdAt: serverTimestamp(),
  };

  if (message.attachmentKind !== 'none') {
    if (message.attachmentName) {
      payload.attachmentName = message.attachmentName.slice(0, SCHEMA_LIMITS.MAX_ATTACHMENT_NAME);
    }
    if (typeof message.attachmentBytes === 'number') {
      payload.attachmentBytes = Math.min(
        SCHEMA_LIMITS.MAX_ATTACHMENT_BYTES,
        Math.max(0, message.attachmentBytes)
      );
    }
    if (message.attachmentDataUrl && message.attachmentDataUrl.length <= SCHEMA_LIMITS.MAX_ATTACHMENT_BYTES) {
      payload.attachmentDataUrl = message.attachmentDataUrl;
    }
  }

  try {
    await setDoc(doc(db, 'rooms', message.roomId, 'messages', message.id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, msgPath);
  }

  try {
    const preview =
      message.text ||
      `[${message.attachmentKind === 'audio' ? 'Voice clip' : 'Image'} · ${
        message.attachmentName ?? 'Attachment'
      }]`;
    await updateDoc(doc(db, 'rooms', message.roomId), {
      lastMessagePreview: preview.slice(0, SCHEMA_LIMITS.MAX_PREVIEW_LENGTH),
      lastMessageAt: message.clientCreatedAt,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, roomPath);
  }
}

export async function markMessageDeliveredInCloud(
  roomId: string,
  messageId: string
): Promise<void> {
  if (!auth.currentUser) return;
  const path = `rooms/${roomId}/messages/${messageId}`;
  try {
    await updateDoc(doc(db, 'rooms', roomId, 'messages', messageId), {
      status: 'delivered',
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeToUserRooms(
  uid: string,
  onRooms: (rooms: ChatRoom[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = 'rooms';
  const q = query(collection(db, 'rooms'), where('participantIds', 'array-contains', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const rooms: ChatRoom[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        rooms.push({
          id: String(d.id ?? docSnap.id),
          name: String(d.name ?? 'Chat'),
          type: d.type === 'group' ? 'group' : 'direct',
          createdBy: String(d.createdBy ?? uid),
          participantIds: Array.isArray(d.participantIds) ? d.participantIds.map(String) : [uid],
          lastMessagePreview: String(d.lastMessagePreview ?? ''),
          lastMessageAt: typeof d.lastMessageAt === 'number' ? d.lastMessageAt : Date.now(),
          lastReadAt: 0,
          unreadCount: 0,
        });
      });
      onRooms(rooms);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeToRoomMessages(
  roomId: string,
  uid: string,
  onMessages: (msgs: ChatMessage[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `rooms/${roomId}/messages`;
  const q = query(
    collection(db, 'rooms', roomId, 'messages'),
    where('roomParticipantIds', 'array-contains', uid)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const msgs: ChatMessage[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        msgs.push({
          id: String(d.id ?? docSnap.id),
          roomId: String(d.roomId ?? roomId),
          senderId: String(d.senderId ?? ''),
          senderName: String(d.senderName ?? 'Member'),
          roomParticipantIds: Array.isArray(d.roomParticipantIds)
            ? d.roomParticipantIds.map(String)
            : [uid],
          text: String(d.text ?? ''),
          clientCreatedAt: typeof d.clientCreatedAt === 'number' ? d.clientCreatedAt : Date.now(),
          seq: typeof d.seq === 'number' ? d.seq : 0,
          status: d.status === 'delivered' ? 'delivered' : 'sent',
          attachmentKind:
            d.attachmentKind === 'audio' || d.attachmentKind === 'image'
              ? d.attachmentKind
              : 'none',
          attachmentName: d.attachmentName ? String(d.attachmentName) : undefined,
          attachmentBytes: typeof d.attachmentBytes === 'number' ? d.attachmentBytes : undefined,
          attachmentDataUrl: d.attachmentDataUrl ? String(d.attachmentDataUrl) : undefined,
          mediaState: d.attachmentKind && d.attachmentKind !== 'none' ? 'deferred' : undefined,
          syncSource: 'cloud',
        });
      });
      onMessages(msgs);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}
