import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthData } from '../../contexts/DataContext';
import { AnimatedPage } from '../../components/motion';
import PwaSmartBanner from '../../components/PwaSmartBanner';
import Icon from '../../components/icons/Icon';

type CheckinResult = 'checking_in' | 'error';

const AUTO_REDIRECT_DELAY = 3500;

const NfcCheckin: React.FC = () => {
  const { user, sessionChecked } = useAuthData();
  const navigate = useNavigate();
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorRedirect, setErrorRedirect] = useState<'dashboard' | 'login'>('dashboard');
  const checkinAttemptedRef = useRef(false);

  const displayState = !sessionChecked ? 'loading' : !user ? 'not_logged_in' : result ?? 'checking_in';
  useEffect(() => {
    if (!sessionChecked || !user) {
      return;
    }

    if (checkinAttemptedRef.current) return;
    checkinAttemptedRef.current = true;

    const controller = new AbortController();

    fetch('/api/member/nfc-checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal: controller.signal
    })
      .then(async (res) => {
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (res.ok && data.success) {
          sessionStorage.setItem('nfc_checkin_result', JSON.stringify({ type: 'success', memberName: data.memberName, tier: data.tier }));
          navigate('/dashboard', { replace: true });
        } else if (data.alreadyCheckedIn) {
          sessionStorage.setItem('nfc_checkin_result', JSON.stringify({ type: 'already_checked_in', memberName: data.memberName || user.firstName || (user.name && !user.name.includes('@') ? user.name.split(' ')[0] : '') || '' }));
          navigate('/dashboard', { replace: true });
        } else {
          setErrorMessage(data.error || 'Check-in failed');
          if (res.status === 403 || res.status === 404) {
            setErrorRedirect('login');
          }
          setResult('error');
        }
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setErrorMessage('Unable to connect. Please try again.');
        setResult('error');
      });

    return () => controller.abort();
  }, [sessionChecked, user, navigate]);

  useEffect(() => {
    if (displayState !== 'error') return;
    const timer = setTimeout(() => {
      navigate(errorRedirect === 'login' ? '/login' : '/dashboard', { replace: true });
    }, AUTO_REDIRECT_DELAY);
    return () => clearTimeout(timer);
  }, [displayState, errorRedirect, navigate]);

  const handleLoginRedirect = () => {
    const currentPath = window.location.pathname + window.location.search;
    sessionStorage.setItem('nfc_checkin_redirect', currentPath);
    navigate('/login');
  };

  return (
    <AnimatedPage className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <PwaSmartBanner />
      <div className="w-full max-w-sm">
        {displayState === 'loading' && (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4 animate-pulse">
              <Icon name="nfc" className="text-4xl text-white/60" />
            </div>
            <p className="text-white/60 text-sm">Loading...</p>
          </div>
        )}

        {displayState === 'checking_in' && (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4 animate-pulse">
              <Icon name="nfc" className="text-4xl text-white/60" />
            </div>
            <p className="text-white/80 text-lg font-medium">Checking you in...</p>
            <p className="text-white/40 text-sm mt-1">Just a moment</p>
          </div>
        )}

        {displayState === 'not_logged_in' && (
          <div className="rounded-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-300">
            <div className="bg-gradient-to-br from-gray-700 via-gray-600 to-gray-800 p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-4">
                <Icon name="login" className="text-4xl text-white" />
              </div>
              <h1 className="text-xl font-bold text-white mb-2">Sign In to Check In</h1>
              <p className="text-white/70 text-sm mb-6">
                Please sign in to your account to complete NFC check-in
              </p>
              <button
                onClick={handleLoginRedirect}
                className="tactile-btn w-full py-3 px-6 rounded-xl bg-white text-gray-900 font-semibold text-sm hover:bg-white/90 transition-colors cursor-pointer"
              >
                Sign In
              </button>
            </div>
          </div>
        )}

        {displayState === 'error' && (
          <div className="rounded-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-300">
            <div className="bg-gradient-to-br from-red-700 via-red-600 to-red-800 p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-4">
                <Icon name="warning" className="text-4xl text-yellow-300" />
              </div>
              <h1 className="text-xl font-bold text-white mb-2">Check-In Issue</h1>
              <p className="text-white/80 text-sm">{errorMessage}</p>
              <p className="text-white/50 text-xs mt-3">{errorRedirect === 'login' ? 'Redirecting to sign in...' : 'Redirecting to your dashboard...'}</p>
            </div>
          </div>
        )}
      </div>
    </AnimatedPage>
  );
};

export default NfcCheckin;
