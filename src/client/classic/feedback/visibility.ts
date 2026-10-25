/** Combine iframe clipping, Reddit's visibility events, and browser focus. */
export function watchGameVisibility(onChange: (visible: boolean) => void) {
  let intersecting = typeof IntersectionObserver === 'undefined';
  let focused = true;
  const update = () => onChange(intersecting && focused && document.visibilityState === 'visible');
  const observer =
    typeof IntersectionObserver === 'undefined'
      ? undefined
      : new IntersectionObserver(
          (entries) => {
            const entry = entries.find((item) => item.target === document.documentElement);
            if (!entry) return;
            intersecting = entry.isIntersecting && entry.intersectionRatio > 0;
            update();
          },
          { threshold: [0, 0.01] }
        );
  const blur = () => {
    focused = false;
    update();
  };
  const focus = () => {
    focused = true;
    update();
  };
  observer?.observe(document.documentElement);
  document.addEventListener('visibilitychange', update);
  window.addEventListener('blur', blur);
  window.addEventListener('focus', focus);
  window.addEventListener('pagehide', blur);
  window.addEventListener('pageshow', focus);
  update();
  return () => {
    observer?.disconnect();
    document.removeEventListener('visibilitychange', update);
    window.removeEventListener('blur', blur);
    window.removeEventListener('focus', focus);
    window.removeEventListener('pagehide', blur);
    window.removeEventListener('pageshow', focus);
    onChange(false);
  };
}
