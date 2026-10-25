import type { ComponentChildren } from 'preact';

function ToolbarIcon({ children }: { children: ComponentChildren }) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const HelpIcon = () => (
  <ToolbarIcon>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 2-2.5 3.5M12 16.5h.01" />
  </ToolbarIcon>
);
export const ArchiveIcon = () => (
  <ToolbarIcon>
    <rect x="3" y="3" width="18" height="4" rx="1" />
    <path d="M5 7v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7M10 11h4" />
  </ToolbarIcon>
);
export const ShareIcon = () => (
  <ToolbarIcon>
    <path d="M12 16V3m-4 4 4-4 4 4M6 10H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" />
  </ToolbarIcon>
);
export const GearIcon = () => (
  <ToolbarIcon>
    <path
      d="m9 3-.6 2.4-1.7 1L4.3 6 2.8 8.6l1.6 1.8v2l-1.6 1.8 1.5 2.6 2.4-.4 1.7 1L9 20h3l.6-2.6 1.7-1 2.4.4 1.5-2.6-1.6-1.8v-2l1.6-1.8L16.7 6l-2.4.4-1.7-1L12 3Z"
      transform="translate(1.5 .5)"
    />
    <circle cx="12" cy="12" r="3" />
  </ToolbarIcon>
);
export const ActionsIcon = () => (
  <ToolbarIcon>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </ToolbarIcon>
);
export const SpeakerIcon = ({ muted }: { muted: boolean }) => (
  <ToolbarIcon>
    <path d="m11 5-5 4H3v6h3l5 4Z" />
    {muted ? (
      <path d="m17 9 5 6m0-6-5 6" />
    ) : (
      <>
        <path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />
      </>
    )}
  </ToolbarIcon>
);
export const FlameIcon = () => (
  <ToolbarIcon>
    <path d="M12 3c1 4-2 5-2 8 2 0 3-2 3-3 4 4 6 7 3 11-3 4-10 2-10-3 0-3 2-5 3-7 0 2 1 2 1 2" />
  </ToolbarIcon>
);
export const SnowflakeIcon = () => (
  <ToolbarIcon>
    <path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3M3 10l4-1-1-4M21 14l-4 1 1 4M6 19l1-4-4-1M18 5l-1 4 4 1" />
  </ToolbarIcon>
);
