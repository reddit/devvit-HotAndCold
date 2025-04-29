import { ComponentProps, useEffect } from 'react';
import { Modal } from '@hotandcold/webview-common/components/modal';
import { useHardcoreAccess } from '../hooks/useHardcoreAccess';
import { UnlockHardcoreCTAContent } from './UnlockHardcoreCTAContent';

type UnlockHardcoreModalProps = Omit<ComponentProps<typeof Modal>, 'children'>;

export const UnlockHardcoreModal = (props: UnlockHardcoreModalProps) => {
  const { access } = useHardcoreAccess();

  useEffect(() => {
    // if the access was activated
    if (access.status === 'active') {
      props.onClose();
    }
  }, [access]);

  return (
    <Modal {...props}>
      <UnlockHardcoreCTAContent withLogo />
    </Modal>
  );
};
