import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  BandwidthConfig,
  ChatMessage,
  ChatRoom,
  NetworkQuality,
  OutboxEntry,
  RoomType,
  SyncHealthSnapshot,
  UserProfile,
} from '../core/types';
import {
  createOutgoingMessageAndOutbox,
  markOutboxDelivered,
  markOutboxInFlight,
  markOutboxRetry,
  resetAllOutboxBackoff,
  selectReadyOutboxBatch,
} from '../core/outboxEngine';
import {
  buildSeedWorkspace,
  generateSafeId,
  searchCachedMessages,
  sortMessagesFifo,
  sortRoomsByRecency,
  validateMessagePayload,
  validateRoomName,
} from '../core/searchEngine';
import {
  loadWorkspaceSnapshot,
  replaceOutboxQueue,
  saveMessagesBulk,
  saveMetaValue,
  saveRoomsBulk,
} from '../services/localStore';
import {
  auth,
  createOrSyncRoomInCloud,
  sanitizeHandle,
  sendMessageToCloud,
  signInWithGoogle,
  signOutFirebase,
  subscribeToRoomMessages,
  subscribeToUserRooms,
  syncUserProfileToCloud,
  testFirestoreConnection,
} from '../services/firebaseClient';
import { CompressedAttachment } from '../services/mediaHelper';
import { RoomFilter } from '../components/Sidebar';

interface NetworkInformationLike {
  effectiveType?: string;
  addEventListener?: (type: string, cb: () => void) => void;
  removeEventListener?: (type: string, cb: () => void) => void;
}

function detectBrowserNetwork(online: boolean): NetworkQuality {
  if (!online) return 'offline';
  const nav = navigator as Navigator & { connection?: NetworkInformationLike };
  const eff = nav.connection?.effectiveType;
  if (eff === 'slow-2g' || eff === '2g') return 'weak';
  return 'online';
}

export function usePulseLiteStore() {
  const [hydrated, setHydrated] = useState(false);
  const [profile, setProfile] = useState<UserProfile>({
    uid: 'local_operator',
    displayName: 'Operator',
    handle: 'operator',
    lowDataDefault: true,
    authMode: 'local',
    updatedAt: Date.now(),
  });
  const [bandwidthConfig, setBandwidthConfig] = useState<BandwidthConfig>({
    lowDataMode: true,
    simulatedCondition: 'auto',
    deferMediaToWifi: true,
  });

  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [messagesByRoom, setMessagesByRoom] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const [seqCounter, setSeqCounter] = useState(100);

  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [filter, setFilter] = useState<RoomFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [browserQuality, setBrowserQuality] = useState<NetworkQuality>(() =>
    typeof navigator !== 'undefined' ? detectBrowserNetwork(navigator.onLine) : 'online'
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [bytesSavedEstimate, setBytesSavedEstimate] = useState<number>(26200);
  const [lastTransitionNote, setLastTransitionNote] = useState<string>('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<Error | null>(null);

  const networkQuality: NetworkQuality =
    bandwidthConfig.simulatedCondition === 'auto'
      ? browserQuality
      : bandwidthConfig.simulatedCondition;

  // Refs for async flush loop without stale closures
  const outboxRef = useRef(outbox);
  outboxRef.current = outbox;
  const messagesRef = useRef(messagesByRoom);
  messagesRef.current = messagesByRoom;
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;
  const networkRef = useRef(networkQuality);
  networkRef.current = networkQuality;
  const prevNetworkRef = useRef<NetworkQuality | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const syncedCloudRoomsRef = useRef<Set<string>>(new Set());

  if (cloudError) {
    throw cloudError;
  }

  // 1. Initial IndexedDB Hydration + Firestore connection check
  useEffect(() => {
    let mounted = true;
    testFirestoreConnection().catch(() => {});

    loadWorkspaceSnapshot().then(async (snap) => {
      if (!mounted) return;
      const activeProfile: UserProfile = snap.profile ?? {
        uid: 'local_operator',
        displayName: 'Operator',
        handle: 'operator',
        lowDataDefault: true,
        authMode: 'local',
        updatedAt: Date.now(),
      };

      let loadedRooms = snap.rooms;
      let loadedMsgs: Record<string, ChatMessage[]> = {};
      for (const [rid, list] of Object.entries(snap.messagesByRoom)) {
        loadedMsgs[rid] = sortMessagesFifo(list);
      }

      if (loadedRooms.length === 0) {
        const seed = buildSeedWorkspace(
          activeProfile.uid,
          activeProfile.displayName,
          Date.now()
        );
        loadedRooms = seed.rooms;
        loadedMsgs = seed.messagesByRoom;
        await saveMetaValue('profile', activeProfile);
        await saveMetaValue('bandwidthConfig', snap.bandwidthConfig);
        await saveRoomsBulk(loadedRooms);
        await saveMessagesBulk(Object.values(loadedMsgs).flat());
      }

      let sorted = sortRoomsByRecency(loadedRooms);
      const initialActiveId = sorted[0]?.id ?? null;
      if (initialActiveId && typeof window !== 'undefined' && window.innerWidth >= 768) {
        const now = Date.now();
        sorted = sorted.map((r) =>
          r.id === initialActiveId ? { ...r, unreadCount: 0, lastReadAt: now } : r
        );
        saveRoomsBulk(sorted);
      }

      setProfile(activeProfile);
      setBandwidthConfig(snap.bandwidthConfig);
      setRooms(sorted);
      setMessagesByRoom(loadedMsgs);
      setOutbox(snap.outbox);
      setSeqCounter(snap.seqCounter);
      setActiveRoomId((prev) => prev ?? initialActiveId);
      setHydrated(true);
    });

    return () => {
      mounted = false;
    };
  }, []);

  // 2. Real browser connectivity listeners
  useEffect(() => {
    const updateNet = () => {
      const online = navigator.onLine;
      setBrowserOnline(online);
      setBrowserQuality(detectBrowserNetwork(online));
    };

    window.addEventListener('online', updateNet);
    window.addEventListener('offline', updateNet);

    const nav = navigator as Navigator & { connection?: NetworkInformationLike };
    nav.connection?.addEventListener?.('change', updateNet);

    return () => {
      window.removeEventListener('online', updateNet);
      window.removeEventListener('offline', updateNet);
      nav.connection?.removeEventListener?.('change', updateNet);
    };
  }, []);

  // 3. Clear transition messages when network state changes
  useEffect(() => {
    if (!hydrated) return;
    const prev = prevNetworkRef.current;
    prevNetworkRef.current = networkQuality;
    if (prev === null || prev === networkQuality) return;

    if (networkQuality === 'offline') {
      setLastTransitionNote(
        'Offline — outgoing messages are saved to your IndexedDB queue and will retry automatically.'
      );
    } else if (networkQuality === 'weak') {
      setLastTransitionNote(
        'Weak 2G signal — text-first priority active; media downloads remain deferred.'
      );
      setOutbox((q) => resetAllOutboxBackoff(q, Date.now()));
    } else {
      const pending = outboxRef.current.length;
      setLastTransitionNote(
        pending > 0
          ? `Online — flushing ${pending} queued message${pending === 1 ? '' : 's'} in strict order.`
          : 'Online — cloud sync ready.'
      );
      setOutbox((q) => resetAllOutboxBackoff(q, Date.now()));
    }
  }, [networkQuality, hydrated]);

  // 4. Firebase Auth state & real-time room/message listeners
  useEffect(() => {
    if (!hydrated) return;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) return;

      const nextProfile: UserProfile = {
        uid: user.uid,
        displayName: user.displayName || profile.displayName || 'Operator',
        handle: sanitizeHandle(user.email?.split('@')[0] || user.displayName || 'user'),
        email: user.email ?? undefined,
        lowDataDefault: bandwidthConfig.lowDataMode,
        authMode: 'google',
        updatedAt: Date.now(),
      };
      setProfile(nextProfile);
      saveMetaValue('profile', nextProfile);

      try {
        await syncUserProfileToCloud(nextProfile);
      } catch (err) {
        setCloudError(err as Error);
      }
    });

    return () => unsubAuth();
  }, [hydrated]);

  // Subscribe to cloud rooms ONLY when signed in with Google and online/weak
  useEffect(() => {
    if (!hydrated || profile.authMode !== 'google' || !auth.currentUser) return;
    if (networkQuality === 'offline') return;

    const uid = auth.currentUser.uid;
    const unsubRooms = subscribeToUserRooms(
      uid,
      (cloudRooms) => {
        if (cloudRooms.length === 0) return;
        setRooms((prevRooms) => {
          const map = new Map(prevRooms.map((r) => [r.id, r]));
          for (const cr of cloudRooms) {
            syncedCloudRoomsRef.current.add(cr.id);
            const existing = map.get(cr.id);
            map.set(cr.id, {
              ...cr,
              lastReadAt: existing?.lastReadAt ?? cr.lastMessageAt,
              unreadCount: existing?.unreadCount ?? 0,
            });
          }
          const merged = sortRoomsByRecency(Array.from(map.values()));
          saveRoomsBulk(merged);
          return merged;
        });
      },
      (err) => setCloudError(err)
    );

    return () => unsubRooms();
  }, [hydrated, profile.authMode, networkQuality]);

  // Subscribe to active room messages ONLY (bandwidth saver!)
  useEffect(() => {
    if (
      !hydrated ||
      profile.authMode !== 'google' ||
      !auth.currentUser ||
      !activeRoomId ||
      networkQuality === 'offline'
    ) {
      return;
    }

    const activeRoom = roomsRef.current.find((r) => r.id === activeRoomId);
    if (!activeRoom || activeRoom.isSeed) return;

    const uid = auth.currentUser.uid;
    const unsubMsgs = subscribeToRoomMessages(
      activeRoomId,
      uid,
      (cloudMsgs) => {
        setMessagesByRoom((prev) => {
          const currentList = prev[activeRoomId] ?? [];
          const byId = new Map(currentList.map((m) => [m.id, m]));
          for (const cm of cloudMsgs) {
            const local = byId.get(cm.id);
            if (local && (local.status === 'queued_offline' || local.status === 'sending')) {
              continue;
            }
            byId.set(cm.id, {
              ...cm,
              mediaState: local?.mediaState ?? cm.mediaState,
            });
          }
          const sorted = sortMessagesFifo(Array.from(byId.values()));
          saveMessagesBulk(sorted);
          return { ...prev, [activeRoomId]: sorted };
        });
        setLastSyncedAt(Date.now());
      },
      (err) => setCloudError(err)
    );

    return () => unsubMsgs();
  }, [hydrated, profile.authMode, activeRoomId, networkQuality]);

  // Helper to update a single message status locally & persist
  const updateMessageStatus = useCallback(
    (
      roomId: string,
      messageId: string,
      status: ChatMessage['status'],
      errorReason?: string
    ) => {
      setMessagesByRoom((prev) => {
        const roomMsgs = prev[roomId] ?? [];
        const updated = roomMsgs.map((m) =>
          m.id === messageId ? { ...m, status, errorReason } : m
        );
        const changed = updated.find((m) => m.id === messageId);
        if (changed) saveMessagesBulk([changed]);
        return { ...prev, [roomId]: updated };
      });
    },
    []
  );

  // 5. Outbox Processing & Exponential Backoff Engine
  const flushOutboxStep = useCallback(async () => {
    if (networkRef.current === 'offline') return;
    const now = Date.now();
    const readyBatch = selectReadyOutboxBatch(
      outboxRef.current,
      now,
      networkRef.current,
      2
    );
    if (readyBatch.length === 0) return;

    for (const entry of readyBatch) {
      setOutbox((q) => {
        const next = markOutboxInFlight(q, entry.messageId);
        replaceOutboxQueue(next);
        return next;
      });
      updateMessageStatus(entry.roomId, entry.messageId, 'sending');

      const msg = (messagesRef.current[entry.roomId] ?? []).find(
        (m) => m.id === entry.messageId
      );
      const room = roomsRef.current.find((r) => r.id === entry.roomId);

      if (!msg || !room) {
        setOutbox((q) => {
          const next = markOutboxDelivered(q, entry.messageId);
          replaceOutboxQueue(next);
          return next;
        });
        continue;
      }

      const isOfflineNow = () => networkRef.current === 'offline';

      try {
        if (auth.currentUser && !room.isSeed) {
          if (!syncedCloudRoomsRef.current.has(room.id)) {
            await createOrSyncRoomInCloud(room);
            syncedCloudRoomsRef.current.add(room.id);
          }
          await sendMessageToCloud(msg);
          if (isOfflineNow()) {
            throw new Error('Link dropped before confirmation');
          }
          updateMessageStatus(entry.roomId, entry.messageId, 'sent');
          await new Promise((r) => setTimeout(r, 120));
          updateMessageStatus(entry.roomId, entry.messageId, 'delivered');
        } else {
          // Local-First deterministic delivery progression when online/weak
          const hopMs = networkRef.current === 'weak' ? 420 : 140;
          await new Promise((r) => setTimeout(r, hopMs));
          if (isOfflineNow()) {
            throw new Error('Offline before relay ACK');
          }
          updateMessageStatus(entry.roomId, entry.messageId, 'sent');
          await new Promise((r) => setTimeout(r, hopMs));
          if (isOfflineNow()) {
            throw new Error('Offline before delivery ACK');
          }
          updateMessageStatus(entry.roomId, entry.messageId, 'delivered');
        }

        setOutbox((q) => {
          const next = markOutboxDelivered(q, entry.messageId);
          replaceOutboxQueue(next);
          return next;
        });
        setLastSyncedAt(Date.now());
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Delivery retry scheduled';
        setOutbox((q) => {
          const next = markOutboxRetry(q, entry.messageId, Date.now(), errMsg);
          replaceOutboxQueue(next);
          return next;
        });
        updateMessageStatus(entry.roomId, entry.messageId, 'queued_offline', errMsg);
      }
    }
  }, [updateMessageStatus]);

  // Schedule next outbox wake-up strictly based on earliest nextAttemptAt
  useEffect(() => {
    if (!hydrated) return;
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    if (networkQuality === 'offline' || outbox.length === 0) return;

    const pending = outbox.filter((e) => !e.inFlight);
    if (pending.length === 0) return;

    const earliest = Math.min(...pending.map((e) => e.nextAttemptAt));
    const delayMs = Math.max(10, earliest - Date.now());

    flushTimerRef.current = window.setTimeout(() => {
      flushOutboxStep();
    }, delayMs);

    return () => {
      if (flushTimerRef.current) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [hydrated, outbox, networkQuality, flushOutboxStep]);

  // Actions
  const selectRoom = useCallback((roomId: string) => {
    setActiveRoomId(roomId);
    const now = Date.now();
    setRooms((prev) => {
      const updated = prev.map((r) =>
        r.id === roomId ? { ...r, unreadCount: 0, lastReadAt: now } : r
      );
      saveRoomsBulk(updated);
      return updated;
    });
  }, []);

  const sendMessage = useCallback(
    (
      rawText: string,
      attachment?: CompressedAttachment
    ): { ok: boolean; error?: string } => {
      if (!activeRoomId) {
        return { ok: false, error: 'Select a conversation first.' };
      }
      const room = roomsRef.current.find((r) => r.id === activeRoomId);
      if (!room) {
        return { ok: false, error: 'Conversation not found.' };
      }

      const check = validateMessagePayload(rawText, attachment?.bytes);
      if (!check.valid) {
        return { ok: false, error: check.error };
      }

      const nextSeq = seqCounter + 1;
      setSeqCounter(nextSeq);
      saveMetaValue('seqCounter', nextSeq);

      const now = Date.now();
      const senderId = auth.currentUser?.uid ?? profile.uid;
      const { message, outboxEntry } = createOutgoingMessageAndOutbox({
        id: generateSafeId('msg'),
        roomId: room.id,
        senderId,
        senderName: profile.displayName,
        roomParticipantIds: room.participantIds,
        rawText,
        nowMs: now,
        seq: nextSeq,
        attachmentKind: attachment?.kind ?? 'none',
        attachmentName: attachment?.name,
        attachmentBytes: attachment?.bytes,
        attachmentDataUrl: attachment?.dataUrl,
      });

      setMessagesByRoom((prev) => {
        const nextList = sortMessagesFifo([...(prev[room.id] ?? []), message]);
        saveMessagesBulk([message]);
        return { ...prev, [room.id]: nextList };
      });

      setRooms((prev) => {
        const preview =
          message.text ||
          `[${message.attachmentKind === 'audio' ? 'Voice clip' : 'Image'} · ${
            message.attachmentName ?? 'Attachment'
          }]`;
        const updated = sortRoomsByRecency(
          prev.map((r) =>
            r.id === room.id
              ? { ...r, lastMessagePreview: preview, lastMessageAt: now }
              : r
          )
        );
        saveRoomsBulk(updated);
        return updated;
      });

      setOutbox((prev) => {
        const next = [...prev, outboxEntry];
        replaceOutboxQueue(next);
        return next;
      });

      return { ok: true };
    },
    [activeRoomId, profile.displayName, profile.uid, seqCounter]
  );

  const retryQueueNow = useCallback(() => {
    const now = Date.now();
    if (networkRef.current === 'offline') {
      setLastTransitionNote(
        `Still offline (${outboxRef.current.length} queued). Switch online or reconnect to flush queue.`
      );
      return;
    }
    setOutbox((prev) => {
      const next = resetAllOutboxBackoff(prev, now);
      replaceOutboxQueue(next);
      return next;
    });
    if (outboxRef.current.length > 0) {
      setLastTransitionNote('Manual retry triggered — flushing queued messages in order.');
    }
  }, []);

  const toggleLowDataMode = useCallback(() => {
    setBandwidthConfig((prev) => {
      const next: BandwidthConfig = { ...prev, lowDataMode: !prev.lowDataMode };
      saveMetaValue('bandwidthConfig', next);
      return next;
    });
  }, []);

  const toggleDeferWifi = useCallback(() => {
    setBandwidthConfig((prev) => {
      const next: BandwidthConfig = {
        ...prev,
        deferMediaToWifi: !prev.deferMediaToWifi,
      };
      saveMetaValue('bandwidthConfig', next);
      return next;
    });
  }, []);

  const changeSimulatedCondition = useCallback(
    (cond: BandwidthConfig['simulatedCondition']) => {
      setBandwidthConfig((prev) => {
        const next: BandwidthConfig = { ...prev, simulatedCondition: cond };
        saveMetaValue('bandwidthConfig', next);
        return next;
      });
    },
    []
  );

  const createRoom = useCallback(
    (params: { name: string; type: RoomType; participantIds: string[] }) => {
      const check = validateRoomName(params.name);
      if (!check.valid) return;
      const now = Date.now();
      const uid = auth.currentUser?.uid ?? profile.uid;
      const newRoom: ChatRoom = {
        id: generateSafeId('room'),
        name: params.name.trim(),
        type: params.type,
        createdBy: uid,
        participantIds: Array.from(new Set([uid, ...params.participantIds])),
        lastMessagePreview: 'Conversation created (offline-ready)',
        lastMessageAt: now,
        lastReadAt: now,
        unreadCount: 0,
        isSeed: false,
      };

      setRooms((prev) => {
        const next = sortRoomsByRecency([newRoom, ...prev]);
        saveRoomsBulk([newRoom]);
        return next;
      });
      setActiveRoomId(newRoom.id);

      if (auth.currentUser && networkRef.current !== 'offline') {
        createOrSyncRoomInCloud(newRoom)
          .then(() => syncedCloudRoomsRef.current.add(newRoom.id))
          .catch((err) => setCloudError(err as Error));
      }
    },
    [profile.uid]
  );

  const requestLoadMedia = useCallback((messageId: string) => {
    if (!activeRoomId) return;
    setMessagesByRoom((prev) => {
      const list = prev[activeRoomId] ?? [];
      const updated = list.map((m) =>
        m.id === messageId ? { ...m, mediaState: 'loading' as const } : m
      );
      return { ...prev, [activeRoomId]: updated };
    });

    const delay = networkRef.current === 'weak' ? 500 : 120;
    window.setTimeout(() => {
      setMessagesByRoom((prev) => {
        const list = prev[activeRoomId] ?? [];
        const target = list.find((m) => m.id === messageId);
        if (!target || target.mediaState !== 'loading') return prev;
        const updated = list.map((m) =>
          m.id === messageId ? { ...m, mediaState: 'loaded' as const } : m
        );
        const changed = updated.find((m) => m.id === messageId);
        if (changed) saveMessagesBulk([changed]);
        return { ...prev, [activeRoomId]: updated };
      });
    }, delay);
  }, [activeRoomId]);

  const deferMediaToWifi = useCallback(
    (messageId: string) => {
      if (!activeRoomId) return;
      setMessagesByRoom((prev) => {
        const list = prev[activeRoomId] ?? [];
        const target = list.find((m) => m.id === messageId);
        if (target?.attachmentBytes) {
          setBytesSavedEstimate((b) => b + (target.attachmentBytes ?? 0));
        }
        const updated = list.map((m) =>
          m.id === messageId ? { ...m, mediaState: 'wifi_only' as const } : m
        );
        const changed = updated.find((m) => m.id === messageId);
        if (changed) saveMessagesBulk([changed]);
        return { ...prev, [activeRoomId]: updated };
      });
    },
    [activeRoomId]
  );

  const cancelMediaLoad = useCallback(
    (messageId: string) => {
      if (!activeRoomId) return;
      setMessagesByRoom((prev) => {
        const list = prev[activeRoomId] ?? [];
        const updated = list.map((m) =>
          m.id === messageId ? { ...m, mediaState: 'cancelled' as const } : m
        );
        return { ...prev, [activeRoomId]: updated };
      });
    },
    [activeRoomId]
  );

  const updateProfile = useCallback(
    (displayName: string, handle: string) => {
      const next: UserProfile = {
        ...profile,
        displayName,
        handle: sanitizeHandle(handle),
        lowDataDefault: bandwidthConfig.lowDataMode,
        updatedAt: Date.now(),
      };
      setProfile(next);
      saveMetaValue('profile', next);
      if (auth.currentUser && networkRef.current !== 'offline') {
        syncUserProfileToCloud(next).catch((err) => setCloudError(err as Error));
      }
    },
    [profile, bandwidthConfig.lowDataMode]
  );

  const handleGoogleSignIn = useCallback(async () => {
    setAuthError(null);
    setAuthBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Google Sign-In could not complete.'
      );
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const handleGoogleSignOut = useCallback(async () => {
    setAuthError(null);
    setAuthBusy(true);
    try {
      await signOutFirebase();
      const reverted: UserProfile = {
        ...profile,
        uid: 'local_operator',
        authMode: 'local',
        email: undefined,
        updatedAt: Date.now(),
      };
      setProfile(reverted);
      saveMetaValue('profile', reverted);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign out failed.');
    } finally {
      setAuthBusy(false);
    }
  }, [profile]);

  const activeRoom = useMemo(
    () => rooms.find((r) => r.id === activeRoomId) ?? null,
    [rooms, activeRoomId]
  );

  const activeMessages = useMemo(
    () => (activeRoomId ? messagesByRoom[activeRoomId] ?? [] : []),
    [messagesByRoom, activeRoomId]
  );

  const searchHits = useMemo(
    () => searchCachedMessages(messagesByRoom, rooms, searchQuery),
    [messagesByRoom, rooms, searchQuery]
  );

  const totalCachedMessages = useMemo(
    () =>
      Object.values(messagesByRoom).reduce((acc, list) => acc + list.length, 0),
    [messagesByRoom]
  );

  const sendingCount = outbox.filter((o) => o.inFlight).length;

  const health: SyncHealthSnapshot = {
    networkQuality,
    isSyncing: sendingCount > 0,
    queuedCount: outbox.length,
    sendingCount,
    lastSyncedAt,
    bytesSavedEstimate,
    lastTransitionNote,
  };

  return {
    hydrated,
    browserOnline,
    profile,
    bandwidthConfig,
    rooms,
    activeRoom,
    activeRoomId,
    activeMessages,
    outbox,
    filter,
    searchQuery,
    searchHits,
    health,
    totalCachedMessages,
    authBusy,
    authError,
    setFilter,
    setSearchQuery,
    selectRoom,
    sendMessage,
    retryQueueNow,
    toggleLowDataMode,
    toggleDeferWifi,
    changeSimulatedCondition,
    createRoom,
    requestLoadMedia,
    deferMediaToWifi,
    cancelMediaLoad,
    updateProfile,
    handleGoogleSignIn,
    handleGoogleSignOut,
  };
}
