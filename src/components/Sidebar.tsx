import React from 'react';
import { MessageSquarePlus, Search, Users, User, X } from 'lucide-react';
import { ChatRoom, SearchHit } from '../core/types';

export type RoomFilter = 'all' | 'direct' | 'group' | 'unread';

interface SidebarProps {
  rooms: ChatRoom[];
  activeRoomId: string | null;
  filter: RoomFilter;
  searchQuery: string;
  searchHits: SearchHit[];
  onSelectRoom: (roomId: string) => void;
  onChangeFilter: (filter: RoomFilter) => void;
  onChangeSearch: (query: string) => void;
  onOpenNewRoom: () => void;
}

function formatShortTime(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const Sidebar: React.FC<SidebarProps> = ({
  rooms,
  activeRoomId,
  filter,
  searchQuery,
  searchHits,
  onSelectRoom,
  onChangeFilter,
  onChangeSearch,
  onOpenNewRoom,
}) => {
  const filteredRooms = rooms.filter((room) => {
    if (filter === 'direct' && room.type !== 'direct') return false;
    if (filter === 'group' && room.type !== 'group') return false;
    if (filter === 'unread' && room.unreadCount === 0) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      return (
        room.name.toLowerCase().includes(q) ||
        room.lastMessagePreview.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const hasSearch = searchQuery.trim().length > 0;

  return (
    <aside
      aria-label="Conversations"
      className="w-full md:w-80 lg:w-88 bg-white border-r border-slate-200 flex flex-col min-h-0 h-full shrink-0"
    >
      {/* Top row: Title + New Chat */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
        <h1 className="font-display text-base font-semibold text-slate-900">
          Conversations
        </h1>
        <button
          type="button"
          onClick={onOpenNewRoom}
          className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
        >
          <MessageSquarePlus className="w-3.5 h-3.5" aria-hidden="true" />
          <span>New Chat</span>
        </button>
      </div>

      {/* Search across locally cached messages */}
      <div className="px-3 pt-3 pb-2 space-y-2.5 border-b border-slate-100">
        <div className="relative">
          <Search
            className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search cached messages"
            value={searchQuery}
            onChange={(e) => onChangeSearch(e.target.value)}
            placeholder="Search cached messages..."
            className="w-full h-10 pl-9 pr-8 text-sm bg-slate-100 text-slate-900 placeholder:text-slate-500 rounded-lg border border-transparent focus:bg-white focus:border-slate-300 focus:outline-none"
          />
          {hasSearch && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onChangeSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Filter tabs */}
        <div
          role="tablist"
          aria-label="Filter conversations"
          className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-lg"
        >
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'direct', label: 'Direct' },
              { id: 'group', label: 'Groups' },
              { id: 'unread', label: 'Unread' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              onClick={() => onChangeFilter(tab.id)}
              className={`h-8 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                filter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable list: Local Search Hits OR Rooms */}
      <div className="flex-1 overflow-y-auto thin-scroll divide-y divide-slate-100">
        {hasSearch && (
          <div className="bg-slate-50/70">
            <div className="px-4 py-2 text-xs font-medium text-slate-500 border-b border-slate-100">
              Cached Message Matches ({searchHits.length})
            </div>
            {searchHits.length === 0 ? (
              <div className="px-4 py-4 text-xs text-slate-500">
                No locally cached messages matched &ldquo;{searchQuery.trim()}&rdquo;.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {searchHits.map((hit) => (
                  <button
                    key={hit.messageId}
                    type="button"
                    onClick={() => onSelectRoom(hit.roomId)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-100/80 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-teal-800 truncate">
                        {hit.roomName}
                      </span>
                      <span className="text-[11px] font-mono-nums text-slate-500 shrink-0">
                        {formatShortTime(hit.clientCreatedAt)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 mt-0.5 line-clamp-2">
                      <span className="font-medium">{hit.senderName}:</span> {hit.text}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {filteredRooms.length === 0 ? (
          <div className="p-6 text-center space-y-2">
            <p className="text-sm font-medium text-slate-700">
              No conversations shown
            </p>
            <p className="text-xs text-slate-500">
              {filter === 'unread'
                ? 'All cached threads are caught up.'
                : 'Start a direct chat or group room to queue messages offline or online.'}
            </p>
          </div>
        ) : (
          filteredRooms.map((room) => {
            const isActive = room.id === activeRoomId;
            return (
              <button
                key={room.id}
                type="button"
                onClick={() => onSelectRoom(room.id)}
                data-testid={`room-item-${room.id}`}
                className={`w-full text-left px-4 py-3.5 min-h-[68px] flex items-start gap-3 transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-teal-50/70'
                    : 'bg-white hover:bg-slate-50'
                }`}
              >
                <div
                  className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 text-sm font-semibold ${
                    room.type === 'group'
                      ? 'bg-teal-700 text-white'
                      : 'bg-slate-900 text-white'
                  }`}
                  aria-hidden="true"
                >
                  {room.type === 'group' ? (
                    <Users className="w-4 h-4" />
                  ) : (
                    <User className="w-4 h-4" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900 truncate">
                      {room.name}
                    </span>
                    <span className="text-[11px] font-mono-nums text-slate-500 shrink-0">
                      {formatShortTime(room.lastMessageAt)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-1">
                    <p className="text-xs text-slate-600 truncate">
                      {room.lastMessagePreview || 'No messages yet'}
                    </p>
                    {room.unreadCount > 0 && (
                      <span
                        data-testid={`unread-badge-${room.id}`}
                        className="font-mono-nums text-[11px] font-semibold text-teal-800 shrink-0"
                      >
                        {room.unreadCount} new
                      </span>
                    )}
                  </div>

                  <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                    <span>{room.type === 'group' ? 'Group' : 'Direct'}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-nums">
                      {room.participantIds.length} members
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
};
