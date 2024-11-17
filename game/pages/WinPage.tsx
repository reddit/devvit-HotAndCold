export const WinPage = ({ variant }: { variant: 'WIN' | 'GIVE_UP' }) => {
  return (
    <div className="text-white">{variant === 'WIN' ? 'Good work!' : 'Try again tomorrow?'}</div>
  );
};
