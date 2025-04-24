import React from 'react';
import { HardcoreLogo } from '@hotandcold/webview-common/components/logo';
import { GoldIcon } from '@hotandcold/webview-common/components/icon';
import { cn } from '@hotandcold/webview-common/utils';

interface PurchaseButtonProps {
  children: React.ReactNode;
  style: 'primary' | 'secondary';
  price: number;
  onClick?: () => void;
}

const PurchaseButton: React.FC<PurchaseButtonProps> = (props) => {
  const { children, price, onClick, style } = props;

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full flex-row items-center justify-between gap-4 whitespace-nowrap rounded-full border-2 border-current p-3 text-center font-sans sm:w-auto',
        style === 'primary' ? 'border-mustard-gold text-mustard-gold' : 'border-slate-gray text-slate-gray'
      )}
    >
      <span className="text-left text-base font-semibold">{children}</span>
      <span
        className={cn(
          'flex w-fit flex-row items-center gap-1 rounded-full px-3 py-2 text-xs font-semibold',
          style === 'primary' ? 'bg-mustard-gold text-black' : 'bg-charcoal text-white'
        )}
      >
        <span className="h-4 w-4">
          <GoldIcon />
        </span>
        Use {price}
      </span>
    </button>
  );
};

export const UnlockHardcorePage: React.FC = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-night p-4 text-center font-sans">
      <div className="flex w-full max-w-md flex-col items-center justify-center gap-4 p-6 sm:gap-6 sm:p-8 md:max-w-2xl md:p-10">
        <HardcoreLogo />
        <p className="text-xl font-bold text-white sm:text-2xl">100 guesses. No hints. No mercy.</p>
        <p className="text-sm font-normal text-gray-300">
          Unlocking Hardcore grants access to today and all previous hardcore puzzles.
        </p>
        <hr className="h-px w-1/2 max-w-xs bg-white/20"></hr>
        <div className="flex w-full flex-col items-center gap-4 py-2 sm:w-auto sm:flex-row sm:items-start">
          <PurchaseButton price={50} style="secondary">
            Unlock for 7 days
          </PurchaseButton>
          <PurchaseButton price={250} style="primary">
            Unlock FOREVER
          </PurchaseButton>
        </div>
      </div>
    </div>
  );
};
