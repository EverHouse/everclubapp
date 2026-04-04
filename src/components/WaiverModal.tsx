import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import SlideUpDrawer from './SlideUpDrawer';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from './Toast';
import { postWithCredentials } from '../hooks/queries/useFetch';
import Icon from './icons/Icon';
import { WAIVER_PREAMBLE, WAIVER_SECTIONS, WAIVER_CLOSING } from '../../shared/waiver-content';

interface WaiverModalProps {
  isOpen: boolean;
  onComplete: () => void;
  currentVersion: string;
}

export function WaiverModal({ isOpen, onComplete, currentVersion }: WaiverModalProps) {
  const { effectiveTheme } = useTheme();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const isDark = effectiveTheme === 'dark';
  const [agreed, setAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEmailing, setIsEmailing] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const endOfWaiverRef = useRef<HTMLDivElement>(null);

  const markScrolledToBottom = useCallback(() => {
    setScrolledToBottom(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setScrolledToBottom(false);
      setAgreed(false);
      setEmailSent(false);
    }
  }, [isOpen, currentVersion]);

  useEffect(() => {
    if (!isOpen || scrolledToBottom) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const sentinel = endOfWaiverRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          markScrolledToBottom();
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    const timer = setTimeout(() => {
      observer.observe(sentinel);
    }, 500);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [isOpen, scrolledToBottom, markScrolledToBottom]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 100;
    if (isAtBottom && !scrolledToBottom) {
      markScrolledToBottom();
    }
  };

  const handleSign = async () => {
    if (!agreed) {
      showToast('Please agree to the Membership Agreement terms', 'error');
      return;
    }
    
    setIsSubmitting(true);
    try {
      await postWithCredentials('/api/waivers/sign', {});
      
      queryClient.invalidateQueries({ queryKey: ['waiverStatus'] });
      showToast('Membership Agreement signed successfully', 'success');
      onComplete();
    } catch (_error: unknown) {
      showToast('Failed to sign agreement. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailCopy = async () => {
    setIsEmailing(true);
    try {
      await postWithCredentials('/api/waivers/email-copy', {});
      setEmailSent(true);
      showToast('Agreement emailed to you successfully', 'success');
    } catch (_error: unknown) {
      showToast('Failed to send email. Please try again.', 'error');
    } finally {
      setIsEmailing(false);
    }
  };

  const stickyFooterContent = (
    <div className="p-4 space-y-4">
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
          I have read and agree to the terms of this Membership Agreement.
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
        className={`w-full py-3 px-4 rounded-xl font-semibold transition-colors duration-fast tactile-btn ${
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
            <Icon name="progress_activity" className="animate-spin text-lg" />
            Signing...
          </span>
        ) : (
          'Sign Membership Agreement'
        )}
      </button>

      <button
        onClick={handleEmailCopy}
        disabled={isEmailing || emailSent}
        className={`w-full py-2.5 px-4 rounded-xl text-sm font-medium transition-colors duration-fast flex items-center justify-center gap-2 ${
          emailSent
            ? isDark
              ? 'bg-white/5 text-[#a3e635]'
              : 'bg-gray-50 text-primary'
            : isEmailing
              ? isDark
                ? 'bg-white/5 text-white/50 cursor-not-allowed'
                : 'bg-gray-50 text-gray-400 cursor-not-allowed'
              : isDark
                ? 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                : 'bg-gray-50 text-gray-600 hover:bg-gray-100 hover:text-gray-800'
        }`}
      >
        {isEmailing ? (
          <>
            <Icon name="progress_activity" className="animate-spin text-base" />
            Sending...
          </>
        ) : emailSent ? (
          <>
            <Icon name="check_circle" className="text-base" />
            Agreement Emailed
          </>
        ) : (
          <>
            <Icon name="mail" className="text-base" />
            Email Me a Copy
          </>
        )}
      </button>
    </div>
  );

  return (
    <SlideUpDrawer
      isOpen={isOpen}
      onClose={() => {}}
      title="Membership Agreement"
      showCloseButton={false}
      dismissible={false}
      maxHeight="full"
      stickyFooter={stickyFooterContent}
      onContentScroll={handleScroll}
    >
      <div className="p-4 space-y-4">
        <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
          <p className="mb-2">
            Our Membership Agreement has been updated to version <strong>{currentVersion}</strong>. 
            Please review and sign to continue using your membership.
          </p>
        </div>

        <div className={`text-sm space-y-4 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          <h4 className={`font-display text-xl mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Ever Members Club {'\u2013'} Membership Agreement
          </h4>
          
          <p>{WAIVER_PREAMBLE}</p>

          {WAIVER_SECTIONS.map((section) => (
            <React.Fragment key={section.heading}>
              <h5 className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{section.heading}</h5>
              {section.paragraphs.map((paragraph, pIdx) => (
                <p key={pIdx}>{paragraph}</p>
              ))}
            </React.Fragment>
          ))}

          <p className={`text-xs opacity-70 mt-6`}>{WAIVER_CLOSING}</p>

          <p className={`font-medium ${isDark ? 'text-[#a3e635]' : 'text-primary'}`}>
            {'\u2014'} End of Membership Agreement {'\u2014'}
          </p>
          <div ref={endOfWaiverRef} aria-hidden="true" className="h-px w-full" />
        </div>
      </div>
    </SlideUpDrawer>
  );
}

export default WaiverModal;
