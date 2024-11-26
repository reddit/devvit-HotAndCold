import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useDevvitListener } from '../hooks/useDevvitListener';
import { GameResponse } from '../shared';
import { useGame } from '../hooks/useGame';
import { cn } from '../utils';
import { useDimensions } from '../hooks/useDimensions';

interface GradientArrowProps {
  /**
   * Width of the arrow line and arrow head in pixels
   * @default 3
   */
  lineWidth?: number;
  /**
   * Start color of the gradient
   * @default "#4CE1F2"
   */
  startColor?: string;
  /**
   * End color of the gradient
   * @default "#DE3232"
   */
  endColor?: string;
}

const GradientArrow: React.FC<GradientArrowProps> = ({
  lineWidth = 3,
  startColor = '#4CE1F2',
  endColor = '#DE3232',
}) => {
  return (
    <div className="relative h-20 w-full">
      {/* Main line */}
      <div
        className="absolute left-0 top-1/2 h-0 w-full"
        style={{
          borderTop: `${lineWidth}px solid`,
          borderImage: `linear-gradient(90deg, ${startColor} 0%, ${endColor} 100%) 1`,
        }}
      />

      {/* Arrow head */}
      <div
        className="absolute right-0 top-1/2 -translate-y-1/2"
        style={{
          width: '20px',
          height: '20px',
          borderTop: `${lineWidth}px solid ${endColor}`,
          borderRight: `${lineWidth}px solid ${endColor}`,
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
  );
};

export const Progress = () => {
  const { challengeProgress } = useGame();
  const [containerRef, containerDimensions] = useDimensions();
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

  const snoovatarWidth = 44;
  const calculatePosition = (progress: number) => {
    const containerWidth = containerDimensions.width;
    if (!containerWidth) return 0;

    const safezoneBuffer = 30;

    // Calculate the base position as a percentage of the container width
    const basePosition = (progress / 100) * containerWidth;

    // Center the avatar by subtracting half its width
    const centeredPosition = basePosition - snoovatarWidth / 2;

    // Calculate a gradual buffer adjustment based on progress
    // At 0%, we want full positive buffer
    // At 50%, we want no buffer
    // At 100%, we want full negative buffer
    const bufferProgress = (progress - 50) / 50; // Will be -1 at 0%, 0 at 50%, and 1 at 100%
    const adjustedBuffer = -safezoneBuffer * bufferProgress;

    return centeredPosition + adjustedBuffer;
  };

  return (
    <div
      ref={containerRef}
      className="relative flex flex-shrink-0 flex-col items-center justify-center"
    >
      {sortedItems.map((item, index) => (
        <motion.div
          key={item.username}
          className="absolute left-0 top-1/2 flex flex-col items-center"
          animate={{
            x: calculatePosition(item.progress),
            zIndex: item.isPlayer ? 50 : 40 - index,
            // rotate: item.isPlayer ? [-5, 5, -5] : 0,
          }}
          initial={{ x: 0 }}
          transition={{
            x: { type: 'spring', stiffness: 100, damping: 20 },
            rotate: { duration: 0.5, repeat: 1 },
          }}
        >
          <div className={`relative flex -translate-y-1/2 flex-col items-center justify-center`}>
            <div
              className={`flex items-center justify-center overflow-hidden rounded-full`}
              style={{
                width: snoovatarWidth,
                height: snoovatarWidth,
              }}
            >
              {item.avatar ? (
                <img
                  src={item.avatar}
                  alt={item.username}
                  className="h-full w-full object-contain"
                />
              ) : (
                <img
                  src={'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_3.png'}
                  alt={item.username}
                  className="width[65%] h-[65%] rounded-full object-contain"
                />
              )}
              <span
                className={cn(
                  'absolute -bottom-5 left-1/2 mt-1 -translate-x-1/2 whitespace-nowrap text-xs font-medium',
                  item.isPlayer && 'text-[#7BF24C]'
                )}
              >
                {item.isPlayer ? '> you <' : item.username}
              </span>
            </div>
          </div>
        </motion.div>
      ))}

      <GradientArrow />
    </div>
  );
};
