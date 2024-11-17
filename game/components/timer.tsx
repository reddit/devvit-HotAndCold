import { MotionValue, motion, useSpring, useTransform } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

const fontSize = 30;
const padding = 15;
const height = fontSize + padding;

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

export function Timer({ startTime, maxValue }: { startTime: number; maxValue?: number }) {
  const value = useElapsedTime(startTime, maxValue);

  return (
    <div style={{ fontSize }} className="flex space-x-3 overflow-hidden rounded px-2 leading-none">
      <Digit place={1000} value={value} />
      <Digit place={100} value={value} />
      <Digit place={10} value={value} />
      <Digit place={1} value={value} />
    </div>
  );
}

function getDigitAtPlace(value: number, place: number) {
  return Math.floor((value % (place * 10)) / place);
}

function Digit({ place, value }: { place: number; value: number }) {
  // Extract the digit at the current place value
  const digit = getDigitAtPlace(value, place);
  const animatedValue = useSpring(digit);

  useEffect(() => {
    animatedValue.set(digit);
  }, [animatedValue, digit]);

  return (
    <div style={{ height }} className="relative w-[1ch] tabular-nums text-white">
      {[...Array(10).keys()].map((i) => (
        <Number key={i} mv={animatedValue} number={i} />
      ))}
    </div>
  );
}

function Number({ mv, number }: { mv: MotionValue; number: number }) {
  let y = useTransform(mv, (latest) => {
    // Calculate the offset based on the current number and target number
    let offset = (10 + number - latest) % 10;

    let memo = offset * height;

    // Optimize the animation path by taking the shorter route
    if (offset > 5) {
      memo -= 10 * height;
    }

    return memo;
  });

  return (
    <motion.span style={{ y }} className="absolute inset-0 flex items-center justify-center">
      {number}
    </motion.span>
  );
}
