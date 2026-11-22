import React, { useState } from 'react';
import {
  Download,
  RefreshCw,
  Signal,
  SignalLow,
  User,
  WifiOff,
  Zap,
} from 'lucide-react';
import { BandwidthConfig, NetworkQuality, SyncHealthSnapshot } from '../core/types';
import { formatBytes } from '../core/outboxEngine';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface ConnectionStatusBarProps {
  health: SyncHealthSnapshot;
  bandwidthConfig: BandwidthConfig;
  displayName: string;
  isGoogleSignedIn: boolean;
  onRetryQueueNow: () => void;
  onToggleLowData: () => void;
  onChangeSimulatedCondition: (cond: BandwidthConfig['simulatedCondition']) => void;
  onOpenAccount: () => void;
}

export const ConnectionStatusBar: React.FC<ConnectionStatusBarProps> = ({
  health,
  bandwidthConfig,
  displayName,
  isGoogleSignedIn,
  onRetryQueueNow,
  onToggleLowData,
  onChangeSimulatedCondition,
  onOpenAccount,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  const statusMeta = {
    online: {
      label: 'Online',
      textClass: 'text-emerald-700',
      dotClass: 'bg-emerald-600',
      Icon: Signal,
    },
    weak: {
      label: 'Weak',
      textClass: 'text-amber-700',
      dotClass: 'bg-amber-500',
      Icon: SignalLow,
    },
    offline: {
      label: 'Offline',
      textClass: 'text-red-700',
      dotClass: 'bg-red-600',
      Icon: WifiOff,
    },
  }[health.networkQuality as NetworkQuality];

  const StatusIcon = statusMeta.Icon;

  return (
    <>
      <header
        data-testid="connection-status-bar"
        className="w-full bg-white border-b border-slate-200 px-3 sm:px-4 py-1.5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-1.5 lg:gap-3 shrink-0 z-30"
      >
        {/* Row 1 (Mobile) / Left Zone (Desktop): Brand + Live Health + Queue + Profile on Mobile */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="inline-flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-md sm:rounded-lg bg-slate-900 text-white font-display text-[11px] sm:text-xs font-bold">
                PL
              </span>
              <span className="font-display font-bold text-sm sm:text-base tracking-tight text-slate-900 whitespace-nowrap">
                PulseLite
              </span>
            </div>

            <span className="text-slate-300" aria-hidden="true">
              |
            </span>

            {/* Live network telemetry indicator */}
            <div
              className="flex items-center gap-1 text-xs font-medium whitespace-nowrap"
              data-testid="network-state-indicator"
            >
              <span
                className={`h-2 w-2 rounded-full ${statusMeta.dotClass}`}
                aria-hidden="true"
              />
              <StatusIcon className={`w-3.5 h-3.5 ${statusMeta.textClass}`} aria-hidden="true" />
              <span className={statusMeta.textClass}>{statusMeta.label}</span>
            </div>

            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>

            {/* Queue & sync status (always visible, compact on mobile) */}
            <div
              className="text-xs text-slate-600 font-mono-nums whitespace-nowrap flex items-center gap-1 min-w-0 truncate"
              data-testid="outbox-status-text"
            >
              {health.isSyncing ? (
                <span>Sync ({health.sendingCount})</span>
              ) : health.queuedCount > 0 ? (
                <span className="text-amber-700 font-medium">
                  {health.queuedCount} queued
                </span>
              ) : (
                <>
                  <span className="sm:hidden">0 queued</span>
                  <span className="hidden sm:inline">Queue clear</span>
                </>
              )}
              {bandwidthConfig.lowDataMode && health.bytesSavedEstimate > 0 && (
                <span className="hidden md:inline text-slate-500">
                  · {formatBytes(health.bytesSavedEstimate)} saved
                </span>
              )}
            </div>
          </div>

          {/* Mobile-only compact profile button */}
          <button
            type="button"
            onClick={onOpenAccount}
            aria-label="Profile and cloud sync settings"
            className="lg:hidden h-8 px-2 inline-flex items-center gap-1 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <User className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
            <span className="max-w-[64px] truncate">{displayName}</span>
          </button>
        </div>

        {/* Row 2 (Mobile) / Right Zone (Desktop): Network controls + Retry + Low-Data + Install + Profile */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          <label className="sr-only" htmlFor="network-condition-select">
            Network condition
          </label>
          <select
            id="network-condition-select"
            aria-label="Network condition"
            value={bandwidthConfig.simulatedCondition}
            onChange={(e) =>
              onChangeSimulatedCondition(
                e.target.value as BandwidthConfig['simulatedCondition']
              )
            }
            className="h-8 sm:h-9 px-2 sm:px-2.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200/70 border border-slate-200 rounded-md sm:rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 cursor-pointer shrink-0"
          >
            <option value="auto">Net: Auto</option>
            <option value="online">Net: Online</option>
            <option value="weak">Net: Weak</option>
            <option value="offline">Net: Offline</option>
          </select>

          <button
            type="button"
            onClick={onRetryQueueNow}
            aria-label="Retry Queue Now"
            className="h-8 sm:h-9 px-2.5 sm:px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md sm:rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${health.isSyncing ? 'animate-spin text-teal-700' : 'text-slate-600'}`}
              aria-hidden="true"
            />
            <span className="sm:hidden">Retry</span>
            <span className="hidden sm:inline">Retry Queue Now</span>
            {health.queuedCount > 0 && (
              <span className="font-mono-nums text-amber-700 font-semibold">
                ({health.queuedCount})
              </span>
            )}
          </button>

          <button
            type="button"
            aria-pressed={bandwidthConfig.lowDataMode}
            onClick={onToggleLowData}
            className={`h-8 sm:h-9 px-2.5 sm:px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md sm:rounded-lg border whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors cursor-pointer ${
              bandwidthConfig.lowDataMode
                ? 'bg-teal-700 text-white border-teal-700 hover:bg-teal-800'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Zap className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              Low-Data: {bandwidthConfig.lowDataMode ? 'On' : 'Off'}
            </span>
          </button>

          {!isInstalled && isInstallable && (
            <button
              type="button"
              onClick={install}
              className="h-8 sm:h-9 px-2.5 sm:px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md sm:rounded-lg bg-slate-900 text-white hover:bg-slate-800 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Install App</span>
            </button>
          )}
          {!isInstalled && !isInstallable && isIOS && (
            <button
              type="button"
              onClick={() => setShowIOSGuide(true)}
              className="h-8 sm:h-9 px-2.5 inline-flex items-center gap-1 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Install</span>
            </button>
          )}

          {/* Desktop profile button */}
          <button
            type="button"
            onClick={onOpenAccount}
            aria-label="Profile and cloud sync settings"
            className="hidden lg:inline-flex h-9 px-3 items-center gap-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors cursor-pointer"
          >
            <User className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
            <span className="max-w-[96px] truncate">{displayName}</span>
            <span className="text-slate-400" aria-hidden="true">
              ·
            </span>
            <span className="text-slate-500">
              {isGoogleSignedIn ? 'Cloud' : 'Local'}
            </span>
          </button>
        </div>
      </header>

      {showIOSGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Install PulseLite on iOS"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
        >
          <div className="w-full max-w-sm rounded-xl bg-white border border-slate-200 p-5 space-y-3">
            <h2 className="text-base font-semibold text-slate-900">
              Install PulseLite on iPhone / iPad
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              1. Tap the <strong>Share</strong> button in Safari&apos;s toolbar.
              <br />
              2. Scroll down and tap <strong>Add to Home Screen</strong>.
            </p>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="w-full h-10 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};
