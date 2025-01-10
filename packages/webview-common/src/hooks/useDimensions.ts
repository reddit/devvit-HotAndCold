import { useCallback, useEffect, useState } from 'react';

export const useDimensions = () => {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  const ref = useCallback((nodeElem: HTMLDivElement | null) => {
    setNode(nodeElem);
  }, []);

  useEffect(() => {
    if (!node) return;

    const measure = () => {
      window.requestAnimationFrame(() => {
        setDimensions({
          width: node.clientWidth,
          height: node.clientHeight,
        });
      });
    };

    measure();

    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);

    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [node]);

  return [ref, dimensions] as const;
};
