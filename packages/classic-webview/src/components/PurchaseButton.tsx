import React from 'react';
import { GoldIcon } from '@hotandcold/webview-common/components/icon';
import { cn } from '@hotandcold/webview-common/utils';
import { sendMessageToDevvit } from '../utils';

interface PurchaseButtonProps {
  children: React.ReactNode;
  style: 'primary' | 'secondary';
  price: number;
  productSku: 'hardcore-mode-lifetime-access' | 'hardcore-mode-seven-day-access';
  shortText: string;
}

export const PurchaseButton: React.FC<PurchaseButtonProps> = (props) => {
  const { children, price, productSku, style, shortText } = props;

  const onClick = () => {
    sendMessageToDevvit({
      type: 'PURCHASE_PRODUCT',
      payload: {
        sku: productSku,
      },
    });
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full min-w-0 cursor-pointer flex-row items-center justify-between gap-4 rounded-full border-2 border-current p-3 text-center font-sans font-semibold sm:w-auto sm:px-6',
        style === 'primary' ? 'text-mustard-gold' : 'text-slate-gray'
      )}
    >
      <span className="xs:block hidden truncate text-left text-base">{children}</span>
      <span className="xs:hidden block text-left text-base">{shortText}</span>
      <span
        className={cn(
          'flex flex-none flex-row items-center gap-1 rounded-full p-2 text-xs sm:gap-[6px] sm:px-3',
          style === 'primary' ? 'bg-mustard-gold text-black' : 'bg-charcoal text-white'
        )}
      >
        <span className="flex h-4 w-4 items-center justify-center">
          <GoldIcon />
        </span>
        <span className="whitespace-nowrap">Use {price}</span>
      </span>
    </button>
  );
};
