import React, { useState } from 'react';
import { Cloud, LogIn, LogOut, Smartphone, X } from 'lucide-react';
import { BandwidthConfig, UserProfile } from '../core/types';
import { sanitizeHandle } from '../services/firebaseClient';

interface AccountModalProps {
  isOpen: boolean;
  profile: UserProfile;
  bandwidthConfig: BandwidthConfig;
  cachedRoomCount: number;
  cachedMessageCount: number;
  outboxCount: number;
  authBusy: boolean;
  authError: string | null;
  onClose: () => void;
  onUpdateProfile: (displayName: string, handle: string) => void;
  onToggleDeferWifi: () => void;
  onGoogleSignIn: () => void;
  onGoogleSignOut: () => void;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  profile,
  bandwidthConfig,
  cachedRoomCount,
  cachedMessageCount,
  outboxCount,
  authBusy,
  authError,
  onClose,
  onUpdateProfile,
  onToggleDeferWifi,
  onGoogleSignIn,
  onGoogleSignOut,
}) => {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [handle, setHandle] = useState(profile.handle);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = displayName.trim() || 'Operator';
    const cleanHandle = sanitizeHandle(handle || cleanName);
    onUpdateProfile(cleanName, cleanHandle);
    setSavedNote('Profile saved locally' + (profile.authMode === 'google' ? ' and queued for cloud sync.' : '.'));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Profile and sync settings"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
    >
      <div className="w-full max-w-lg rounded-xl bg-white border border-slate-200 p-5 space-y-5 max-h-[90vh] overflow-y-auto thin-scroll">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Profile, Cloud Sync &amp; Storage
          </h2>
          <button
            type="button"
            aria-label="Close profile dialog"
            onClick={onClose}
            className="h-9 w-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Cloud Sign-In Card */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Cloud className="w-4 h-4 text-teal-700" aria-hidden="true" />
                <span>
                  {profile.authMode === 'google'
                    ? 'Cloud Sync Connected'
                    : 'Local-First Offline Mode'}
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {profile.authMode === 'google'
                  ? `Signed in as ${profile.email ?? profile.displayName}. Messages sync in real time to Firestore when connected.`
                  : 'All chats and the outbox queue work offline in IndexedDB. Sign in with Google to sync rooms and messages across devices.'}
              </p>
            </div>
          </div>

          {authError && (
            <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">
              {authError}
            </p>
          )}

          {profile.authMode === 'google' ? (
            <button
              type="button"
              disabled={authBusy}
              onClick={onGoogleSignOut}
              className="h-9 px-3.5 inline-flex items-center gap-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Sign Out</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={authBusy}
              onClick={onGoogleSignIn}
              className="h-10 px-4 inline-flex items-center gap-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{authBusy ? 'Connecting...' : 'Sign in with Google for Cloud Sync'}</span>
            </button>
          )}
        </div>

        {/* Profile Form */}
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label
                htmlFor="profile-display-name"
                className="block text-xs font-medium text-slate-700"
              >
                Display Name
              </label>
              <input
                id="profile-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={60}
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:border-teal-600 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="profile-handle"
                className="block text-xs font-medium text-slate-700"
              >
                Handle
              </label>
              <input
                id="profile-handle"
                type="text"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                maxLength={32}
                className="w-full h-10 px-3 text-sm font-mono-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:border-teal-600 focus:outline-none"
              />
            </div>
          </div>

          {savedNote && <p className="text-xs text-emerald-700">{savedNote}</p>}

          <button
            type="submit"
            className="h-9 px-4 text-xs font-medium rounded-lg bg-teal-700 text-white hover:bg-teal-800 cursor-pointer"
          >
            Save Profile
          </button>
        </form>

        {/* Bandwidth & Cross-Platform Schema Summary */}
        <div className="border-t border-slate-200 pt-4 space-y-3">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-xs font-semibold text-slate-900">
                Defer media downloads until Wi-Fi / manual tap
              </div>
              <div className="text-[11px] text-slate-500">
                Prevents automatic image/audio fetches on metered or weak 2G links.
              </div>
            </div>
            <input
              type="checkbox"
              checked={bandwidthConfig.deferMediaToWifi}
              onChange={onToggleDeferWifi}
              className="h-4 w-4 accent-teal-700"
            />
          </label>

          <div className="rounded-lg border border-slate-200 p-3 space-y-1.5 text-xs text-slate-600">
            <div className="flex items-center gap-1.5 font-semibold text-slate-800">
              <Smartphone className="w-3.5 h-3.5 text-teal-700" aria-hidden="true" />
              <span>Local Cache &amp; Cross-Platform Sync Mirror</span>
            </div>
            <div className="font-mono-nums text-[11px] text-slate-700">
              {cachedRoomCount} rooms · {cachedMessageCount} cached messages · {outboxCount} outbox pending
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Uses canonical <code className="font-mono-nums">ChatRoom</code>,{' '}
              <code className="font-mono-nums">ChatMessage</code>, and FIFO{' '}
              <code className="font-mono-nums">OutboxEntry</code> schemas (IndexedDB on Web PWA, Room on Android, SQLite on Windows).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
