import React from 'react';
import ProfileEmptyState from './ProfileEmptyState';
import { stripHtml, formatDateTimePacific } from './memberProfileTypes';
import type { CommunicationLog } from './memberProfileTypes';

interface CommunicationsTabProps {
  isDark: boolean;
  communications: CommunicationLog[];
  showAddComm: boolean;
  setShowAddComm: (v: boolean) => void;
  newCommType: string;
  setNewCommType: (v: string) => void;
  newCommDirection: string;
  setNewCommDirection: (v: string) => void;
  newCommSubject: string;
  setNewCommSubject: (v: string) => void;
  newCommBody: string;
  setNewCommBody: (v: string) => void;
  isAddingComm: boolean;
  handleAddCommunication: () => void;
  handleDeleteCommunication: (logId: number) => void;
}

const CommunicationsTab: React.FC<CommunicationsTabProps> = ({
  isDark,
  communications,
  showAddComm,
  setShowAddComm,
  newCommType,
  setNewCommType,
  newCommDirection,
  setNewCommDirection,
  newCommSubject,
  setNewCommSubject,
  newCommBody,
  setNewCommBody,
  isAddingComm,
  handleAddCommunication,
  handleDeleteCommunication,
}) => {
  return (
    <div className="space-y-4">
      <div 
        className="animate-slide-up-stagger"
        style={{ '--stagger-index': 0 } as React.CSSProperties}
      >
        <button
          onClick={() => setShowAddComm(!showAddComm)}
          className="w-full py-2 px-4 rounded-xl bg-brand-green text-white font-medium flex items-center justify-center gap-2 hover:opacity-90 transition-opacity tactile-btn"
        >
          <span className="material-symbols-outlined text-lg">add</span>
          Log Communication
        </button>
      </div>

      {showAddComm && (
        <div 
          className="animate-slide-up-stagger"
          style={{ '--stagger-index': 1 } as React.CSSProperties}
        >
          <div className={`p-4 rounded-xl ${isDark ? 'bg-white/10' : 'bg-gray-100'}`}>
            <div className="space-y-3">
              <div className="flex gap-2">
                <select
                  value={newCommType}
                  onChange={(e) => setNewCommType(e.target.value)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm ${isDark ? 'bg-white/10 text-white border-white/20' : 'bg-white text-gray-900 border-gray-200'} border`}
                >
                  <option value="email">Email</option>
                  <option value="call">Call</option>
                  <option value="meeting">Meeting</option>
                  <option value="note">Note</option>
                  <option value="sms">SMS</option>
                </select>
                <select
                  value={newCommDirection}
                  onChange={(e) => setNewCommDirection(e.target.value)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm ${isDark ? 'bg-white/10 text-white border-white/20' : 'bg-white text-gray-900 border-gray-200'} border`}
                >
                  <option value="outbound">Outbound</option>
                  <option value="inbound">Inbound</option>
                </select>
              </div>
              <input
                type="text"
                placeholder="Subject"
                value={newCommSubject}
                onChange={(e) => setNewCommSubject(e.target.value)}
                className={`w-full px-3 py-2 rounded-lg text-sm ${isDark ? 'bg-white/10 text-white border-white/20 placeholder-gray-500' : 'bg-white text-gray-900 border-gray-200'} border`}
              />
              <textarea
                placeholder="Details (optional)"
                value={newCommBody}
                onChange={(e) => setNewCommBody(e.target.value)}
                rows={3}
                className={`w-full px-3 py-2 rounded-lg text-sm resize-none ${isDark ? 'bg-white/10 text-white border-white/20 placeholder-gray-500' : 'bg-white text-gray-900 border-gray-200'} border`}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAddComm(false)}
                  className={`flex-1 py-2 px-4 rounded-lg font-medium ${isDark ? 'bg-white/10 text-white' : 'bg-gray-200 text-gray-700'}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddCommunication}
                  disabled={isAddingComm || !newCommSubject.trim()}
                  className="flex-1 py-2 px-4 rounded-lg bg-brand-green text-white font-medium disabled:opacity-50"
                >
                  {isAddingComm ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {communications.length === 0 ? (
        <div 
          className="animate-slide-up-stagger"
          style={{ '--stagger-index': 2 } as React.CSSProperties}
        >
          <ProfileEmptyState icon="chat" message="No communications logged yet" />
        </div>
      ) : (
        <div 
          className="animate-slide-up-stagger space-y-3"
          style={{ '--stagger-index': 2 } as React.CSSProperties}
        >
          {communications.map((comm) => (
            <div key={comm.id} className={`p-4 rounded-xl tactile-row ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`material-symbols-outlined text-lg ${
                      comm.type === 'email' ? 'text-blue-500' :
                      comm.type === 'call' ? 'text-green-500' :
                      comm.type === 'meeting' ? 'text-purple-500' :
                      comm.type === 'sms' ? 'text-orange-500' : 'text-gray-500'
                    }`}>
                      {comm.type === 'email' ? 'mail' :
                       comm.type === 'call' ? 'call' :
                       comm.type === 'meeting' ? 'groups' :
                       comm.type === 'sms' ? 'sms' : 'note'}
                    </span>
                    <span className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{comm.subject}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? 'bg-white/10 text-gray-400' : 'bg-gray-200 text-gray-600'}`}>
                      {comm.direction}
                    </span>
                  </div>
                  {comm.body && <p className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{stripHtml(comm.body)}</p>}
                  <p className={`text-[10px] mt-2 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                    {formatDateTimePacific(comm.occurredAt)} · {comm.loggedByName}
                  </p>
                </div>
                <button
                  onClick={() => handleDeleteCommunication(comm.id)}
                  className="text-red-500 hover:text-red-600 p-1 tactile-btn"
                  aria-label="Delete communication"
                >
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CommunicationsTab;
