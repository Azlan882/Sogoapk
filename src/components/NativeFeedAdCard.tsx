import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import {
  isNativeAdSupported,
  attachHomeNativeSlot,
  detachHomeNativeSlot,
  subscribeNativeSlot,
  NativeSlotStatus,
} from '../services/nativeAdService';

export interface NativeFeedAdCardProps {
  slotKey: string;
}

export const NativeFeedAdCard: React.FC<NativeFeedAdCardProps> = ({ slotKey }) => {
  const adContainerRef = useRef<HTMLDivElement | null>(null);
  const isSupported = isNativeAdSupported();
  const [slotStatus, setSlotStatus] = useState<NativeSlotStatus>('idle');

  // Track the ad load status (idle -> loading -> loaded | failed)
  useEffect(() => {
    const unsubscribe = subscribeNativeSlot(slotKey, (record) => {
      setSlotStatus(record.status);
    });
    return unsubscribe;
  }, [slotKey]);

  // Attach DOM element for measurement and native overlay placement
  useEffect(() => {
    const el = adContainerRef.current;
    if (!el || !isSupported) return;

    void attachHomeNativeSlot(slotKey, el);

    return () => {
      detachHomeNativeSlot(el);
    };
  }, [slotKey, isSupported]);

  // If loading fails (e.g. no fill, offline, or request error):
  // COLLAPSE THE SLOT COMPLETELY — no empty blank space or phantom box in the feed.
  if (slotStatus === 'failed') {
    return null;
  }

  // Non-native environments (browser preview): collapse so no blank space is left
  if (!isSupported) {
    return null;
  }

  const isLoaded = slotStatus === 'loaded';

  return (
    <article
      data-native-ad-slot={slotKey}
      data-slot-status={slotStatus}
      className={`transition-all duration-300 ${
        isLoaded
          ? 'bg-slate-900 rounded-2xl border border-slate-800 p-4 shadow-sm'
          : 'opacity-0 h-[320px] pointer-events-none'
      }`}
    >
      {/* Show Google-compliant Sponsored labeling ONLY when the ad is confirmed loaded */}
      {isLoaded && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-slate-800 text-cyan-400 border border-cyan-500/20">
              Sponsored
            </span>
            <span className="text-xs font-semibold text-slate-300">
              Promoted
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-500 text-[11px] font-medium">
            <Sparkles className="w-3 h-3 text-cyan-400/80" />
            <span>Ad</span>
          </div>
        </div>
      )}

      {/*
        Native Ad Slot Container:
        Required to be mounted with height >= 300px for NativeAdFeed's geometry validation.
        When loaded, the Android native view overlays directly on top of this element.
      */}
      <div
        ref={adContainerRef}
        className="w-full min-h-[300px] h-[320px] rounded-xl overflow-hidden relative"
      />
    </article>
  );
};
