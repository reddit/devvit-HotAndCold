import { useCallback, useEffect, useState } from 'preact/hooks';

/**
 * Measures the rendered width/height of a div via a callback ref.
 * Returns [ref, dimensions, reMeasure].
 */
export const useDimensions = () => {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  const ref = useCallback((nodeElem: HTMLDivElement | null) => {
    setNode(nodeElem);
  }, []);

  const measure = () => {
    window.requestAnimationFrame(() => {
      setDimensions({
        width: node?.clientWidth ?? 0,
        height: node?.clientHeight ?? 0,
      });
    });
  };

  useEffect(() => {
    if (!node) return;
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [node]);

  const reMeasure = () => {
    if (!node) return;
    measure();
  };

  return [ref, dimensions, reMeasure] as const;
};
