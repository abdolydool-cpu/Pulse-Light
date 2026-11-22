import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { RoomType } from '../core/types';
import { validateRoomName } from '../core/searchEngine';
import { DirectoryUser, fetchDirectoryContacts } from '../services/firebaseClient';

interface NewRoomModalProps {
  isOpen: boolean;
  currentUid: string;
  isGoogleSignedIn: boolean;
  onClose: () => void;
  onCreateRoom: (params: {
    name: string;
    type: RoomType;
    participantIds: string[];
  }) => void;
}

export const NewRoomModal: React.FC<NewRoomModalProps> = ({
  isOpen,
  currentUid,
  isGoogleSignedIn,
  onClose,
  onCreateRoom,
}) => {
  const [roomType, setRoomType] = useState<RoomType>('direct');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (isGoogleSignedIn) {
      setLoadingDirectory(true);
      fetchDirectoryContacts(currentUid)
        .then((users) => setDirectoryUsers(users))
        .catch(() => setDirectoryUsers([]))
        .finally(() => setLoadingDirectory(false));
    }
  }, [isOpen, isGoogleSignedIn, currentUid]);

  if (!isOpen) return null;

  const toggleUser = (uid: string) => {
    if (roomType === 'direct') {
      setSelectedUids([uid]);
      const match = directoryUsers.find((u) => u.uid === uid);
      if (match && !name.trim()) {
        setName(match.displayName);
      }
      return;
    }
    setSelectedUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid].slice(0, 19)
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateRoomName(name);
    if (!check.valid) {
      setError(check.error ?? 'Invalid conversation name.');
      return;
    }

    const participantIds = Array.from(new Set([currentUid, ...selectedUids]));
    onCreateRoom({
      name: name.trim(),
      type: roomType,
      participantIds,
    });
    setName('');
    setSelectedUids([]);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New conversation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white border border-slate-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-slate-900">
            New Conversation
          </h2>
          <button
            type="button"
            aria-label="Close new conversation dialog"
            onClick={onClose}
            className="h-9 w-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setRoomType('direct');
                setSelectedUids((prev) => prev.slice(0, 1));
              }}
              className={`h-9 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                roomType === 'direct'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              1-on-1 Direct
            </button>
            <button
              type="button"
              onClick={() => setRoomType('group')}
              className={`h-9 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                roomType === 'group'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Small Group
            </button>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="new-room-name"
              className="block text-xs font-medium text-slate-700"
            >
              {roomType === 'direct' ? 'Contact or Thread Name' : 'Group Room Name'}
            </label>
            <input
              id="new-room-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder={
                roomType === 'direct' ? 'e.g. Samira Khan' : 'e.g. North Relay Crew'
              }
              className="w-full h-10 px-3 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:border-teal-600 focus:outline-none"
            />
          </div>

          {isGoogleSignedIn && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-slate-700">
                Cloud Directory Contacts (Optional)
              </div>
              {loadingDirectory ? (
                <p className="text-xs text-slate-500">Loading directory...</p>
              ) : directoryUsers.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No other cloud contacts found yet. You can still create this thread locally and sync anytime.
                </p>
              ) : (
                <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {directoryUsers.map((u) => {
                    const checked = selectedUids.includes(u.uid);
                    return (
                      <label
                        key={u.uid}
                        className="flex items-center justify-between px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer"
                      >
                        <span className="text-slate-800 font-medium">
                          {u.displayName}{' '}
                          <span className="text-slate-500 font-normal">
                            @{u.handle}
                          </span>
                        </span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleUser(u.uid)}
                          className="h-4 w-4 accent-teal-700"
                        />
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-xs text-red-700">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-10 px-4 text-xs font-medium rounded-lg bg-teal-700 text-white hover:bg-teal-800 cursor-pointer"
            >
              Create Conversation
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
