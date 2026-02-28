import React from 'react';
import ModalShell from '../ModalShell';
import { MemberSearchInput, type SelectedMember } from '../shared/MemberSearchInput';

interface AddMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (userId: string, memberName: string) => void;
}

const AddMemberModal: React.FC<AddMemberModalProps> = ({
  isOpen,
  onClose,
  onAdd
}) => {
  const handleSelect = (member: SelectedMember) => {
    onAdd(member.id, member.name);
    onClose();
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Add Member"
      size="md"
    >
      <div className="p-4 space-y-4">
        <MemberSearchInput
          forceApiSearch
          privacyMode
          showTier
          onSelect={handleSelect}
          placeholder="Search by name or email..."
          label="Search Members"
          autoFocus
        />
      </div>
    </ModalShell>
  );
};

export default AddMemberModal;
