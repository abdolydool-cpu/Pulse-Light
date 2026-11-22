import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  Image as ImageIcon,
  Loader2,
  Mic,
  Paperclip,
  Send,
  Square,
  Volume2,
  Wifi,
  X,
} from 'lucide-react';
import {
  BandwidthConfig,
  ChatMessage,
  ChatRoom,
  NetworkQuality,
} from '../core/types';
import { formatBytes, STATUS_LABELS } from '../core/outboxEngine';
import {
  blobToDataUrl,
  CompressedAttachment,
  compressImageFile,
} from '../services/mediaHelper';
import { createTinySampleWavDataUrl } from '../core/searchEngine';

interface ChatThreadProps {
  room: ChatRoom | null;
  messages: ChatMessage[];
  currentUid: string;
  networkQuality: NetworkQuality;
  bandwidthConfig: BandwidthConfig;
  lastTransitionNote: string;
  onBackToRooms: () => void;
  onSendMessage: (
    text: string,
    attachment?: CompressedAttachment
  ) => { ok: boolean; error?: string };
  onRequestLoadMedia: (messageId: string) => void;
  onDeferMediaToWifi: (messageId: string) => void;
  onCancelMediaLoad: (messageId: string) => void;
}

function formatMessageTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const StatusBadge: React.FC<{
  status: ChatMessage['status'];
  isOwn: boolean;
}> = ({ status, isOwn }) => {
  const label = STATUS_LABELS[status];
  if (!isOwn) return null;

  if (status === 'queued_offline') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-200">
        <Clock className="w-3 h-3" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  if (status === 'sending') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-200">
        <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  if (status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-300">
        <Check className="w-3 h-3" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300">
      <CheckCheck className="w-3 h-3" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
};

export const ChatThread: React.FC<ChatThreadProps> = ({
  room,
  messages,
  currentUid,
  networkQuality,
  bandwidthConfig,
  lastTransitionNote,
  onBackToRooms,
  onSendMessage,
  onRequestLoadMedia,
  onDeferMediaToWifi,
  onCancelMediaLoad,
}) => {
  const [draft, setDraft] = useState('');
  const [composerError, setComposerError] = useState<string | null>(null);
  const [pendingAttachment, setPendingAttachment] =
    useState<CompressedAttachment | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [isCompressing, setIsCompressing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const raf = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [room?.id, messages.length]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  if (!room) {
    return (
      <main className="flex-1 flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm text-center space-y-2">
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Select a conversation
          </h2>
          <p className="text-sm text-slate-600">
            Cached threads load locally with zero waiting. Pick a chat from the list or start a new one.
          </p>
        </div>
      </main>
    );
  }

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setComposerError(null);
    const result = onSendMessage(draft, pendingAttachment ?? undefined);
    if (!result.ok) {
      setComposerError(result.error ?? 'Could not queue message.');
      return;
    }
    setDraft('');
    setPendingAttachment(null);
  };

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setComposerError(null);
    setIsCompressing(true);
    try {
      const compressed = await compressImageFile(file);
      setPendingAttachment(compressed);
    } catch (err) {
      setComposerError(
        err instanceof Error ? err.message : 'Failed to compress image.'
      );
    } finally {
      setIsCompressing(false);
    }
  };

  const handleToggleVoiceRecord = async () => {
    setComposerError(null);
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setIsRecording(false);
      return;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      // Lightweight fallback synthetic clip option notification
      const fallback = createTinySampleWavDataUrl(1.0, 480);
      setPendingAttachment({
        kind: 'audio',
        name: 'voice_memo_8khz.wav',
        bytes: fallback.bytes,
        dataUrl: fallback.dataUrl,
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        audioBitsPerSecond: 16000,
      });
      audioChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        const dataUrl = await blobToDataUrl(blob);
        if (dataUrl.length > 120000) {
          setComposerError(
            'Voice note exceeded 120 KB low-bandwidth cap. Keep clips brief.'
          );
          return;
        }
        setPendingAttachment({
          kind: 'audio',
          name: `voice_${Math.max(1, recordingSec)}s.webm`,
          bytes: dataUrl.length,
          dataUrl,
        });
      };

      recorder.start();
      setRecordingSec(0);
      setIsRecording(true);
      timerRef.current = window.setInterval(() => {
        setRecordingSec((prev) => {
          if (prev >= 14) {
            recorder.stop();
            if (timerRef.current) window.clearInterval(timerRef.current);
            setIsRecording(false);
            return 15;
          }
          return prev + 1;
        });
      }, 1000);
    } catch {
      setComposerError(
        'Microphone access declined. Use text-first messaging or attach a small image.'
      );
    }
  };

  return (
    <main className="flex-1 flex flex-col bg-slate-50 min-w-0 min-h-0 h-full">
      {/* Room Header */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-5 py-2.5 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onBackToRooms}
            aria-label="Back to conversations"
            className="md:hidden h-10 w-10 -ml-1 flex items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          </button>

          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-slate-900 truncate">
              {room.name}
            </h2>
            <div className="text-xs text-slate-500 flex items-center gap-1.5 whitespace-nowrap">
              <span>{room.type === 'group' ? 'Group chat' : 'Direct chat'}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-nums">
                {room.participantIds.length} members
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {bandwidthConfig.lowDataMode ? 'Text-First' : 'Standard'}
              </span>
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-500 font-mono-nums whitespace-nowrap hidden sm:block">
          {messages.length} cached
        </div>
      </div>

      {/* Inline Network Transition Banner (no pop-up spam) */}
      {lastTransitionNote && (
        <div
          role="status"
          data-testid="network-transition-banner"
          className={`px-4 py-1.5 text-xs font-medium border-b flex items-center justify-between gap-2 shrink-0 ${
            networkQuality === 'offline'
              ? 'bg-red-50 text-red-800 border-red-200'
              : networkQuality === 'weak'
              ? 'bg-amber-50 text-amber-800 border-amber-200'
              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
          }`}
        >
          <span>{lastTransitionNote}</span>
        </div>
      )}

      {/* Message Timeline */}
      <div
        ref={timelineRef}
        data-testid="message-timeline"
        className="flex-1 overflow-y-auto px-3 sm:px-5 pt-4 pb-6 space-y-3 thin-scroll"
      >
        {messages.length === 0 ? (
          <div className="py-12 text-center space-y-1.5">
            <p className="text-sm font-medium text-slate-700">
              No messages in this thread yet
            </p>
            <p className="text-xs text-slate-500">
              Type below—messages save immediately to IndexedDB even when offline.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOwn = msg.senderId === currentUid;
            const hasMedia = msg.attachmentKind !== 'none';
            const sizeLabel = formatBytes(msg.attachmentBytes ?? 0);

            return (
              <div
                key={msg.id}
                data-testid={`message-row-${msg.id}`}
                className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] sm:max-w-[70%] rounded-xl px-3.5 py-2.5 space-y-1.5 ${
                    isOwn
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-900 border border-slate-200'
                  }`}
                >
                  {!isOwn && room.type === 'group' && (
                    <div className="text-xs font-semibold text-teal-700">
                      {msg.senderName}
                    </div>
                  )}

                  {msg.text && (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                      {msg.text}
                    </p>
                  )}

                  {/* Lightweight Deferred Attachment Block */}
                  {hasMedia && (
                    <div
                      className={`mt-1.5 rounded-lg p-2.5 border ${
                        isOwn
                          ? 'bg-slate-800 border-slate-700 text-slate-100'
                          : 'bg-slate-50 border-slate-200 text-slate-800'
                      }`}
                    >
                      {msg.mediaState === 'loaded' && msg.attachmentDataUrl ? (
                        <div className="space-y-2">
                          {msg.attachmentKind === 'image' ? (
                            <img
                              src={msg.attachmentDataUrl}
                              alt={msg.attachmentName || 'Compressed attachment'}
                              referrerPolicy="no-referrer"
                              className="max-h-48 w-auto rounded border border-slate-200/30 object-contain"
                            />
                          ) : (
                            <audio
                              controls
                              src={msg.attachmentDataUrl}
                              className="w-full max-w-[260px] h-9"
                            />
                          )}
                          <div className="flex items-center justify-between gap-2 text-[11px] opacity-80">
                            <span className="truncate">
                              {msg.attachmentName ?? msg.attachmentKind} · {sizeLabel}
                            </span>
                            <button
                              type="button"
                              onClick={() => onDeferMediaToWifi(msg.id)}
                              className="underline hover:opacity-100 shrink-0 cursor-pointer"
                            >
                              Collapse
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-1.5 min-w-0 font-medium">
                              {msg.attachmentKind === 'image' ? (
                                <ImageIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
                              ) : (
                                <Volume2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                              )}
                              <span className="truncate">
                                {msg.attachmentName ??
                                  (msg.attachmentKind === 'image'
                                    ? 'Compressed thumbnail'
                                    : 'Voice note')}
                              </span>
                            </div>
                            <span className="font-mono-nums text-[11px] shrink-0 opacity-85">
                              {sizeLabel}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            {msg.mediaState === 'loading' ? (
                              <button
                                type="button"
                                onClick={() => onCancelMediaLoad(msg.id)}
                                className="h-8 px-2.5 inline-flex items-center gap-1 text-xs font-medium rounded bg-red-600 text-white hover:bg-red-700 cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Cancel</span>
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => onRequestLoadMedia(msg.id)}
                                  className={`h-8 px-2.5 inline-flex items-center gap-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                                    isOwn
                                      ? 'bg-teal-600 text-white hover:bg-teal-500'
                                      : 'bg-slate-900 text-white hover:bg-slate-800'
                                  }`}
                                >
                                  <span>Load ({sizeLabel})</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onDeferMediaToWifi(msg.id)}
                                  className={`h-8 px-2.5 inline-flex items-center gap-1 text-xs font-medium rounded border transition-colors cursor-pointer ${
                                    isOwn
                                      ? 'border-slate-600 text-slate-200 hover:bg-slate-700'
                                      : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                                  }`}
                                >
                                  <Wifi className="w-3 h-3" aria-hidden="true" />
                                  <span>
                                    {msg.mediaState === 'wifi_only'
                                      ? 'Deferred to Wi-Fi'
                                      : 'Defer to Wi-Fi'}
                                  </span>
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Footer metadata: Timestamp + Delivery Status */}
                  <div
                    className={`flex items-center justify-end gap-2 text-[11px] font-mono-nums ${
                      isOwn ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    <span>{formatMessageTime(msg.clientCreatedAt)}</span>
                    <StatusBadge status={msg.status} isOwn={isOwn} />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSubmit}
        className="bg-white border-t border-slate-200 p-3 space-y-2 shrink-0"
      >
        {composerError && (
          <div
            role="alert"
            className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5 flex items-center justify-between gap-2"
          >
            <span>{composerError}</span>
            <button
              type="button"
              onClick={() => setComposerError(null)}
              aria-label="Dismiss error"
              className="text-red-700 hover:text-red-900 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {pendingAttachment && (
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-xs">
            <span className="text-slate-800 font-medium truncate">
              Ready to queue: {pendingAttachment.name} ·{' '}
              <span className="font-mono-nums">
                {formatBytes(pendingAttachment.bytes)}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setPendingAttachment(null)}
              className="text-slate-600 hover:text-slate-900 underline shrink-0 cursor-pointer"
            >
              Remove
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImagePick}
            className="hidden"
          />

          <button
            type="button"
            disabled={isCompressing}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach compressed image"
            title="Attach compressed thumbnail (<=120 KB)"
            className="h-11 w-11 flex items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 shrink-0 cursor-pointer"
          >
            <Paperclip className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={handleToggleVoiceRecord}
            aria-label={isRecording ? 'Stop voice note' : 'Attach voice note'}
            title={
              isRecording
                ? 'Stop recording'
                : 'Record lightweight 16kbps voice note'
            }
            className={`h-11 px-2.5 flex items-center justify-center gap-1 rounded-lg border shrink-0 cursor-pointer transition-colors ${
              isRecording
                ? 'bg-red-600 text-white border-red-600'
                : 'border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {isRecording ? (
              <>
                <Square className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="text-xs font-mono-nums">{recordingSec}s</span>
              </>
            ) : (
              <Mic className="w-4 h-4" aria-hidden="true" />
            )}
          </button>

          <label className="sr-only" htmlFor="message-composer-input">
            Message text
          </label>
          <textarea
            id="message-composer-input"
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={
              networkQuality === 'offline'
                ? 'Offline — message will queue in IndexedDB...'
                : 'Write a message (low-bandwidth ready)...'
            }
            className="flex-1 min-h-[44px] max-h-28 px-3 py-2.5 text-sm bg-slate-100 text-slate-900 placeholder:text-slate-500 rounded-lg border border-transparent focus:bg-white focus:border-slate-300 focus:outline-none resize-none"
          />

          <button
            type="submit"
            aria-label="Send message"
            className="h-11 px-4 inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium shrink-0 transition-colors cursor-pointer"
          >
            <Send className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Send</span>
          </button>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
          <span>
            {bandwidthConfig.lowDataMode
              ? 'Low-Data Text-First active · Media deferred until tapped'
              : 'Standard mode · Small thumbnails load on Wi-Fi/Online'}
          </span>
          <span className="font-mono-nums">{draft.length}/2000</span>
        </div>
      </form>
    </main>
  );
};
