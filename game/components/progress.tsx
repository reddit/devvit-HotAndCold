import { useEffect, useState, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../utils';
import { useGame } from '../hooks/useGame';
import { GameResponse } from '../shared';
import { useDevvitListener } from '../hooks/useDevvitListener';

interface PlayerProgress {
  username: string;
  progress: number;
  isPlayer: boolean;
  avatar?: string;
}

interface GroupedPlayers {
  count: number;
  progress: number;
  sampleAvatars: string[];
}

interface ProgressProps {
  players: PlayerProgress[];
  maxVisiblePlayers?: number;
  groupThreshold?: number;
  maxStackBubbles?: number;
  avatarSize?: number;
  startColor?: string;
  endColor?: string;
}

const ProgressBar = ({
  players,
  maxVisiblePlayers = 6,
  groupThreshold = 1000,
  maxStackBubbles = 4,
  avatarSize = 40,
  startColor = '#4CE1F2',
  endColor = '#DE3232',
}: ProgressProps) => {
  const [containerRef, setContainerRef] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Persistent player selection
  const selectedPlayersRef = useRef<Set<string>>(new Set());

  // Move the function outside of processedData
  const selectRandomPlayers = (availablePlayers: PlayerProgress[], count: number) => {
    const selected: PlayerProgress[] = [];

    // First, include previously selected players that are still in range
    availablePlayers.forEach((player) => {
      if (selectedPlayersRef.current.has(player.username)) {
        selected.push(player);
      }
    });

    // If we need more players, randomly select new ones
    if (selected.length < count) {
      const remainingPlayers = availablePlayers.filter(
        (player) => !selectedPlayersRef.current.has(player.username)
      );

      // Separate players with and without snoovatars
      const withSnoovatars = remainingPlayers.filter(
        (player) => player.avatar && player.avatar !== '/assets/default_snoovatar.png'
      );
      const withoutSnoovatars = remainingPlayers.filter(
        (player) => !player.avatar || player.avatar === '/assets/default_snoovatar.png'
      );

      // Calculate how many more players we need
      const neededPlayers = count - selected.length;

      // First, select from players with snoovatars
      const selectedWithSnoovatars = withSnoovatars
        .sort(() => Math.random() - 0.5)
        .slice(0, neededPlayers);

      // If we still need more players, select from those without snoovatars
      const remainingNeeded = neededPlayers - selectedWithSnoovatars.length;
      const selectedWithoutSnoovatars =
        remainingNeeded > 0
          ? withoutSnoovatars.sort(() => Math.random() - 0.5).slice(0, remainingNeeded)
          : [];

      // Combine the selections
      const additionalPlayers = [...selectedWithSnoovatars, ...selectedWithoutSnoovatars];

      // Add new players to our persistent selection
      additionalPlayers.forEach((player) => {
        selectedPlayersRef.current.add(player.username);
      });

      selected.push(...additionalPlayers);
    }

    return selected;
  };

  // Update container width on resize
  useEffect(() => {
    if (!containerRef) return;

    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });

    observer.observe(containerRef);
    return () => observer.disconnect();
  }, [containerRef]);

  const processedData = useMemo(() => {
    // Find the active player first
    const activePlayer = players.find((p) => p.isPlayer);
    if (!activePlayer) return { activePlayer: null, groups: [], visiblePlayers: [] };

    const otherPlayers = players.filter((p) => !p.isPlayer);

    // Initialize groups and visible players
    let groups: GroupedPlayers[] = [];
    let visiblePlayers: PlayerProgress[] = [activePlayer];

    // Helper function to create groups
    const createGroup = (players: PlayerProgress[], progressRange: number) => {
      const count = players.length;
      const sampleAvatars = players
        .slice(0, maxStackBubbles)
        .map((p) => p.avatar || '/assets/default_snoovatar.png');

      return {
        count,
        progress: progressRange,
        sampleAvatars,
      };
    };

    // Always try to create groups at the start and end
    const earlyPlayers = otherPlayers.filter((p) => p.progress <= 10);
    if (earlyPlayers.length >= groupThreshold) {
      groups.push(createGroup(earlyPlayers, 5)); // Place at 5% mark
    }

    const completedPlayers = otherPlayers.filter((p) => p.progress === 100);
    if (completedPlayers.length >= groupThreshold) {
      groups.push(createGroup(completedPlayers, 100));
    }

    // Select random players from the middle section (10-100%)
    const midPlayers = otherPlayers.filter((p) => p.progress > 10 && p.progress < 100);
    const selectedPlayers = selectRandomPlayers(midPlayers, maxVisiblePlayers);
    visiblePlayers.push(...selectedPlayers);

    return {
      activePlayer,
      groups,
      visiblePlayers: visiblePlayers.sort((a, b) => {
        if (a.isPlayer) return -1;
        if (b.isPlayer) return 1;
        return b.progress - a.progress;
      }),
    };
  }, [players, maxVisiblePlayers, groupThreshold, maxStackBubbles]);

  const calculatePosition = (progress: number) => {
    if (!containerWidth) return 0;

    const safezoneBuffer = 15;
    const basePosition = (progress / 100) * containerWidth;
    const centeredPosition = basePosition - avatarSize / 2;
    const bufferProgress = (progress - 50) / 50;
    const adjustedBuffer = -safezoneBuffer * bufferProgress;

    return centeredPosition + adjustedBuffer;
  };

  return (
    <div className="relative flex flex-shrink-0 flex-col items-center justify-center">
      {/* Progress arrow first (below other elements) */}
      <div className="relative h-20 w-full">
        <div
          className="absolute left-0 top-1/2 h-0 w-full"
          style={{
            borderTop: '3px solid',
            borderImage: `linear-gradient(90deg, ${startColor} 0%, ${endColor} 100%) 1`,
          }}
        />
        <div
          className="absolute right-0 top-1/2 -translate-y-1/2"
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
          style={{
            width: '18px',
            height: '18px',
            backgroundColor: startColor,
          }}
        />
      </div>

      {/* Container for players and groups */}
      <div ref={setContainerRef} className="absolute left-0 top-0 h-full w-full">
        {/* Render individual players */}
        {processedData.visiblePlayers.map((item, index) => (
          <motion.div
            key={item.username}
            className="absolute left-0 top-1/2 flex flex-col items-center"
            animate={{
              x: calculatePosition(item.progress),
              zIndex: item.isPlayer ? 50 : 40 - index,
            }}
            initial={{ x: 0 }}
            transition={{
              x: { type: 'spring', stiffness: 100, damping: 20 },
            }}
          >
            <div className="relative flex -translate-y-1/2 flex-col items-center justify-center">
              <div
                className="flex items-center justify-center overflow-hidden rounded-full"
                style={{
                  width: avatarSize,
                  height: avatarSize,
                }}
              >
                <img
                  src={item.avatar || '/assets/default_snoovatar.png'}
                  alt={item.username}
                  className="h-full w-full object-contain"
                />
              </div>
              <span
                className={cn(
                  'absolute -bottom-5 left-1/2 mt-1 -translate-x-1/2 whitespace-nowrap text-xs font-medium text-[#8BA2AD]',
                  item.isPlayer && 'font-semibold text-[#7BF24C]'
                )}
              >
                {item.isPlayer ? '> you <' : <span>&nbsp;</span>}
              </span>
            </div>
          </motion.div>
        ))}

        {/* Render grouped players - Updated positioning */}
        {processedData.groups.map((group, index) => (
          <motion.div
            key={`group-${index}`}
            className="absolute left-0 top-1/2 flex flex-col items-center"
            animate={{
              x: calculatePosition(group.progress),
              zIndex: 30 - index,
            }}
            initial={{ x: 0 }}
            transition={{
              x: { type: 'spring', stiffness: 100, damping: 20 },
            }}
          >
            <div className="relative flex -translate-y-1/2 flex-col items-center justify-center">
              {/* Stacked avatars with removed white background */}
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
              {/* Player count below avatars */}
              <span className="absolute -bottom-11 left-1/2 mt-1 -translate-x-1/2 whitespace-nowrap text-xs font-medium text-[#8BA2AD]">
                {`${group.count.toLocaleString()} players`}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export const Progress = () => {
  const { challengeProgress } = useGame();
  const [progress, setProgress] = useState<GameResponse['challengeProgress'] | null>(null);
  const progressUpdate = useDevvitListener('PLAYER_PROGRESS_UPDATE');

  useEffect(() => {
    if (challengeProgress) {
      setProgress(challengeProgress);
    }
  }, [challengeProgress]);

  useEffect(() => {
    if (progressUpdate) {
      setProgress(progressUpdate.challengeProgress);
    }
  }, [progressUpdate]);

  const sortedItems = (progress ?? [])
    .filter((x) => x.progress > -1)
    .sort((a, b) => {
      if (a.isPlayer) return -1;
      if (b.isPlayer) return 1;
      return b.progress - a.progress;
    });

  return (
    <ProgressBar
      players={sortedItems.map((x) => ({
        ...x,
        avatar: x.avatar || '/assets/default_snoovatar.png',
      }))}
    />
  );
};
