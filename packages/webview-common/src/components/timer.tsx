import { MotionValue, motion, useSpring, useTransform } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

function getConfig(size = 18) {
  return {
    fontSize: size,
    padding: size * 0.22,
    height: size * 1.22,
    digitWidth: size * 0.62,
    spacing: 0,
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
  const config = getConfig(size);

  return (
    <div
      style={{
        fontSize: config.fontSize,
      }}
      className={`flex overflow-hidden rounded leading-none ${className}`}
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

interface AnimatedNumberProps {
  value: number;
  size?: number;
  className?: string;
}

export const AnimatedNumber = ({
  value,
  size = 18,
  className = '',
  animateOnMount = false,
}: AnimatedNumberProps & { animateOnMount?: boolean }) => {
  const [displayValue, setDisplayValue] = useState(animateOnMount ? 0 : value);

  useEffect(() => {
    if (animateOnMount && displayValue !== value) {
      const startTime = Date.now();
      const startValue = 0;
      const duration = 1000;

      const animate = () => {
        const now = Date.now();
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeOutQuart = 1 - Math.pow(1 - progress, 4);
        const current = Math.round(startValue + (value - startValue) * easeOutQuart);

        setDisplayValue(current);

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };

      requestAnimationFrame(animate);
    } else {
      setDisplayValue(value);
    }
  }, [value, animateOnMount]);

  // Calculate digits based on final value, not display value
  const numDigits = Math.max(Math.floor(Math.log10(Math.abs(value))) + 1, 1);
  const config = getConfig(size);
  const places = Array.from({ length: numDigits }, (_, i) => Math.pow(10, numDigits - 1 - i));

  return (
    <div
      style={{
        fontSize: config.fontSize,
      }}
      className={`flex overflow-hidden rounded leading-none ${className}`}
    >
      <div className="flex" style={{ gap: config.spacing }}>
        {places.map((place, index) => (
          <Digit key={index} place={place} value={displayValue} config={config} />
        ))}
      </div>
    </div>
  );
};

interface DigitProps {
  place: number;
  value: number;
  config: ReturnType<typeof getConfig>;
}

function Digit({ place, value, config }: DigitProps) {
  const valueRoundedToPlace = Math.floor(value / place);
  const animatedValue = useSpring(valueRoundedToPlace);

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
  config: ReturnType<typeof getConfig>;
}

function Number({ mv, number, config }: NumberProps) {
  const y = useTransform(mv, (latest) => {
    const placeValue = latest % 10;
    const offset = (10 + number - placeValue) % 10;
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
