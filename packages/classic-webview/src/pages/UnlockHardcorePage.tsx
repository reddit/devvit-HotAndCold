import React from 'react';
import { HardcoreLogo } from '@hotandcold/webview-common/components/logo';

export const UnlockHardcorePage: React.FC = () => {
  return (
    <>
      <div className="flex h-[512px] w-[756px] flex-col items-center justify-center gap-6 px-16 py-20">
        <HardcoreLogo />
        <p className="font-sans text-2xl font-bold leading-7 tracking-normal text-white">
          100 guesses. No hints. No mercy.
        </p>
        <p className="text-center font-sans text-sm font-normal leading-5 tracking-tight text-[#EEF1F3]">
          Unlocking Hardcore grants access to today and all previous hardcore puzzles.
        </p>
        <div className="h-px w-[200px] bg-white/20"></div>
        <div className="flex items-start gap-4 py-2">
          <button className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
            Unlock for 7 days
          </button>
          <button className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
            Unlock for 7 days
          </button>
        </div>
      </div>
    </>
  );
};

// Default export is often helpful for page components
export default UnlockHardcorePage;
