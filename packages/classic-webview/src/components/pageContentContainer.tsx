import { cn } from '@hotandcold/webview-common/utils';

interface PageContentContainerProps {
  children: React.ReactNode;
  borderColor?: `border-${string}`; // Accepts any Tailwind border color class
  showContainer?: boolean;
}

export const PageContentContainer = ({
  children,
  borderColor = 'border-white/50', // Default border color
  showContainer = false, // Whether to show the container wrapper
}: PageContentContainerProps) => {
  if (!showContainer) {
    return children;
  }

  return <div className={cn('h-full rounded-3xl border bg-black/50', borderColor)}>{children}</div>;
};
