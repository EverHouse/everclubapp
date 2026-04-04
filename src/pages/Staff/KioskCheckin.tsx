import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthData } from '../../contexts/DataContext';
import { parseQrCode } from '../../utils/qrCodeParser';
import Icon from '../../components/icons/Icon';
import { MemberPaymentModal } from '../../components/booking/MemberPaymentModal';
import { playSound } from '../../utils/sounds';

interface Html5QrcodeInstance {
  getState(): number;
  stop(): Promise<void>;
  start(
    camera: { facingMode: string },
    config: { fps: number; qrbox: { width: number; height: number }; aspectRatio: number },
    onSuccess: (decodedText: string) => void,
    onFailure: () => void
  ): Promise<null | void>;
}

type KioskState = 'scanning' | 'processing' | 'payment_required' | 'see_staff' | 'success' | 'already_checked_in' | 'error';

interface UpcomingBooking {
  bookingId: number;
  sessionId: number | null;
  startTime: string;
  endTime: string;
  resourceName: string;
  resourceType: string;
  declaredPlayerCount: number;
  ownerEmail: string;
  ownerName: string;
  unpaidFeeCents: number;
}

interface PreflightResult {
  memberName: string;
  memberId: string;
  memberEmail: string;
  tier: string | null;
  membershipStatus: string | null;
  upcomingBooking: UpcomingBooking | null;
  isBookingOwner: boolean;
  requiresPayment: boolean;
  unpaidFeeCents: number;
}

interface CheckinResult {
  memberName: string;
  memberId?: string;
  memberEmail?: string;
  tier: string | null;
  lifetimeVisits: number;
  upcomingBooking?: UpcomingBooking | null;
}

const OLIVE_ACCENT = '#8B9A6B';
const OLIVE_TEXT = '#C4CFA6';
const CREAM = '#E8E4D9';
const BG_GRADIENT = 'radial-gradient(ellipse at 50% 30%, #2a3518 0%, #1a220c 50%, #0d1106 100%)';
const CARD_BG = 'rgba(35, 45, 20, 0.6)';
const CARD_BORDER = 'rgba(139, 154, 107, 0.25)';
const RESET_DELAY_SUCCESS = 6000;
const RESET_DELAY_WITH_BOOKING = 25000;
const RESET_DELAY_ERROR = 3000;
const RESET_DELAY_SEE_STAFF = 8000;

function formatTime12h(time24: string): string {
  if (!time24) return '';
  const [h, m] = time24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

const KioskCheckin: React.FC = () => {
  const { actualUser, sessionChecked } = useAuthData();
  const navigate = useNavigate();
  const [state, _setState] = useState<KioskState>('scanning');
  const stateRef = useRef<KioskState>('scanning');
  const setState = useCallback((newState: KioskState) => {
    stateRef.current = newState;
    _setState(newState);
  }, []);
  const [checkinResult, setCheckinResult] = useState<CheckinResult | null>(null);
  const [preflightData, setPreflightData] = useState<PreflightResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [checkinAfterPayment, setCheckinAfterPayment] = useState(false);
  const [checkinAfterPaymentError, setCheckinAfterPaymentError] = useState<string | null>(null);

  const [showPasscodeModal, setShowPasscodeModal] = useState(false);
  const [passcodeDigits, setPasscodeDigits] = useState<string[]>(['', '', '', '']);
  const [passcodeError, setPasscodeError] = useState(false);
  const [passcodeErrorMessage, setPasscodeErrorMessage] = useState('');
  const [passcodeChecking, setPasscodeChecking] = useState(false);
  const passcodeInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const passcodeDigitsRef = useRef<string[]>(['', '', '', '']);
  passcodeDigitsRef.current = passcodeDigits;

  const qrScannerRef = useRef<Html5QrcodeInstance | null>(null);
  const hasScannedRef = useRef(false);
  const isStartingRef = useRef(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passcodeSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const styleFixTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passcodeSubmittingRef = useRef(false);

  const elementId = useMemo(() => `kiosk-qr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, []);

  const isStaff = actualUser?.role === 'admin' || actualUser?.role === 'staff';

  const stopScanner = useCallback(async () => {
    if (qrScannerRef.current) {
      try {
        const { Html5QrcodeScannerState } = await import('html5-qrcode');
        const scannerState = qrScannerRef.current.getState();
        if (scannerState === Html5QrcodeScannerState.SCANNING || scannerState === Html5QrcodeScannerState.PAUSED) {
          await qrScannerRef.current.stop();
        }
      } catch (err: unknown) {
        console.error("[Kiosk] Failed to stop scanner:", err);
      } finally {
        qrScannerRef.current = null;
      }
    }
  }, []);

  const performCheckin = useCallback(async (memberId: string, paymentConfirmed: boolean) => {
    const res = await fetch('/api/kiosk/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ memberId, paymentConfirmed })
    });

    const data = await res.json();
    return { res, data };
  }, []);

  const handleScan = useCallback(async (decodedText: string) => {
    const parsed = parseQrCode(decodedText);
    if (parsed.type !== 'member' || !parsed.memberId) {
      setErrorMessage('Invalid QR code. Please use your membership card QR code.');
      setState('error');
      return;
    }

    setState('processing');

    try {
      const preflightRes = await fetch('/api/kiosk/checkin-preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ memberId: parsed.memberId })
      });

      const preflightResult = await preflightRes.json();

      if (!preflightRes.ok) {
        setErrorMessage(preflightResult.error || 'Check-in failed. Please ask staff for help.');
        playSound('checkinWarning');
        setState('error');
        return;
      }

      setPreflightData(preflightResult);

      if (preflightResult.requiresPayment && preflightResult.unpaidFeeCents > 0) {
        if (preflightResult.isBookingOwner) {
          playSound('tap');
          setState('payment_required');
          setShowPaymentModal(true);
        } else {
          playSound('checkinWarning');
          setState('see_staff');
        }
        return;
      }

      const { res, data } = await performCheckin(parsed.memberId, false);

      if (res.ok && data.success) {
        setCheckinResult({
          memberName: data.memberName,
          memberId: data.memberId || undefined,
          memberEmail: data.memberEmail || undefined,
          tier: data.tier,
          lifetimeVisits: data.lifetimeVisits,
          upcomingBooking: data.upcomingBooking || null
        });
        playSound('checkinSuccess');
        setState('success');
      } else if (data.alreadyCheckedIn) {
        setCheckinResult({
          memberName: data.memberName || '',
          tier: data.tier || null,
          lifetimeVisits: 0
        });
        playSound('tap');
        setState('already_checked_in');
      } else {
        setErrorMessage(data.error || 'Check-in failed. Please ask staff for help.');
        playSound('checkinWarning');
        setState('error');
      }
    } catch {
      setErrorMessage('Connection error. Please try again.');
      playSound('checkinWarning');
      setState('error');
    }
  }, [performCheckin]);

  const handlePaymentSuccess = useCallback(async () => {
    setShowPaymentModal(false);
    setCheckinAfterPayment(true);
    setCheckinAfterPaymentError(null);

    if (!preflightData?.memberId) {
      setCheckinAfterPayment(false);
      setCheckinAfterPaymentError('Payment was processed, but check-in could not be completed. Please see staff.');
      return;
    }

    try {
      const { res, data } = await performCheckin(preflightData.memberId, true);

      if (res.ok && data.success) {
        setCheckinResult({
          memberName: data.memberName,
          memberId: data.memberId || undefined,
          memberEmail: data.memberEmail || undefined,
          tier: data.tier,
          lifetimeVisits: data.lifetimeVisits,
          upcomingBooking: data.upcomingBooking || null
        });
        playSound('checkinSuccess');
        setState('success');
      } else if (data.alreadyCheckedIn) {
        setCheckinResult({
          memberName: data.memberName || '',
          tier: data.tier || null,
          lifetimeVisits: 0
        });
        playSound('tap');
        setState('already_checked_in');
      } else {
        setCheckinAfterPaymentError(
          'Payment was processed, but check-in could not be completed. Please see staff.'
        );
      }
    } catch {
      setCheckinAfterPaymentError(
        'Payment was processed, but a connection error occurred. Please see staff to complete check-in.'
      );
    } finally {
      setCheckinAfterPayment(false);
    }
  }, [preflightData, performCheckin]);

  const handlePaymentDismissed = useCallback(() => {
    setShowPaymentModal(false);
    setErrorMessage('Check-in incomplete — fees must be paid. Please see staff for assistance.');
    playSound('checkinWarning');
    setState('error');
  }, []);

  const scannerStartedRef = useRef(false);

  const startScanner = useCallback(async () => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    await stopScanner();
    hasScannedRef.current = false;
    scannerStartedRef.current = false;
    setCameraError(null);

    const containerEl = document.getElementById(elementId);
    if (!containerEl) {
      isStartingRef.current = false;
      return;
    }

    const initTimeout = setTimeout(() => {
      if (!scannerStartedRef.current) {
        setCameraError('Camera took too long to initialize. Please try again.');
      }
    }, 10000);

    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const cameras = await Html5Qrcode.getCameras();
      if (!cameras || cameras.length === 0) {
        clearTimeout(initTimeout);
        setCameraError('No cameras found. Please connect a camera.');
        return;
      }

      const qrScanner = new Html5Qrcode(elementId);
      qrScannerRef.current = qrScanner;

      await qrScanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 280, height: 280 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          if (!hasScannedRef.current && stateRef.current === 'scanning') {
            hasScannedRef.current = true;
            handleScan(decodedText);
          }
        },
        () => {}
      );
      scannerStartedRef.current = true;
      clearTimeout(initTimeout);
      const styleFixTimeout = setTimeout(() => {
        const container = document.getElementById(elementId);
        if (container) {
          container.querySelectorAll('div').forEach(div => {
            if (div.style.position === 'absolute' && div.style.backgroundColor) {
              div.style.backgroundColor = 'transparent';
            }
          });
          container.querySelectorAll('img').forEach(img => {
            img.style.display = 'none';
          });
        }
      }, 200);
      styleFixTimeoutRef.current = styleFixTimeout;
    } catch (err: unknown) {
      clearTimeout(initTimeout);
      setCameraError(`Camera error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      isStartingRef.current = false;
    }
  }, [elementId, stopScanner, handleScan]);

  const resetToScanning = useCallback(() => {
    setState('scanning');
    setCheckinResult(null);
    setPreflightData(null);
    setErrorMessage('');
    setShowPaymentModal(false);
    setCheckinAfterPayment(false);
    setCheckinAfterPaymentError(null);
    hasScannedRef.current = false;
  }, []);

  useEffect(() => {
    if (showPaymentModal || checkinAfterPayment) return;
    if (state === 'success' || state === 'already_checked_in') {
      const delay = checkinResult?.upcomingBooking ? RESET_DELAY_WITH_BOOKING : RESET_DELAY_SUCCESS;
      resetTimerRef.current = setTimeout(resetToScanning, delay);
    } else if (state === 'error') {
      resetTimerRef.current = setTimeout(resetToScanning, RESET_DELAY_ERROR);
    } else if (state === 'see_staff') {
      resetTimerRef.current = setTimeout(resetToScanning, RESET_DELAY_SEE_STAFF);
    } else if (state === 'payment_required' && checkinAfterPaymentError) {
      resetTimerRef.current = setTimeout(resetToScanning, RESET_DELAY_SEE_STAFF);
    }
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, [state, resetToScanning, showPaymentModal, checkinAfterPayment, checkinAfterPaymentError, checkinResult?.upcomingBooking]);

  useEffect(() => {
    return () => {
      stopScanner();
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      if (styleFixTimeoutRef.current) clearTimeout(styleFixTimeoutRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (healthCheckRef.current) clearInterval(healthCheckRef.current);
    };
  }, [stopScanner]);

  const backBlockerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const blockBackNavigation = () => {
      window.history.pushState(null, '', '/kiosk');
    };

    backBlockerRef.current = blockBackNavigation;

    window.history.replaceState(null, '', '/kiosk');
    window.history.pushState(null, '', '/kiosk');

    window.addEventListener('popstate', blockBackNavigation);

    const blockBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', blockBeforeUnload);

    const blockKeyboardNav = (e: KeyboardEvent) => {
      if (
        (e.metaKey && e.key === 'l') ||
        (e.metaKey && e.key === '[') ||
        (e.metaKey && e.key === ']') ||
        (e.altKey && e.key === 'ArrowLeft') ||
        (e.altKey && e.key === 'ArrowRight') ||
        (e.metaKey && e.key === 'r') ||
        e.key === 'F5'
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', blockKeyboardNav, true);

    const blockContextMenu = (e: Event) => {
      e.preventDefault();
    };
    window.addEventListener('contextmenu', blockContextMenu);

    return () => {
      window.removeEventListener('popstate', blockBackNavigation);
      window.removeEventListener('beforeunload', blockBeforeUnload);
      window.removeEventListener('keydown', blockKeyboardNav, true);
      window.removeEventListener('contextmenu', blockContextMenu);
      backBlockerRef.current = null;
    };
  }, []);

  const rafRef = useRef<number | null>(null);
  const healthCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isStaff || !sessionChecked) return;

    let attempts = 0;
    const waitForElement = () => {
      const el = document.getElementById(elementId);
      if (el) {
        rafRef.current = null;
        startScanner();
      } else if (attempts < 60) {
        attempts++;
        rafRef.current = requestAnimationFrame(waitForElement);
      }
    };
    rafRef.current = requestAnimationFrame(waitForElement);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isStaff, sessionChecked, elementId, startScanner]);

  useEffect(() => {
    if (!isStaff || !sessionChecked) return;

    healthCheckRef.current = setInterval(async () => {
      if (isStartingRef.current) return;
      try {
        const { Html5QrcodeScannerState } = await import('html5-qrcode');
        const scanner = qrScannerRef.current;
        if (!scanner) {
          console.warn('[Kiosk] Health check: no scanner instance, restarting...');
          startScanner();
          return;
        }
        const scannerState = scanner.getState();
        if (scannerState !== Html5QrcodeScannerState.SCANNING) {
          console.warn('[Kiosk] Health check: scanner not in SCANNING state, restarting...');
          startScanner();
        }
      } catch (err) {
        console.error('[Kiosk] Health check error:', err);
      }
    }, 30000);

    return () => {
      if (healthCheckRef.current) clearInterval(healthCheckRef.current);
    };
  }, [isStaff, sessionChecked, startScanner]);

  const handlePasscodeOpen = useCallback(() => {
    setShowPasscodeModal(true);
    setPasscodeDigits(['', '', '', '']);
    setPasscodeError(false);
    setPasscodeErrorMessage('');
    setPasscodeChecking(false);
    passcodeSubmittingRef.current = false;
    if (passcodeSubmitTimerRef.current) { clearTimeout(passcodeSubmitTimerRef.current); passcodeSubmitTimerRef.current = null; }
    setTimeout(() => passcodeInputRefs.current[0]?.focus(), 300);
  }, []);

  const handlePasscodeClose = useCallback(() => {
    setShowPasscodeModal(false);
    setPasscodeDigits(['', '', '', '']);
    setPasscodeError(false);
    setPasscodeErrorMessage('');
    passcodeSubmittingRef.current = false;
    if (passcodeSubmitTimerRef.current) { clearTimeout(passcodeSubmitTimerRef.current); passcodeSubmitTimerRef.current = null; }
  }, []);

  const handlePasscodeSubmit = useCallback(async (digits: string[]) => {
    const code = digits.join('');
    if (code.length !== 4) return;
    if (passcodeSubmittingRef.current) return;
    passcodeSubmittingRef.current = true;

    if (passcodeSubmitTimerRef.current) {
      clearTimeout(passcodeSubmitTimerRef.current);
      passcodeSubmitTimerRef.current = null;
    }

    setPasscodeChecking(true);
    setPasscodeError(false);

    try {
      const res = await fetch('/api/kiosk/verify-passcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ passcode: code })
      });

      const data = await res.json();
      if (data.valid) {
        if (backBlockerRef.current) {
          window.removeEventListener('popstate', backBlockerRef.current);
          backBlockerRef.current = null;
        }
        await stopScanner();
        navigate('/admin', { replace: true });
      } else {
        setPasscodeError(true);
        setPasscodeErrorMessage(data.error || 'Incorrect passcode. Try again.');
        setPasscodeDigits(['', '', '', '']);
        setTimeout(() => passcodeInputRefs.current[0]?.focus(), 300);
      }
    } catch {
      setPasscodeError(true);
      setPasscodeErrorMessage('Connection error. Please try again.');
      setPasscodeDigits(['', '', '', '']);
      setTimeout(() => passcodeInputRefs.current[0]?.focus(), 300);
    } finally {
      setPasscodeChecking(false);
      passcodeSubmittingRef.current = false;
    }
  }, [navigate, stopScanner]);

  const handlePasscodeDigitChange = useCallback((index: number, value: string) => {
    if (value.length > 1) value = value.slice(-1);
    if (value && !/^\d$/.test(value)) return;

    setPasscodeError(false);
    const newDigits = [...passcodeDigitsRef.current];
    newDigits[index] = value;
    setPasscodeDigits(newDigits);

    if (value && index < 3) {
      setTimeout(() => passcodeInputRefs.current[index + 1]?.focus(), 0);
    } else if (value && index === 3 && newDigits.every(d => d !== '')) {
      if (passcodeSubmitTimerRef.current) clearTimeout(passcodeSubmitTimerRef.current);
      passcodeSubmitTimerRef.current = setTimeout(() => handlePasscodeSubmit(newDigits), 50);
    }
  }, [handlePasscodeSubmit]);

  const handlePasscodeKeyDown = useCallback((index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      setPasscodeError(false);
      setPasscodeErrorMessage('');
      const newDigits = [...passcodeDigitsRef.current];
      newDigits[index] = e.key;
      setPasscodeDigits(newDigits);
      if (index < 3) {
        setTimeout(() => passcodeInputRefs.current[index + 1]?.focus(), 0);
      } else if (newDigits.every(d => d !== '')) {
        if (passcodeSubmitTimerRef.current) clearTimeout(passcodeSubmitTimerRef.current);
        passcodeSubmitTimerRef.current = setTimeout(() => handlePasscodeSubmit(newDigits), 50);
      }
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      const currentDigit = passcodeDigitsRef.current[index];
      if (currentDigit) {
        setPasscodeDigits(prev => {
          const newDigits = [...prev];
          newDigits[index] = '';
          return newDigits;
        });
      } else if (index > 0) {
        setPasscodeDigits(prev => {
          const newDigits = [...prev];
          newDigits[index - 1] = '';
          return newDigits;
        });
        setTimeout(() => passcodeInputRefs.current[index - 1]?.focus(), 0);
      }
      return;
    }
    if (e.key === 'Enter') {
      handlePasscodeSubmit(passcodeDigitsRef.current);
    }
  }, [handlePasscodeSubmit]);

  if (!sessionChecked) {
    return (
      <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 9999, background: BG_GRADIENT }}>
        <div className="w-12 h-12 rounded-full border-4 border-white/20 animate-spin" style={{ borderTopColor: OLIVE_ACCENT }} />
      </div>
    );
  }

  if (!isStaff) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center px-6" style={{ zIndex: 9999, background: BG_GRADIENT }}>
        <div className="w-20 h-20 rounded-2xl bg-red-500/10 flex items-center justify-center mb-6">
          <Icon name="lock" className="text-5xl text-red-400" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Staff Access Required</h1>
        <p className="text-white/50 text-center mb-8">Sign in with a staff account to use kiosk mode.</p>
        <button
          onClick={() => navigate('/admin', { replace: true })}
          className="px-6 py-3 rounded-xl bg-white/10 text-white font-medium hover:bg-white/20 transition-colors"
        >
          Go to Admin Portal
        </button>
      </div>
    );
  }

  const booking = checkinResult?.upcomingBooking;
  const firstName = (checkinResult?.memberName || preflightData?.memberName || '')?.split(' ')[0] || '';

  const preflightBooking = preflightData?.upcomingBooking;

  return (
    <div className="fixed inset-0 flex flex-col select-none" style={{ zIndex: 9999, touchAction: 'none', background: BG_GRADIENT }}>
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")` }} />

      <div className="relative flex items-center justify-between px-8 pt-6 pb-4 flex-shrink-0">
        <img
          src="/assets/logos/mascot-white.webp"
          alt="Ever Club"
          className="h-8 w-auto object-contain opacity-60"
        />
        <button
          onClick={handlePasscodeOpen}
          className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
          aria-label="Exit kiosk mode"
        >
          <Icon name="lock_open" className="text-white/15 text-base" />
        </button>
      </div>

      <div className="relative flex-1 flex flex-col items-center justify-center px-6 overflow-hidden min-h-0">

        <div className="w-full max-w-lg flex flex-col items-center">
          {state === 'scanning' && (
            <div className="animate-in fade-in duration-300 w-full flex flex-col items-center">
              <p
                className="text-sm tracking-[0.2em] uppercase mb-1"
                style={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-headline)' }}
              >
                Welcome to
              </p>
              <img
                src="/images/everclub-logo-light.webp"
                alt="Ever Club"
                className="h-12 md:h-14 object-contain mb-4"
                style={{ filter: 'brightness(1.1)' }}
              />
              <p
                className="text-xs font-semibold tracking-[0.3em] uppercase mb-3"
                style={{ color: OLIVE_ACCENT }}
              >
                Arrival Protocol
              </p>
              <h1
                className="text-3xl md:text-4xl text-center leading-[1.1] mb-2"
                style={{ fontFamily: 'var(--font-headline)', color: CREAM }}
              >
                Present Your Key
              </h1>
              <p className="text-white/40 text-sm mb-4 text-center">Hold your membership QR code to the camera</p>

              <div
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium tracking-wider uppercase mb-4"
                style={{ background: 'rgba(139, 154, 107, 0.12)', border: `1px solid ${CARD_BORDER}`, color: OLIVE_TEXT }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Scanner Active
              </div>
            </div>
          )}

          <div className="relative w-full max-w-sm mx-auto">
            <div className="absolute -top-2 -left-2 w-7 h-7 border-t-2 border-l-2 z-10" style={{ borderColor: OLIVE_ACCENT }} />
            <div className="absolute -top-2 -right-2 w-7 h-7 border-t-2 border-r-2 z-10" style={{ borderColor: OLIVE_ACCENT }} />
            <div className="absolute -bottom-2 -left-2 w-7 h-7 border-b-2 border-l-2 z-10" style={{ borderColor: OLIVE_ACCENT }} />
            <div className="absolute -bottom-2 -right-2 w-7 h-7 border-b-2 border-r-2 z-10" style={{ borderColor: OLIVE_ACCENT }} />

            <div className="rounded-lg overflow-hidden bg-black/40 kiosk-scanner-container" style={{ border: `1px solid ${CARD_BORDER}`, aspectRatio: '1', maxHeight: 'min(400px, 50vh)' }}>
              <style>{`
                .kiosk-scanner-container [id$="__scan_region"] ~ div,
                .kiosk-scanner-container > div > div > div[style*="border-width"] {
                  display: none !important;
                }
                .kiosk-scanner-container video {
                  object-fit: cover !important;
                  width: 100% !important;
                  height: 100% !important;
                }
              `}</style>
              <div id={elementId} className="w-full h-full" />
            </div>

            {cameraError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 rounded-lg p-6 z-20">
                <div className="text-center">
                  <Icon name="photo_camera" className="text-4xl text-red-400 mb-3" />
                  <p className="text-red-300 text-sm">{cameraError}</p>
                  <button
                    onClick={() => startScanner()}
                    className="mt-4 px-4 py-2 rounded-lg text-white text-sm transition-colors"
                    style={{ background: 'rgba(139, 154, 107, 0.2)', border: `1px solid ${CARD_BORDER}` }}
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}

            {state !== 'scanning' && (
              <div className="absolute inset-0 rounded-lg z-20 flex items-center justify-center" style={{ background: 'rgba(13, 17, 6, 0.88)', backdropFilter: 'blur(4px)' }}>

                {state === 'processing' && (
                  <div className="text-center animate-in fade-in duration-200 px-4">
                    <p
                      className="text-xs font-semibold tracking-[0.3em] uppercase mb-6"
                      style={{ color: OLIVE_ACCENT }}
                    >
                      Verifying Identity
                    </p>
                    <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(139, 154, 107, 0.1)', border: `1px solid ${CARD_BORDER}` }}>
                      <div className="w-8 h-8 rounded-full border-3 border-white/15 animate-spin" style={{ borderTopColor: OLIVE_ACCENT }} />
                    </div>
                    <h2 className="text-xl mb-2" style={{ fontFamily: 'var(--font-headline)', color: CREAM }}>
                      Confirming your arrival...
                    </h2>
                    <p className="text-white/35 text-xs">One moment, please</p>
                  </div>
                )}

                {state === 'payment_required' && preflightData && !showPaymentModal && !checkinAfterPayment && (
                  <div className="text-center animate-in fade-in duration-500 px-4">
                    {checkinAfterPaymentError ? (
                      <>
                        <p className="text-xs font-semibold tracking-[0.3em] uppercase mb-4" style={{ color: '#E57373' }}>Check-In Issue</p>
                        <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(229, 115, 115, 0.1)', border: '1px solid rgba(229, 115, 115, 0.25)' }}>
                          <Icon name="warning" className="text-2xl text-red-400" />
                        </div>
                        <h2 className="text-xl mb-2" style={{ fontFamily: 'var(--font-headline)', color: CREAM }}>See Staff</h2>
                        <p className="text-red-300/80 text-sm mb-3">{checkinAfterPaymentError}</p>
                        <p className="text-white/30 text-xs">A team member can complete your check-in</p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs font-semibold tracking-[0.3em] uppercase mb-4" style={{ color: '#D4A844' }}>Payment Required</p>
                        <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(212, 168, 68, 0.1)', border: '1px solid rgba(212, 168, 68, 0.25)' }}>
                          <Icon name="payment" className="text-2xl text-amber-400" />
                        </div>
                        <h2 className="text-xl mb-2" style={{ fontFamily: 'var(--font-headline)', color: CREAM }}>Outstanding Fees</h2>
                        <p className="text-amber-300/80 text-base mb-1">${(preflightData.unpaidFeeCents / 100).toFixed(2)}</p>
                        <p className="text-white/40 text-xs mb-4">Payment is required before check-in</p>
                        <button
                          onClick={() => setShowPaymentModal(true)}
                          className="tactile-btn px-6 py-2.5 rounded-xl text-sm font-semibold transition-colors duration-200"
                          style={{ background: OLIVE_ACCENT, color: '#1a220c' }}
                        >
                          Pay Now
                        </button>
                      </>
                    )}
                  </div>
                )}

                {state === 'payment_required' && checkinAfterPayment && (
                  <div className="text-center animate-in fade-in duration-200 px-4">
                    <p className="text-xs font-semibold tracking-[0.3em] uppercase mb-6" style={{ color: OLIVE_ACCENT }}>Completing Check-In</p>
                    <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(139, 154, 107, 0.1)', border: `1px solid ${CARD_BORDER}` }}>
                      <div className="w-8 h-8 rounded-full border-3 border-white/15 animate-spin" style={{ borderTopColor: OLIVE_ACCENT }} />
                    </div>
                    <h2 className="text-xl mb-2" style={{ fontFamily: 'var(--font-headline)', color: CREAM }}>Payment received, finalizing...</h2>
                    <p className="text-white/35 text-xs">One moment, please</p>
                  </div>
                )}

                {state === 'see_staff' && preflightData && (
                  <div className="text-center animate-in fade-in duration-500 px-4">
                    <p className="text-xs font-semibold tracking-[0.3em] uppercase mb-4" style={{ color: '#D4A844' }}>Staff Assistance Needed</p>
                    <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(212, 168, 68, 0.1)', border: '1px solid rgba(212, 168, 68, 0.25)' }}>
                      <Icon name="support_agent" className="text-2xl text-amber-400" />
                    </div>
                    <h2 className="text-xl mb-2" style={{ fontFamily: 'var(--font-headline)', color: CREAM }}>Welcome, <em>{firstName}</em></h2>
                    <p className="text-amber-300/80 text-sm mb-3">Outstanding fees: ${(preflightData.unpaidFeeCents / 100).toFixed(2)}</p>
                    <p className="text-white/40 text-xs">Please see staff to complete payment and check-in</p>
                  </div>
                )}

                {state === 'success' && checkinResult && (
                  <div className="text-center animate-in fade-in duration-500 px-4">
                    <p className="text-xs font-semibold tracking-[0.3em] uppercase mb-4" style={{ color: OLIVE_ACCENT }}>Confirmed Access</p>
                    <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                      <Icon name="check_circle" className="text-3xl text-emerald-400" />
                    </div>
                    <h2 className="text-xl mb-2" style={{ fontFamily: 'var(--font-headline)', color: CREAM }}>Welcome, <em>{firstName}</em></h2>
                    {checkinResult.tier && <p className="text-white/50 text-sm mb-1">{checkinResult.tier} Member</p>}
                    <p className="text-white/35 text-xs">Enjoy your visit</p>
                  </div>
                )}

                {state === 'already_checked_in' && checkinResult && (
                  <div className="text-center animate-in fade-in zoom-in-95 duration-500 px-4">
                    <p className="text-xs font-semibold tracking-[0.3em] uppercase mb-4" style={{ color: '#D4A844' }}>Already Registered</p>
                    <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(212, 168, 68, 0.1)', border: '1px solid rgba(212, 168, 68, 0.25)' }}>
                      <Icon name="how_to_reg" className="text-2xl text-amber-400" />
                    </div>
                    <h2 className="text-xl mb-2" style={{ fontFamily: 'var(--font-headline)', color: CREAM }}>Welcome back, <em>{firstName}</em></h2>
                    <p className="text-white/35 text-xs">Your arrival was recently noted</p>
                  </div>
                )}

                {state === 'error' && (
                  <div className="text-center animate-in fade-in zoom-in-95 duration-300 px-4">
                    <p className="text-xs font-semibold tracking-[0.3em] uppercase mb-4" style={{ color: '#E57373' }}>Access Issue</p>
                    <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(229, 115, 115, 0.1)', border: '1px solid rgba(229, 115, 115, 0.25)' }}>
                      <Icon name="error_outline" className="text-2xl text-red-400" />
                    </div>
                    <h2 className="text-xl mb-2" style={{ fontFamily: 'var(--font-headline)', color: CREAM }}>Unable to verify</h2>
                    <p className="text-red-300/80 text-sm mb-3">{errorMessage}</p>
                    <p className="text-white/30 text-xs">Please see the concierge for assistance</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {state === 'success' && checkinResult && booking && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 w-full max-w-lg mt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl p-4" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
                  <p className="text-[10px] tracking-[0.15em] uppercase mb-1" style={{ color: OLIVE_ACCENT }}>Session Time</p>
                  <p className="text-white text-base font-bold">{formatTime12h(booking.startTime)}</p>
                  <p className="text-white/40 text-xs">to {formatTime12h(booking.endTime)}</p>
                </div>
                <div className="rounded-xl p-4" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
                  <p className="text-[10px] tracking-[0.15em] uppercase mb-1" style={{ color: OLIVE_ACCENT }}>Bay</p>
                  <p className="text-white text-base font-bold">{booking.resourceName}</p>
                  <p className="text-white/40 text-xs capitalize">{booking.resourceType.replace(/_/g, ' ')}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="relative pb-6 flex justify-center">
        <img
          src="/images/everclub-logo-light.webp"
          alt="Ever Club"
          className="h-4 opacity-10"
        />
      </div>

      {showPasscodeModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-[10000] animate-in fade-in duration-200">
          <div
            className="rounded-xl p-8 w-full max-w-sm mx-6 backdrop-blur-xl animate-in zoom-in-95 duration-300"
            style={{
              background: 'rgba(30,40,15,0.9)',
              border: `1px solid ${CARD_BORDER}`,
              boxShadow: '0 24px 48px rgba(0,0,0,0.5)'
            }}
          >
            <div className="text-center mb-8">
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-4"
                style={{ background: 'rgba(139, 154, 107, 0.1)', border: `1px solid ${CARD_BORDER}` }}
              >
                <Icon name="lock" className="text-3xl" style={{ color: OLIVE_ACCENT }} />
              </div>
              <h2 className="text-xl font-bold mb-1" style={{ fontFamily: 'var(--font-headline)', color: CREAM }}>Enter Passcode</h2>
              <p className="text-white/40 text-sm">Staff passcode to exit kiosk mode</p>
            </div>

            <div className="flex justify-center gap-3 mb-6">
              {passcodeDigits.map((digit, i) => (
                <input
                  key={`passcode-${i}`}
                  ref={el => { passcodeInputRefs.current[i] = el; }}
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={1}
                  value={digit}
                  onChange={e => handlePasscodeDigitChange(i, e.target.value)}
                  onKeyDown={e => handlePasscodeKeyDown(i, e)}
                  disabled={passcodeChecking}
                  className={`w-14 h-16 text-center text-2xl font-bold rounded-xl border-2 bg-black/30 text-white outline-none transition-colors duration-200 ${
                    passcodeError
                      ? 'border-red-500 animate-shake'
                      : digit
                        ? 'border-[#8B9A6B]/50'
                        : 'border-white/15 focus:border-[#8B9A6B]/40'
                  } disabled:opacity-50`}
                  autoComplete="off"
                  style={{ WebkitTextSecurity: 'disc' } as React.CSSProperties}
                />
              ))}
            </div>

            {passcodeError && (
              <p className="text-red-400 text-sm text-center mb-4 animate-in fade-in duration-200">
                {passcodeErrorMessage || 'Incorrect passcode. Try again.'}
              </p>
            )}

            {passcodeChecking && (
              <div className="flex justify-center mb-4">
                <div className="w-6 h-6 rounded-full border-2 border-white/20 animate-spin" style={{ borderTopColor: OLIVE_ACCENT }} />
              </div>
            )}

            <button
              onClick={() => handlePasscodeSubmit(passcodeDigits)}
              disabled={passcodeChecking || passcodeDigits.some(d => !d)}
              className="w-full py-3 rounded-xl font-medium text-sm transition-opacity duration-200 disabled:opacity-30 mb-2"
              style={{ background: OLIVE_ACCENT, color: '#1a220c' }}
            >
              {passcodeChecking ? 'Verifying...' : 'Submit'}
            </button>

            <button
              onClick={handlePasscodeClose}
              className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showPaymentModal && preflightBooking && preflightBooking.sessionId && preflightData?.memberId && (
        <MemberPaymentModal
          isOpen={showPaymentModal}
          bookingId={preflightBooking.bookingId}
          sessionId={preflightBooking.sessionId}
          ownerEmail={preflightBooking.ownerEmail}
          ownerName={preflightBooking.ownerName}
          kioskMode
          memberId={preflightData.memberId}
          onSuccess={handlePaymentSuccess}
          onClose={handlePaymentDismissed}
        />
      )}
    </div>
  );
};

export default KioskCheckin;
