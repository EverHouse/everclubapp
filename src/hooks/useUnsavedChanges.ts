import { useEffect, useCallback, useState } from 'react';
import { useBlocker } from 'react-router-dom';

interface UseUnsavedChangesOptions {
  isDirty: boolean;
  message?: string;
}

export function useUnsavedChanges({ isDirty, message }: UseUnsavedChangesOptions) {
  const defaultMessage = message || 'You have unsaved changes. Discard changes?';

  const blocker = useBlocker(isDirty);

  const [showDialog, setShowDialog] = useState(false);

  useEffect(() => {
    if (blocker.state === 'blocked') {
      setShowDialog(true);
    } else {
      setShowDialog(false);
    }
  }, [blocker.state]);

  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const confirmDiscard = useCallback(() => {
    if (blocker.state === 'blocked') {
      blocker.proceed();
    }
    setShowDialog(false);
  }, [blocker]);

  const cancelDiscard = useCallback(() => {
    if (blocker.state === 'blocked') {
      blocker.reset();
    }
    setShowDialog(false);
  }, [blocker]);

  return {
    showDialog,
    dialogTitle: 'Unsaved Changes',
    dialogMessage: defaultMessage,
    confirmDiscard,
    cancelDiscard,
  };
}
