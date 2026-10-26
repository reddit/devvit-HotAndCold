import { useId } from 'preact/hooks';

/** Static decorative art; the result heading already describes the outcome. */
export function ResultArtwork({ didWin, className = '' }: { didWin: boolean; className?: string }) {
  const id = useId();
  return (
    <svg
      aria-hidden="true"
      data-result-art={didWin ? 'hot' : 'cold'}
      viewBox="0 0 128 128"
      fill="none"
      className={`pointer-events-none block h-24 w-24 shrink-0 select-none ${className}`}
    >
      <defs>
        <radialGradient id={`${id}-halo`}>
          <stop stop-color={didWin ? '#fff7d6' : '#e0faff'} stop-opacity="0.8" />
          <stop offset="1" stop-color={didWin ? '#fb923c' : '#38bdf8'} stop-opacity="0" />
        </radialGradient>
        <linearGradient
          id={`${id}-body`}
          x1="64"
          y1="12"
          x2="64"
          y2="114"
          gradientUnits="userSpaceOnUse"
        >
          <stop stop-color={didWin ? '#ffcc46' : '#e0faff'} />
          <stop offset="0.55" stop-color={didWin ? '#ff8b20' : '#7dd3fc'} />
          <stop offset="1" stop-color={didWin ? '#ea3b16' : '#0284c7'} />
        </linearGradient>
        <linearGradient
          id={`${id}-core`}
          x1="64"
          y1="60"
          x2="64"
          y2="110"
          gradientUnits="userSpaceOnUse"
        >
          <stop stop-color="#fff7ce" />
          <stop offset="1" stop-color="#ffd257" />
        </linearGradient>
      </defs>
      <circle cx="64" cy="64" r="61" fill={`url(#${id}-halo)`} />
      <ellipse
        cx="64"
        cy="116"
        rx="27"
        ry="5"
        fill={didWin ? '#c2410c' : '#0369a1'}
        opacity="0.14"
      />
      {didWin ? (
        <>
          <path
            d="M67 12c7 25 33 36 33 65a36 36 0 0 1-72 0c0-18 10-31 23-43-1 12 4 20 12 24 10-13 13-27 4-46Z"
            fill={`url(#${id}-body)`}
            stroke="#c2410c"
            stroke-width="1.5"
            stroke-linejoin="round"
          />
          <path
            d="M67 58c3 16 16 22 16 35a19 19 0 0 1-38 0c0-9 5-17 12-24 0 8 3 13 7 15 5-7 6-16 3-26Z"
            fill={`url(#${id}-core)`}
          />
          <path
            d="M44 63c-6 7-9 15-8 22"
            stroke="#ffdd8b"
            stroke-width="4"
            stroke-linecap="round"
            opacity="0.8"
          />
          <path d="m104 27 2.5 6.5L113 36l-6.5 2.5L104 45l-2.5-6.5L95 36l6.5-2.5Z" fill="#f59e0b" />
          <path d="m24 42 1.5 4.5L30 48l-4.5 1.5L24 54l-1.5-4.5L18 48l4.5-1.5Z" fill="#ea580c" />
          <circle cx="95" cy="17" r="2.5" fill="#f59e0b" />
        </>
      ) : (
        <>
          <path
            d="m64 13 37 24 10 39-28 36H43L17 76l10-39Z"
            fill={`url(#${id}-body)`}
            stroke="#0284c7"
            stroke-width="1.5"
            stroke-linejoin="round"
          />
          <path d="m64 13 1 49-38-25Z" fill="white" opacity="0.65" />
          <path d="m64 13 37 24-36 25Z" fill="#cffafe" opacity="0.7" />
          <path d="m27 37 38 25-48 14Z" fill="#bae6fd" opacity="0.6" />
          <path d="m65 62 18 50H43Z" fill="#0ea5e9" opacity="0.55" />
          <path d="m65 62 46 14-28 36Z" fill="#0369a1" opacity="0.2" />
          <path d="m65 62 36-25 10 39Z" fill="#e0f2fe" opacity="0.35" />
          <path
            d="M64 42v42M46 53l36 20M46 73l36-20M59 46l5 5 5-5M59 80l5-5 5 5M46 59l7-2-1-7M82 67l-7 2 1 7M52 76l1-7-7-2M76 50l-1 7 7 2"
            stroke="white"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path d="m105 17 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#0284c7" />
          <path d="m20 91 1.5 4.5L26 97l-4.5 1.5L20 103l-1.5-4.5L14 97l4.5-1.5Z" fill="#38bdf8" />
          <circle cx="19" cy="27" r="2.5" fill="#0ea5e9" />
        </>
      )}
    </svg>
  );
}
