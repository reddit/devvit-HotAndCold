import { ComponentProps, JSX } from 'preact';
import { GradientBorder } from './gradientBorder';
import { cn } from '../utils/cn';

export const PrimaryButton = ({
  children,
  className,
  disabled,
  isHighContrast,
  ...rest
}: ComponentProps<'button'> & {
  isHighContrast?: boolean;
}) => {
  return (
    <button
      type="button"
      className={cn(
        'cursor-pointer rounded-full font-[inherit] text-sm font-medium text-black focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-50 focus:outline-none dark:text-white',
        // Visible neutral surface in light/dark modes
        'bg-zinc-100 dark:bg-zinc-800',
        className
      )}
      disabled={disabled}
      {...rest}
    >
      <GradientBorder isHidden={!!disabled}>
        <span className="inline-block px-4 py-3">{children}</span>
      </GradientBorder>
    </button>
  );
};

export const SecondaryButton = ({ children, className, ...rest }: ComponentProps<'button'>) => {
  return (
    <button
      type="button"
      className={cn(
        'rounded-md bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/[0.8] hover:shadow-lg',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
};

export const IconButton = ({
  children,
  className,
  icon,
  iconOnly = false,
  'aria-label': ariaLabel,
  ...rest
}: ComponentProps<'button'> & {
  icon: JSX.Element;
  iconOnly?: boolean;
  'aria-label': string; // Require label for accessibility since the text is often hidden.
}) => (
  <button
    type="button"
    className={cn(
      'flex cursor-pointer items-center gap-2 rounded-full bg-gray-50 p-3 text-current md:px-3 md:py-2 dark:bg-black',
      iconOnly &&
        'h-10 w-10 shrink-0 justify-center p-0 transition-colors hover:bg-gray-200 focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:outline-none md:p-0 dark:hover:bg-gray-800',
      className
    )}
    aria-label={ariaLabel}
    title={ariaLabel}
    {...rest}
  >
    {icon}
    {!iconOnly && <span className="hidden md:inline">{children}</span>}
  </button>
);
