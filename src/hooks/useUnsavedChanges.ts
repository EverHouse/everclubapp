import { useEffect, useCallback, useState } from 'react';
import { useConfirmDialog } from '../components/ConfirmDialog';

interface UseUnsavedChangesOptions {
  isDirty: boolean;
  message?: string;
}

export function useUnsavedChanges({ isDirty, message }: UseUnsavedChangesOptions) {
  const defaultMessage = message || 'You have unsaved changes. Are you sure you want to close? Your changes will be lost.';
  const [showDialog, setShowDialog] = useState(false);

  const { confirm, ConfirmDialogComponent } = useConfirmDialog();

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
    setShowDialog(false);
  }, []);

  const cancelDiscard = useCallback(() => {
    setShowDialog(false);
  }, []);

  const guardedClose = useCallback(async (actualClose: () => void) => {
    if (!isDirty) {
      actualClose();
      return;
    }
    const confirmed = await confirm({
      title: 'Unsaved Changes',
      message: defaultMessage,
      confirmText: 'Discard Changes',
      cancelText: 'Keep Editing',
      variant: 'warning',
    });
    if (confirmed) {
      actualClose();
    }
  }, [isDirty, confirm, defaultMessage]);

  return {
    showDialog,
    dialogTitle: 'Unsaved Changes',
    dialogMessage: defaultMessage,
    confirmDiscard,
    cancelDiscard,
    guardedClose,
    UnsavedChangesDialog: ConfirmDialogComponent,
  };
}
