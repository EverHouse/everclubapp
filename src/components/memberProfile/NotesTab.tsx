import React from 'react';
import ProfileEmptyState from './ProfileEmptyState';
import { formatDateTimePacific } from './memberProfileTypes';
import type { MemberNote } from './memberProfileTypes';

interface NotesTabProps {
  isDark: boolean;
  notes: MemberNote[];
  newNoteContent: string;
  setNewNoteContent: (v: string) => void;
  newNotePinned: boolean;
  setNewNotePinned: (v: boolean) => void;
  isAddingNote: boolean;
  handleAddNote: () => void;
  editingNoteId: number | null;
  setEditingNoteId: (v: number | null) => void;
  editingNoteContent: string;
  setEditingNoteContent: (v: string) => void;
  handleUpdateNote: (noteId: number, content: string, isPinned?: boolean) => void;
  handleDeleteNote: (noteId: number) => void;
}

const NotesTab: React.FC<NotesTabProps> = ({
  isDark,
  notes,
  newNoteContent,
  setNewNoteContent,
  newNotePinned,
  setNewNotePinned,
  isAddingNote,
  handleAddNote,
  editingNoteId,
  setEditingNoteId,
  editingNoteContent,
  setEditingNoteContent,
  handleUpdateNote,
  handleDeleteNote,
}) => {
  return (
    <div className="space-y-4">
      <div 
        className="animate-slide-up-stagger"
        style={{ '--stagger-index': 0 } as React.CSSProperties}
      >
        <div className={`p-4 rounded-xl ${isDark ? 'bg-white/10' : 'bg-gray-100'}`}>
          <textarea
            placeholder="Add a note about this member..."
            value={newNoteContent}
            onChange={(e) => setNewNoteContent(e.target.value)}
            rows={3}
            className={`w-full px-3 py-2 rounded-lg text-sm resize-none ${isDark ? 'bg-white/10 text-white border-white/20 placeholder-gray-500' : 'bg-white text-gray-900 border-gray-200'} border`}
          />
          <div className="flex items-center justify-between mt-2">
            <label className={`flex items-center gap-2 text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              <input
                type="checkbox"
                checked={newNotePinned}
                onChange={(e) => setNewNotePinned(e.target.checked)}
                className="rounded"
              />
              Pin this note
            </label>
            <button
              onClick={handleAddNote}
              disabled={isAddingNote || !newNoteContent.trim()}
              className="py-2 px-4 rounded-lg bg-brand-green text-white font-medium text-sm disabled:opacity-50"
            >
              {isAddingNote ? 'Adding...' : 'Add Note'}
            </button>
          </div>
        </div>
      </div>

      {notes.length === 0 ? (
        <div 
          className="animate-slide-up-stagger"
          style={{ '--stagger-index': 1 } as React.CSSProperties}
        >
          <ProfileEmptyState icon="sticky_note_2" message="No notes yet" />
        </div>
      ) : (
        <div 
          className="animate-slide-up-stagger space-y-3"
          style={{ '--stagger-index': 1 } as React.CSSProperties}
        >
          {notes.map((note) => (
            <div key={note.id} className={`p-4 rounded-xl tactile-row ${isDark ? 'bg-white/5' : 'bg-gray-50'} ${note.isPinned ? 'ring-2 ring-yellow-500/50' : ''}`}>
              {editingNoteId === note.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editingNoteContent}
                    onChange={(e) => setEditingNoteContent(e.target.value)}
                    rows={3}
                    className={`w-full px-3 py-2 rounded-lg text-sm resize-none ${isDark ? 'bg-white/10 text-white border-white/20' : 'bg-white text-gray-900 border-gray-200'} border`}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setEditingNoteId(null); setEditingNoteContent(''); }}
                      className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium tactile-btn ${isDark ? 'bg-white/10 text-white' : 'bg-gray-200 text-gray-700'}`}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleUpdateNote(note.id, editingNoteContent, note.isPinned)}
                      className="flex-1 py-2 px-3 rounded-lg bg-brand-green text-white text-sm font-medium tactile-btn"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {note.isPinned && (
                        <span className="material-symbols-outlined text-yellow-500 text-sm mb-1">push_pin</span>
                      )}
                      <p className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{note.content}</p>
                      <p className={`text-[10px] mt-2 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                        {formatDateTimePacific(note.createdAt)} · {note.createdByName}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleUpdateNote(note.id, note.content, !note.isPinned)}
                        className={`p-1 tactile-btn ${note.isPinned ? 'text-yellow-500' : isDark ? 'text-gray-400' : 'text-gray-500'}`}
                        aria-label={note.isPinned ? 'Unpin note' : 'Pin note'}
                      >
                        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">push_pin</span>
                      </button>
                      <button
                        onClick={() => { setEditingNoteId(note.id); setEditingNoteContent(note.content); }}
                        className={`p-1 tactile-btn ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
                        aria-label="Edit note"
                      >
                        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">edit</span>
                      </button>
                      <button
                        onClick={() => handleDeleteNote(note.id)}
                        className="text-red-500 hover:text-red-600 p-1 tactile-btn"
                        aria-label="Delete note"
                      >
                        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">delete</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default NotesTab;
