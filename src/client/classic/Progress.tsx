import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { GuessEngine } from '../core/guessEngine';
import { getNearestPlayersByStartTime, PlayerProgress } from '../core/challengeProgress';
import { PROGRESS_POLL_TTL_SECONDS } from '../../shared/config';
import { rankToProgress } from '../../shared/progress';
import { trpc } from '../trpc';
import posthog from 'posthog-js';

type GroupedPlayers = {
  count: number;
  progress: number;
  sampleAvatars: string[];
};

type ProgressProps = {
  challengeNumber: number;
  engine: GuessEngine;
  avatarSize?: number;
  startColor?: string;
  middleColor?: string;
  endColor?: string;
};

const DEFAULT_AVATAR = '/assets/default_snoovatar.png';

export function ProgressBar({
  challengeNumber,
  engine,
  avatarSize = 40,
  startColor = '#4CE1F2',
  middleColor = '#FED155',
  endColor = '#DE3232',
}: ProgressProps) {
  // container width for positioning
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(w);
    });
    ro.observe(el);
    // initial measure
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // server neighbors (cached / polled)
  const [neighbors, setNeighbors] = useState<PlayerProgress[]>([]);
  const stopPollingRef = useRef<() => void>();

  // current user avatar – fetched immediately, non-blocking
  const [meAvatar, setMeAvatar] = useState<string | undefined>(undefined);
  const [meLoaded, setMeLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await trpc.user.me.query();
        if (!cancelled) setMeAvatar(me.snoovatar);
      } catch {
        // ignore; fallback handled in render
      } finally {
        if (!cancelled) setMeLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll neighbors every shared TTL seconds
  useEffect(() => {
    let abort = false;
    const fetchOnce = async () => {
      try {
        const res = await getNearestPlayersByStartTime({
          challengeNumber,
          windowBefore: 15,
          windowAfter: 15,
        });
        if (!abort) setNeighbors(res);
      } catch {
        // ignore
      }
    };
    void fetchOnce();
    const interval = setInterval(fetchOnce, PROGRESS_POLL_TTL_SECONDS * 1000);
    stopPollingRef.current = () => clearInterval(interval);
    return () => {
      abort = true;
      clearInterval(interval);
    };
  }, [challengeNumber]);

  // local player progress from guess history – update immediately
  const localPlayerProgress = useMemo(() => {
    const hist = engine.history.value ?? [];
    // Pick best (lowest) non-hint rank available; fallback to 0
    const bestRank = hist
      .filter((h) => Number.isFinite(h.rank) && h.rank >= 0)
      .reduce<number>(
        (minRank, h) => (h.rank < minRank ? h.rank : minRank),
        Number.POSITIVE_INFINITY
      );
    const pct = Number.isFinite(bestRank) ? Math.round(rankToProgress(bestRank)) : 0;
    return Math.max(0, Math.min(100, pct));
  }, [engine.history.value]);

  // Merge local player progress into neighbors (without mutating server cached peers)
  const mergedPlayers = useMemo<PlayerProgress[]>(() => {
    const list = neighbors.slice();
    const meIdx = list.findIndex((p) => p.isPlayer);
    if (meIdx >= 0) {
      const current = list[meIdx]!;
      const updated: PlayerProgress = {
        username: current.username,
        isPlayer: current.isPlayer,
        progress: localPlayerProgress,
        // Prefer fetched snoovatar when available; otherwise preserve
        avatar: meLoaded
          ? (meAvatar ?? current.avatar ?? DEFAULT_AVATAR)
          : (current.avatar ?? DEFAULT_AVATAR),
      };
      list[meIdx] = updated;
    } else {
      // If server didn't include the player yet, create a local stub
      const stub: PlayerProgress = {
        username: 'you',
        isPlayer: true,
        progress: localPlayerProgress,
        avatar: meLoaded ? (meAvatar ?? DEFAULT_AVATAR) : DEFAULT_AVATAR,
      };
      list.unshift(stub);
    }
    // Do not force a default here; let render decide so we can hide the player's avatar until loaded
    return list.map(
      (p): PlayerProgress => ({
        username: p.username,
        isPlayer: p.isPlayer,
        progress: p.progress,
        avatar: p.avatar ?? DEFAULT_AVATAR,
      })
    );
  }, [neighbors, localPlayerProgress, meAvatar, meLoaded]);

  // Render exactly what the server sends (neighbors around current user),
  // with the single override that the local player's progress is updated from local history.
  const processed = useMemo(() => {
    const active = mergedPlayers.find((p) => p.isPlayer) ?? null;
    const groups: GroupedPlayers[] = [];
    const visiblePlayers = mergedPlayers.slice().sort((a, b) => {
      if (a.isPlayer) return -1;
      if (b.isPlayer) return 1;
      return b.progress - a.progress;
    });
    return { activePlayer: active, groups, visiblePlayers };
  }, [mergedPlayers]);

  const calculatePositionPx = (progress: number) => {
    if (!containerWidth) return 0;
    const safezoneBuffer = 15;
    const base = (progress / 100) * containerWidth;
    const centered = base - avatarSize / 2;
    const bufferProgress = (progress - 50) / 50;
    const adjustedBuffer = -safezoneBuffer * bufferProgress;
    return centered + adjustedBuffer;
  };

  return (
    <div className="relative flex flex-shrink-0 flex-col items-center justify-center">
      {/* Progress arrow first (below other elements) */}
      <div className="relative h-[30px] w-full">
        <div
          className="absolute left-0 h-0 w-full"
          style={{
            top: 'calc(50% - 1.5px)',
            borderTop: '3px solid',
            borderImage: `linear-gradient(90deg, ${startColor} 0%, ${middleColor} 40%, ${middleColor} 80%, ${endColor} 100%) 1`,
          }}
        />
        <div
          className="absolute right-0 top-1/2"
          style={{
            width: '20px',
            height: '20px',
            borderTop: `3px solid ${endColor}`,
            borderRight: `3px solid ${endColor}`,
            transform: 'translate(0, -50%) rotate(45deg)',
          }}
        />
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full"
          style={{ width: '18px', height: '18px', backgroundColor: startColor }}
        />
      </div>

      {/* Container for players and groups */}
      <div
        ref={containerRef}
        className="absolute left-0 top-0 h-full w-full"
        onClick={() => {
          posthog.capture('Progress Bar Clicked');
        }}
      >
        {/* Render individual players */}
        {processed.visiblePlayers.map((item, index) => {
          if (item.isPlayer && !meLoaded) return null; // hide until user info fetched
          return (
            <div
              key={item.username}
              className="absolute left-0 top-1/2 flex flex-col items-center"
              style={{
                transform: `translateX(${calculatePositionPx(item.progress)}px)`,
                zIndex: item.isPlayer ? 50 : 40 - index,
                transition: 'transform 500ms cubic-bezier(0.2, 0.8, 0.2, 1)',
              }}
            >
              <div className="relative flex -translate-y-1/2 flex-col items-center justify-center">
                <div
                  className="flex items-center justify-center overflow-hidden rounded-full"
                  style={{ width: avatarSize, height: avatarSize }}
                >
                  <img
                    src={item.isPlayer ? meAvatar || DEFAULT_AVATAR : item.avatar || DEFAULT_AVATAR}
                    alt={item.username}
                    className="h-full w-full object-contain"
                  />
                </div>
                <span
                  className={[
                    'absolute -bottom-5 left-1/2 mt-1 -translate-x-1/2 whitespace-nowrap text-xs font-medium text-transparent',
                    item.isPlayer ? 'font-semibold text-[#7BF24C]' : '',
                  ].join(' ')}
                >
                  {item.isPlayer ? '> you <' : item.username}
                </span>
              </div>
            </div>
          );
        })}

        {/* Render grouped players */}
        {processed.groups.map((group, index) => (
          <div
            key={`group-${index}`}
            className="absolute left-0 top-1/2 flex flex-col items-center"
            style={{
              transform: `translateX(${calculatePositionPx(group.progress)}px)`,
              zIndex: 30 - index,
              transition: 'transform 500ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            }}
          >
            <div className="relative flex -translate-y-1/2 flex-col items-center justify-center">
              <div className="relative flex items-center justify-center">
                {group.sampleAvatars.map((avatar, i) => (
                  <div
                    key={i}
                    className="absolute rounded-full"
                    style={{
                      width: avatarSize,
                      height: avatarSize,
                      left: i * -(avatarSize * 0.3),
                      zIndex: group.sampleAvatars.length - i,
                    }}
                  >
                    <img
                      src={avatar}
                      alt="grouped player"
                      className="h-full w-full rounded-full object-contain"
                    />
                  </div>
                ))}
              </div>
              <span className="absolute -bottom-11 left-1/2 mt-1 -translate-x-1/2 whitespace-nowrap text-xs font-medium text-[#8BA2AD]">
                {`${group.count.toLocaleString()} players`}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Progress(props: ProgressProps) {
  return <ProgressBar {...props} />;
}
