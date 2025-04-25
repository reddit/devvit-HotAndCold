import { ReactNode } from 'react';
import { cn } from '../utils';

interface GradientBorderProps {
  children: ReactNode;
  isHidden?: boolean;
}

export const GradientBorder = ({ children, isHidden = false }: GradientBorderProps) => {
  return (
    <span className="relative inline-flex h-full w-full overflow-hidden rounded-[inherit] bg-inherit p-0.5">
      <span
        className={cn(
          'absolute inset-[-1000%] animate-[spin_2s_linear_infinite] rounded-[inherit] bg-[conic-gradient(from_135deg_at_50%_50%,#4CE1F2_0%,#FFBF0B_33%,#DE3232_66%,#4CE1F2_100%)] transition-opacity duration-300',
          isHidden ? 'opacity-0' : 'opacity-100'
        )}
      />
      <span className="z-10 inline-block rounded-[inherit] bg-inherit">{children}</span>
    </span>
  );
};
