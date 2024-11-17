import { MotionValue, motion, useSpring, useTransform } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

function getTimerConfig(size: number = 18) {
  return {
    fontSize: size,
    padding: size * 0.22,
    height: size * 1.22,
    digitWidth: size * 0.7,
    spacing: size * 0.3,
  };
}

const useElapsedTime = (startTime: number, maxValue?: number) => {
  const initialElapsed = useRef<number | null>(null);

  const [elapsed, setElapsed] = useState(() => {
    if (initialElapsed.current === null) {
      const initial = Math.floor((Date.now() - startTime) / 1000);
      initialElapsed.current = maxValue ? Math.min(initial, maxValue) : initial;
    }
    return initialElapsed.current;
  });

  useEffect(() => {
    if (initialElapsed.current === null) {
      const initial = Math.floor((Date.now() - startTime) / 1000);
      initialElapsed.current = maxValue ? Math.min(initial, maxValue) : initial;
      setElapsed(initialElapsed.current);
    }

    const interval = setInterval(() => {
      const currentElapsed = Math.floor((Date.now() - startTime) / 1000);
      if (!maxValue || currentElapsed <= maxValue) {
        setElapsed(maxValue ? Math.min(currentElapsed, maxValue) : currentElapsed);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime, maxValue]);

  return elapsed;
};

interface TimerProps {
  startTime: number;
  maxValue?: number;
  size?: number;
  className?: string;
}

export function Timer({ startTime, maxValue, size = 18, className = '' }: TimerProps) {
  const value = useElapsedTime(startTime, maxValue);
  const config = getTimerConfig(size);

  return (
    <div
      style={{
        fontSize: config.fontSize,
      }}
      className={`flex overflow-hidden rounded px-2 leading-none ${className}`}
    >
      <div className="flex" style={{ gap: config.spacing }}>
        <Digit place={1000} value={value} config={config} />
        <Digit place={100} value={value} config={config} />
        <Digit place={10} value={value} config={config} />
        <Digit place={1} value={value} config={config} />
      </div>
    </div>
  );
}

interface DigitProps {
  place: number;
  value: number;
  config: ReturnType<typeof getTimerConfig>;
}

function Digit({ place, value, config }: DigitProps) {
  let valueRoundedToPlace = Math.floor(value / place);
  let animatedValue = useSpring(valueRoundedToPlace);

  useEffect(() => {
    animatedValue.set(valueRoundedToPlace);
  }, [animatedValue, valueRoundedToPlace]);

  return (
    <div
      style={{
        height: config.height,
        width: config.digitWidth,
      }}
      className="relative tabular-nums"
    >
      {[...Array(10).keys()].map((i) => (
        <Number key={i} mv={animatedValue} number={i} config={config} />
      ))}
    </div>
  );
}

interface NumberProps {
  mv: MotionValue;
  number: number;
  config: ReturnType<typeof getTimerConfig>;
}

function Number({ mv, number, config }: NumberProps) {
  let y = useTransform(mv, (latest) => {
    let placeValue = latest % 10;
    let offset = (10 + number - placeValue) % 10;
    let memo = offset * config.height;

    if (offset > 5) {
      memo -= 10 * config.height;
    }

    return memo;
  });

  return (
    <motion.span style={{ y }} className="absolute inset-0 flex items-center justify-center">
      {number}
    </motion.span>
  );
}
