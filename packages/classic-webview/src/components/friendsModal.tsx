import { ComponentProps } from 'react';
import { Modal } from '@hotandcold/webview-common/components/modal';

export const FriendsModal = (props: Omit<ComponentProps<typeof Modal>, 'children'>) => {
  return (
    <Modal {...props}>
      <div className="p-6">
        <h3 className="mb-4 text-xl font-bold text-white">Friends</h3>
        <p className="mb-4 text-gray-300">TODO</p>
      </div>
    </Modal>
  );
};
