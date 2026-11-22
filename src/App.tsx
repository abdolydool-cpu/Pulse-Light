/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConnectionStatusBar } from './components/ConnectionStatusBar';
import { Sidebar } from './components/Sidebar';
import { ChatThread } from './components/ChatThread';
import { NewRoomModal } from './components/NewRoomModal';
import { AccountModal } from './components/AccountModal';
import { usePulseLiteStore } from './hooks/usePulseLiteStore';

function PulseLiteShell() {
  const store = usePulseLiteStore();
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [showNewRoom, setShowNewRoom] = useState(false);
  const [showAccount, setShowAccount] = useState(false);

  const handleSelectRoom = (roomId: string) => {
    store.selectRoom(roomId);
    setMobileShowThread(true);
  };

  if (!store.hydrated) {
    return (
      <div className="h-screen w-full bg-slate-50 flex items-center justify-center">
        <p className="text-sm font-medium text-slate-600">
          Loading local cache...
        </p>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col bg-slate-50 text-slate-900 overflow-hidden">
      <ConnectionStatusBar
        health={store.health}
        bandwidthConfig={store.bandwidthConfig}
        displayName={store.profile.displayName}
        isGoogleSignedIn={store.profile.authMode === 'google'}
        onRetryQueueNow={store.retryQueueNow}
        onToggleLowData={store.toggleLowDataMode}
        onChangeSimulatedCondition={store.changeSimulatedCondition}
        onOpenAccount={() => setShowAccount(true)}
      />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Sidebar: hidden on mobile when thread is open */}
        <div
          className={`${
            mobileShowThread ? 'hidden md:flex' : 'flex'
          } w-full md:w-auto min-h-0 h-full`}
        >
          <Sidebar
            rooms={store.rooms}
            activeRoomId={store.activeRoomId}
            filter={store.filter}
            searchQuery={store.searchQuery}
            searchHits={store.searchHits}
            onSelectRoom={handleSelectRoom}
            onChangeFilter={store.setFilter}
            onChangeSearch={store.setSearchQuery}
            onOpenNewRoom={() => setShowNewRoom(true)}
          />
        </div>

        {/* Active Chat Thread: hidden on mobile when viewing list */}
        <div
          className={`${
            mobileShowThread ? 'flex' : 'hidden md:flex'
          } flex-1 min-w-0 min-h-0 h-full`}
        >
          <ChatThread
            room={store.activeRoom}
            messages={store.activeMessages}
            currentUid={store.profile.uid}
            networkQuality={store.health.networkQuality}
            bandwidthConfig={store.bandwidthConfig}
            lastTransitionNote={store.health.lastTransitionNote}
            onBackToRooms={() => setMobileShowThread(false)}
            onSendMessage={store.sendMessage}
            onRequestLoadMedia={store.requestLoadMedia}
            onDeferMediaToWifi={store.deferMediaToWifi}
            onCancelMediaLoad={store.cancelMediaLoad}
          />
        </div>
      </div>

      <NewRoomModal
        isOpen={showNewRoom}
        currentUid={store.profile.uid}
        isGoogleSignedIn={store.profile.authMode === 'google'}
        onClose={() => setShowNewRoom(false)}
        onCreateRoom={(params) => {
          store.createRoom(params);
          setMobileShowThread(true);
        }}
      />

      <AccountModal
        isOpen={showAccount}
        profile={store.profile}
        bandwidthConfig={store.bandwidthConfig}
        cachedRoomCount={store.rooms.length}
        cachedMessageCount={store.totalCachedMessages}
        outboxCount={store.outbox.length}
        authBusy={store.authBusy}
        authError={store.authError}
        onClose={() => setShowAccount(false)}
        onUpdateProfile={store.updateProfile}
        onToggleDeferWifi={store.toggleDeferWifi}
        onGoogleSignIn={store.handleGoogleSignIn}
        onGoogleSignOut={store.handleGoogleSignOut}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <PulseLiteShell />
    </ErrorBoundary>
  );
}
