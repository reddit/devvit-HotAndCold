import React from 'react';
import { GoldIcon } from '@hotandcold/webview-common/components/icon';
import { cn } from '@hotandcold/webview-common/utils';
import { sendMessageToDevvit } from '../utils';

interface PurchaseButtonProps {
  children: React.ReactNode;
  style: 'primary' | 'secondary';
  price: number;
  productSku: 'hardcore-mode-lifetime-access' | 'hardcore-mode-seven-day-access';
}

export const PurchaseButton: React.FC<PurchaseButtonProps> = (props) => {
  const { children, price, productSku, style } = props;

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
        'flex w-full flex-row items-center justify-between gap-4 whitespace-nowrap rounded-full border-2 border-current px-6 py-3 text-center font-sans font-semibold sm:w-auto',
        style === 'primary' ? 'text-mustard-gold' : 'text-slate-gray'
      )}
    >
      <span className="text-left text-base">{children}</span>
      <span
        className={cn(
          'flex w-fit flex-row items-center gap-[6px] rounded-full px-3 py-2 text-xs',
          style === 'primary' ? 'bg-mustard-gold text-black' : 'bg-charcoal text-white'
        )}
      >
        <span className="flex h-4 w-4 items-center justify-center">
          <GoldIcon />
        </span>
        Use {price}
      </span>
    </button>
  );
};
