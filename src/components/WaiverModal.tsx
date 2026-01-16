import React, { useState } from 'react';
import ModalShell from './ModalShell';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from './Toast';

interface WaiverModalProps {
  isOpen: boolean;
  onComplete: () => void;
  currentVersion: string;
}

export function WaiverModal({ isOpen, onComplete, currentVersion }: WaiverModalProps) {
  const { effectiveTheme } = useTheme();
  const { showToast } = useToast();
  const isDark = effectiveTheme === 'dark';
  const [agreed, setAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 50;
    if (isAtBottom && !scrolledToBottom) {
      setScrolledToBottom(true);
    }
  };

  const handleSign = async () => {
    if (!agreed) {
      showToast('Please agree to the waiver terms', 'error');
      return;
    }
    
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/waivers/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      
      if (!res.ok) {
        throw new Error('Failed to sign waiver');
      }
      
      showToast('Waiver signed successfully', 'success');
      onComplete();
    } catch (error) {
      showToast('Failed to sign waiver. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={() => {}}
      title="Membership Waiver"
      showCloseButton={false}
      dismissible={false}
      size="lg"
    >
      <div className="p-4 space-y-4">
        <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
          <p className="mb-2">
            Our waiver has been updated to version <strong>{currentVersion}</strong>. 
            Please review and sign to continue using your membership.
          </p>
        </div>

        <div 
          className={`h-64 overflow-y-auto p-4 rounded-xl border ${
            isDark 
              ? 'bg-black/20 border-white/10' 
              : 'bg-gray-50 border-gray-200'
          }`}
          onScroll={handleScroll}
        >
          <div className={`text-sm space-y-4 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            <h4 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              ASSUMPTION OF RISK AND WAIVER OF LIABILITY
            </h4>
            
            <p>
              By signing this waiver, I acknowledge that I am voluntarily participating in 
              activities at this facility, including but not limited to golf simulation, 
              fitness activities, wellness programs, and use of common areas.
            </p>

            <p>
              I understand that these activities involve inherent risks including, but not 
              limited to, physical injury, property damage, and other hazards. I voluntarily 
              assume all risks associated with my participation.
            </p>

            <p>
              I hereby release, waive, and discharge the facility, its owners, operators, 
              employees, agents, and affiliates from any and all liability, claims, demands, 
              and causes of action arising out of or related to any injury, damage, or loss 
              that may occur as a result of my participation in activities at this facility.
            </p>

            <p>
              I agree to follow all safety rules and guidelines established by the facility 
              and to use equipment only as intended. I understand that failure to follow 
              these rules may result in termination of my membership without refund.
            </p>

            <p>
              I acknowledge that I have read this waiver in its entirety, understand its 
              terms, and sign it voluntarily. I understand that by signing this waiver, 
              I am giving up substantial legal rights.
            </p>

            <p>
              This waiver shall be binding upon my heirs, executors, administrators, and 
              assigns. I agree that this waiver shall be governed by the laws of the 
              applicable jurisdiction.
            </p>

            <p className={`font-medium ${isDark ? 'text-[#a3e635]' : 'text-primary'}`}>
              — End of Waiver Document —
            </p>
          </div>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            disabled={!scrolledToBottom}
            className={`mt-1 w-5 h-5 rounded border-2 ${
              isDark 
                ? 'bg-black/20 border-white/20 accent-[#a3e635]' 
                : 'bg-white border-gray-300 accent-primary'
            } ${!scrolledToBottom ? 'opacity-50 cursor-not-allowed' : ''}`}
          />
          <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            I have read and agree to the terms of this waiver.
            {!scrolledToBottom && (
              <span className={`block text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                (Please scroll to the bottom to enable)
              </span>
            )}
          </span>
        </label>

        <button
          onClick={handleSign}
          disabled={!agreed || isSubmitting}
          className={`w-full py-3 px-4 rounded-xl font-semibold transition-all ${
            agreed && !isSubmitting
              ? isDark
                ? 'bg-[#a3e635] text-[#1a1d15] hover:bg-[#bef264]'
                : 'bg-primary text-white hover:bg-primary/90'
              : isDark
                ? 'bg-white/10 text-white/30 cursor-not-allowed'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
              Signing...
            </span>
          ) : (
            'Sign Waiver'
          )}
        </button>
      </div>
    </ModalShell>
  );
}

export default WaiverModal;
