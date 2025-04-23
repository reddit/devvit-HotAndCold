import React from 'react';
import { HardcoreLogo } from '@hotandcold/webview-common/components/logo';
import { GoldIcon } from '@hotandcold/webview-common/components/icon';

const primaryBorderColor = '#FFBF0B';
const secondaryBorderColor = '#8BA2AD';
const secondaryPillBgColor = '#2A3236';

// Inline PurchaseButton component
interface PurchaseButtonProps {
  mainText: string;
  style: 'primary' | 'secondary';
  badgeIcon: React.ReactNode;
  badgeText: string;
  onClick?: () => void;
}

const PurchaseButton: React.FC<PurchaseButtonProps> = (props) => {
  const { mainText, badgeIcon, badgeText, onClick, style } = props;
  const color = style === 'primary' ? primaryBorderColor : secondaryBorderColor;
  const pillBg = style === 'secondary' ? secondaryPillBgColor : color;
  const pillTextColor = style === 'secondary' ? 'white' : 'black';

  return (
    <button
      onClick={onClick}
      className="flex w-full flex-auto flex-row items-center justify-between gap-4 whitespace-nowrap rounded-[64px] border-2 p-3 sm:w-auto"
      style={{ borderColor: color }}
    >
      <span
        className="text-left font-sans text-base font-semibold leading-5 tracking-tight"
        style={{ color }}
      >
        {mainText}
      </span>
      <span
        className="flex h-8 w-fit flex-row items-center gap-1 rounded-full px-3 py-2 text-xs font-semibold"
        style={{ backgroundColor: pillBg, color: pillTextColor }}
      >
        <span className="h-4 w-4">{badgeIcon}</span>
        <span className="text-center leading-4 tracking-[-0.1px]">{badgeText}</span>
      </span>
    </button>
  );
};

export const UnlockHardcorePage: React.FC = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0E1113] p-4 text-center">
      <div className="flex w-full max-w-md flex-col items-center justify-center gap-4 rounded-lg bg-[#0E1113] p-6 shadow-lg sm:gap-6 sm:p-8 md:max-w-2xl md:p-10">
        <HardcoreLogo />
        <p className="font-sans text-xl font-bold leading-tight tracking-normal text-white sm:text-2xl sm:leading-7">
          100 guesses. No hints. No mercy.
        </p>
        <p className="text-center font-sans text-sm font-normal leading-5 tracking-tight text-gray-300">
          Unlocking Hardcore grants access to today and all previous hardcore puzzles.
        </p>
        <div className="h-px w-1/2 max-w-xs bg-white/20"></div>
        <div className="flex w-full flex-col items-center gap-4 py-2 sm:w-auto sm:flex-row sm:items-start">
          <PurchaseButton
            mainText="Unlock for 7 days"
            badgeIcon={<GoldIcon />}
            badgeText="Use 50"
            style="secondary"
          />
          <PurchaseButton
            mainText="Unlock FOREVER"
            badgeIcon={<GoldIcon />}
            badgeText="Use 250"
            style="primary"
          />
        </div>
      </div>
    </div>
  );
};

// Default export is often helpful for page components
export default UnlockHardcorePage;
