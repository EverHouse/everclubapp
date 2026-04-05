import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, useMotionValue, useTransform, useSpring, frame } from 'framer-motion';
import { getTierColor, isLightTierBackground } from '../../../utils/tierUtils';
import { formatMemberSince } from '../../../utils/dateUtils';
import { apiRequestBlob } from '../../../lib/apiRequest';
import TierBadge from '../../../components/TierBadge';
import ModalShell from '../../../components/ModalShell';
import MetricsGrid from '../../../components/MetricsGrid';
import type { GuestPasses, DashboardWellnessClass, DashboardEvent } from './dashboardTypes';
import Icon from '../../../components/icons/Icon';
import { springPresets } from '../../../utils/motion';
import QRCode from 'qrcode';

interface UserLike {
  id?: string | number;
  name?: string;
  email?: string;
  tier?: string;
  role?: string;
  status?: string;
  joinDate?: string;
  lifetimeVisits?: number;
  firstName?: string | null;
}

interface MembershipCardProps {
  user: UserLike | null;
  isDark: boolean;
  isStaffOrAdminProfile: boolean;
  statsData?: { guestPasses: GuestPasses | null; lifetimeVisitCount: number } | null;
  guestPasses: GuestPasses | null;
  tierPermissions: { dailySimulatorMinutes: number; dailyConfRoomMinutes: number };
  simMinutesToday: number;
  confMinutesToday: number;
  nextWellnessClass?: DashboardWellnessClass;
  nextEvent?: DashboardEvent;
  walletPassAvailable: boolean;
  isCardOpen: boolean;
  setIsCardOpen: (v: boolean) => void;
  navigate: (path: string, opts?: { state?: Record<string, unknown> }) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning', duration?: number) => void;
}

const SPRING_CONFIG = springPresets.tilt;
const REST_X = 0.5;
const REST_Y = 0.5;

function useCardLightEffects() {
  const cardRef = useRef<HTMLDivElement>(null);
  const gyroListenerRef = useRef<((e: DeviceOrientationEvent) => void) | null>(null);
  const gyroPermissionAttempted = useRef(false);

  const mouseX = useMotionValue(REST_X);
  const mouseY = useMotionValue(REST_Y);

  const SHEEN_ANGLE = 105;
  const sheenPosition = useSpring(
    useTransform(mouseX, [0, 1], [0, 100]),
    SPRING_CONFIG
  );
  const iridescentBackground = useTransform(
    sheenPosition,
    (pos: number) =>
      `linear-gradient(${SHEEN_ANGLE}deg, transparent ${pos - 20}%, rgba(255,190,230,0.09) ${pos - 10}%, rgba(255,255,255,0.16) ${pos - 3}%, rgba(255,255,255,0.20) ${pos}%, rgba(255,255,255,0.16) ${pos + 3}%, rgba(170,210,255,0.09) ${pos + 10}%, transparent ${pos + 20}%)`
  );

  const edgeAngle = useSpring(
    useTransform([mouseX, mouseY], ([mx, my]: number[]) => {
      const angle = Math.atan2(my - 0.5, mx - 0.5) * (180 / Math.PI) + 180;
      return angle;
    }),
    SPRING_CONFIG
  );
  const edgeGlimmerBackground = useTransform(
    edgeAngle,
    (a: number) =>
      `conic-gradient(from ${a}deg, transparent 0deg, rgba(255,200,240,0.5) 30deg, rgba(180,220,255,0.6) 60deg, rgba(200,255,220,0.5) 90deg, transparent 120deg, transparent 180deg, rgba(255,220,180,0.4) 210deg, rgba(200,180,255,0.5) 240deg, transparent 270deg, transparent 360deg)`
  );

  const shimmerPosition = useSpring(
    useTransform(mouseX, [0, 1], [-100, 200]),
    SPRING_CONFIG
  );
  const shimmerBackground = useTransform(
    shimmerPosition,
    (pos: number) =>
      `linear-gradient(${SHEEN_ANGLE}deg, transparent ${pos - 20}%, rgba(255,255,255,0.18) ${pos}%, transparent ${pos + 20}%)`
  );

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const startGyroListener = useCallback(() => {
    if (gyroListenerRef.current) return;

    let baseBeta: number | null = null;
    let baseGamma: number | null = null;
    let smoothNx = REST_X;
    let smoothNy = REST_Y;
    const GYRO_RANGE = 20;
    const SMOOTHING = 0.15;
    const DEAD_ZONE = 1.5;

    const handler = (e: DeviceOrientationEvent) => {
      if (e.beta === null && e.gamma === null) return;

      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;

      if (baseBeta === null || baseGamma === null) {
        baseBeta = beta;
        baseGamma = gamma;
        return;
      }

      let deltaB = beta - baseBeta;
      let deltaG = gamma - baseGamma;

      if (Math.abs(deltaB) < DEAD_ZONE) deltaB = 0;
      if (Math.abs(deltaG) < DEAD_ZONE) deltaG = 0;

      const rawNx = Math.max(0, Math.min(1, 0.5 + deltaG / (GYRO_RANGE * 2)));
      const rawNy = Math.max(0, Math.min(1, 0.5 + deltaB / (GYRO_RANGE * 2)));

      smoothNx += (rawNx - smoothNx) * SMOOTHING;
      smoothNy += (rawNy - smoothNy) * SMOOTHING;

      frame.update(() => {
        mouseX.set(smoothNx);
        mouseY.set(smoothNy);
      });
    };
    gyroListenerRef.current = handler;
    window.addEventListener('deviceorientation', handler);
  }, [mouseX, mouseY]);

  useEffect(() => {
    return () => {
      if (gyroListenerRef.current) {
        window.removeEventListener('deviceorientation', gyroListenerRef.current);
        gyroListenerRef.current = null;
      }
    };
  }, []);

  const requestGyroPermission = useCallback(() => {
    if (prefersReducedMotion || gyroListenerRef.current || gyroPermissionAttempted.current) return;
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return;

    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };

    if (typeof DOE.requestPermission === 'function') {
      gyroPermissionAttempted.current = true;
      DOE.requestPermission().then((state: string) => {
        if (state === 'granted') startGyroListener();
      }).catch(() => {});
    }
  }, [prefersReducedMotion, startGyroListener]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return;

    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DOE.requestPermission !== 'function') {
      startGyroListener();
    }
  }, [prefersReducedMotion, startGyroListener]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (prefersReducedMotion) return;
      const el = cardRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      frame.update(() => {
        mouseX.set(nx);
        mouseY.set(ny);
      });
    },
    [prefersReducedMotion, mouseX, mouseY]
  );

  const handlePointerLeave = useCallback(() => {
    frame.update(() => {
      mouseX.set(REST_X);
      mouseY.set(REST_Y);
    });
  }, [mouseX, mouseY]);

  return {
    cardRef,
    iridescentBackground: prefersReducedMotion ? undefined : iridescentBackground,
    edgeGlimmerBackground: prefersReducedMotion ? undefined : edgeGlimmerBackground,
    shimmerBackground: prefersReducedMotion ? undefined : shimmerBackground,
    handlePointerMove,
    handlePointerLeave,
    requestGyroPermission,
    prefersReducedMotion,
  };
}

export const MembershipCard: React.FC<MembershipCardProps> = ({
  user, isDark, isStaffOrAdminProfile, statsData, guestPasses, tierPermissions,
  simMinutesToday, confMinutesToday, nextWellnessClass, nextEvent,
  walletPassAvailable, isCardOpen, setIsCardOpen, navigate, showToast,
}) => {
  if (isStaffOrAdminProfile || !user) return null;

  const isExpired = user.status === 'Expired';
  const isVisitor = user.role === 'visitor';
  const tierColors = isVisitor ? { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' } : getTierColor(user.tier || '');
  const cardBgColor = isExpired ? '#6B7280' : tierColors.bg;
  const cardTextColor = isExpired ? '#F9FAFB' : tierColors.text;
  const useDarkLogo = isExpired || isLightTierBackground(cardBgColor);

  const {
    cardRef, iridescentBackground, edgeGlimmerBackground, shimmerBackground,
    handlePointerMove, handlePointerLeave, requestGyroPermission, prefersReducedMotion,
  } = useCardLightEffects();

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 mb-6">
        <div className="relative h-56 lg:h-full lg:min-h-56">
          {!prefersReducedMotion && (
            <motion.div
              className="absolute -inset-[1.5px] rounded-xl pointer-events-none"
              style={{
                background: edgeGlimmerBackground,
                filter: 'blur(2px)',
                willChange: 'background',
              }}
              aria-hidden="true"
            />
          )}
          <div
            ref={cardRef}
            onClick={() => { requestGyroPermission(); setIsCardOpen(true); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsCardOpen(true); } }}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            className={`relative h-full w-full rounded-xl overflow-hidden cursor-pointer group transition-transform duration-150 motion-safe:active:scale-[0.98] ${isExpired ? 'grayscale-[30%]' : ''}`}
            style={{ touchAction: 'none' }}
          >
          <div className="absolute inset-0" style={{ backgroundColor: cardBgColor }}></div>
          <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.05) 100%)' }}></div>
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")` }}></div>
          <div className="absolute inset-0 border border-white/20 rounded-xl" style={{ boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.2)' }}></div>
          {!prefersReducedMotion && (
            <motion.div
              className="absolute inset-0 rounded-xl pointer-events-none z-[3]"
              style={{ background: shimmerBackground, willChange: 'background' }}
              aria-hidden="true"
            />
          )}
          {!prefersReducedMotion && (
            <motion.div
              className="absolute inset-0 rounded-xl pointer-events-none z-[5]"
              style={{ background: iridescentBackground, willChange: 'background' }}
            />
          )}
          <div className="absolute inset-0 p-6 flex flex-col justify-between z-10">
            <div className="flex justify-between items-start">
              <img src={useDarkLogo ? "/images/everclub-logo-dark.webp" : "/images/everclub-logo-light.webp"} className={`h-10 w-auto ${isExpired ? 'opacity-50' : 'opacity-90'}`} alt="" width={100} height={40} />
              <div className="flex flex-col items-end gap-1">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: `${cardTextColor}99` }}>Ever Club</span>
                {isExpired && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-500 text-white">
                    Expired
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <TierBadge tier={user.tier} size="sm" role={user.role} membershipStatus={user.status} />
              </div>
              <h3 className="text-xl font-display font-bold tracking-wide" style={{ color: cardTextColor, textShadow: '0 1px 3px rgba(0,0,0,0.15)' }}>{user.name}</h3>
              {isExpired ? (
                <p className="text-xs mt-2 text-red-200">Membership expired - Contact us to renew</p>
              ) : (
                <>
                  {user.joinDate && (
                    <p className="text-xs mt-2" style={{ color: `${cardTextColor}80` }}>Joined {formatMemberSince(user.joinDate)}</p>
                  )}
                  {(() => {
                    const visitCount = statsData?.lifetimeVisitCount ?? user.lifetimeVisits;
                    return visitCount !== undefined ? (
                      <p className="text-xs" style={{ color: `${cardTextColor}80` }}>{visitCount} {visitCount === 1 ? 'lifetime visit' : 'lifetime visits'}</p>
                    ) : null;
                  })()}
                </>
              )}
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity duration-normal z-20 p-4 pointer-events-none">
            <div className="w-full py-2 px-4 rounded-xl bg-black/40 backdrop-blur-md border border-white/20 text-center" style={{ boxShadow: '0 -4px 16px rgba(0,0,0,0.1)' }}>
              <span className="font-bold text-sm text-white/90">{isExpired ? 'Renew Membership' : 'View Membership Details'}</span>
            </div>
          </div>
        </div>
        </div>

        <div className="h-full">
          <MetricsGrid
            simulatorMinutesUsed={simMinutesToday}
            simulatorMinutesAllowed={tierPermissions.dailySimulatorMinutes}
            conferenceMinutesUsed={confMinutesToday}
            conferenceMinutesAllowed={tierPermissions.dailyConfRoomMinutes}
            nextWellnessClass={nextWellnessClass ? { title: nextWellnessClass.title, date: nextWellnessClass.date } : undefined}
            nextEvent={nextEvent ? { title: nextEvent.title, date: nextEvent.event_date } : undefined}
            onNavigate={navigate}
            className="h-full"
          />
        </div>
      </div>

      <MembershipDetailsModal
        user={user}
        isCardOpen={isCardOpen}
        setIsCardOpen={setIsCardOpen}
        isStaffOrAdminProfile={isStaffOrAdminProfile}
        tierPermissions={tierPermissions}
        guestPasses={guestPasses}
        walletPassAvailable={walletPassAvailable}
        showToast={showToast}
      />
    </>
  );
};

interface MembershipDetailsModalProps {
  user: UserLike | null;
  isCardOpen: boolean;
  setIsCardOpen: (v: boolean) => void;
  isStaffOrAdminProfile: boolean;
  tierPermissions: { dailySimulatorMinutes: number; dailyConfRoomMinutes: number };
  guestPasses: GuestPasses | null;
  walletPassAvailable: boolean;
  showToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning', duration?: number) => void;
}

const MembershipDetailsModal: React.FC<MembershipDetailsModalProps> = ({
  user, isCardOpen, setIsCardOpen, isStaffOrAdminProfile, tierPermissions, guestPasses, walletPassAvailable, showToast,
}) => {
  const [walletLoading, setWalletLoading] = useState(false);

  if (!user) return null;

  const isExpiredModal = user.status === 'Expired';
  const isVisitorModal = user.role === 'visitor' || !user.tier;
  const tierColors = isVisitorModal ? { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' } : getTierColor(user.tier);
  const cardBgColor = isExpiredModal ? '#6B7280' : (isStaffOrAdminProfile ? '#293515' : tierColors.bg);
  const cardTextColor = isExpiredModal ? '#F9FAFB' : (isStaffOrAdminProfile ? '#F2F2EC' : tierColors.text);

  return (
    <ModalShell 
      isOpen={isCardOpen && !!user} 
      onClose={() => setIsCardOpen(false)}
      showCloseButton={false}
      size="sm"
      className="!bg-transparent !border-0 !shadow-none"
    >
      <div className="flex flex-col items-center">
        <div className={`w-full rounded-xl relative overflow-hidden shadow-2xl flex flex-col ${isExpiredModal ? 'grayscale-[30%]' : ''}`} style={{ backgroundColor: cardBgColor }}>
          
          <button onClick={() => setIsCardOpen(false)} className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center z-10" style={{ backgroundColor: `${cardTextColor}33`, color: cardTextColor }} aria-label="Close card">
            <Icon name="close" className="text-sm" />
          </button>

          <div className="pt-6 px-6 pb-4 text-center" style={{ backgroundColor: cardBgColor }}>
            <h2 className="text-2xl font-bold mb-3" style={{ color: cardTextColor }}>{(user.name || '').includes('@') ? 'Member' : user.name}</h2>
            
            <div className="flex items-center justify-center gap-2 flex-wrap mb-2">
              <TierBadge tier={user.tier} size="md" role={user.role} membershipStatus={user.status} />
              {isExpiredModal && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-red-500 text-white">
                  Expired
                </span>
              )}
            </div>
            {isExpiredModal && (
              <div className="mt-4 p-3 rounded-xl bg-red-500/20 border border-red-500/30">
                <p className="text-sm text-red-200 text-center mb-2">Your membership has expired</p>
                <a 
                  href="/contact" 
                  className="tactile-btn block w-full py-2 px-4 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-lg text-center transition-colors"
                >
                  Contact Us to Renew
                </a>
              </div>
            )}
          </div>

          {!isExpiredModal && user.id && (
            <LocalQrCode userId={user.id} cardTextColor={cardTextColor} cardBgColor={cardBgColor} />
          )}

          <div className="px-6 pb-6" style={{ backgroundColor: cardBgColor }}>
            <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: `${cardTextColor}10` }}>
              <h3 className="text-sm font-bold uppercase tracking-wider opacity-60 mb-3" style={{ color: cardTextColor, fontFamily: 'var(--font-label)', letterSpacing: '0.1em' }}>Membership Benefits</h3>
              
              {user.joinDate && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Icon name="badge" className="text-lg opacity-60" />
                    <span className="text-sm opacity-80" style={{ color: cardTextColor }}>Member Since</span>
                  </div>
                  <span className="font-semibold text-sm" style={{ color: cardTextColor }}>{formatMemberSince(user.joinDate)}</span>
                </div>
              )}
              
              {tierPermissions.dailySimulatorMinutes > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Icon name="sports_golf" className="text-lg opacity-60" />
                    <span className="text-sm opacity-80" style={{ color: cardTextColor }}>Daily Simulator</span>
                  </div>
                  <span className="font-semibold text-sm" style={{ color: cardTextColor }}>
                    {tierPermissions.dailySimulatorMinutes === Infinity ? 'Unlimited' : `${tierPermissions.dailySimulatorMinutes} min`}
                  </span>
                </div>
              )}
              
              {tierPermissions.dailyConfRoomMinutes > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Icon name="meeting_room" className="text-lg opacity-60" />
                    <span className="text-sm opacity-80" style={{ color: cardTextColor }}>Daily Conference</span>
                  </div>
                  <span className="font-semibold text-sm" style={{ color: cardTextColor }}>
                    {tierPermissions.dailyConfRoomMinutes === Infinity ? 'Unlimited' : `${tierPermissions.dailyConfRoomMinutes} min`}
                  </span>
                </div>
              )}
              
              {guestPasses && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Icon name="group_add" className="text-lg opacity-60" />
                    <span className="text-sm opacity-80" style={{ color: cardTextColor }}>Guest Passes</span>
                  </div>
                  <span className="font-semibold text-sm" style={{ color: cardTextColor }}>
                    {guestPasses.passes_remaining} / {guestPasses.passes_total} remaining
                  </span>
                </div>
              )}
            </div>
          </div>

          {!isExpiredModal && walletPassAvailable && (
            <div className="px-6 pb-6 flex justify-center" style={{ backgroundColor: cardBgColor }}>
              <button
                onClick={async (e) => {
                  e.preventDefault();
                  if (walletLoading) return;
                  setWalletLoading(true);
                  try {
                    const response = await apiRequestBlob('/api/member/wallet-pass');
                    if (!response.ok || !response.blob) {
                      showToast(response.error || 'Failed to download wallet pass', 'error');
                      return;
                    }
                    const url = URL.createObjectURL(response.blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'EverClub-Pass.pkpass';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    showToast('Wallet pass downloaded — open it to add to your digital wallet', 'success', 5000);
                  } catch {
                    showToast('Failed to download wallet pass', 'error');
                  } finally {
                    setWalletLoading(false);
                  }
                }}
                disabled={walletLoading}
                className={`tactile-btn inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold transition-opacity duration-200 ${walletLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
                style={{
                  backgroundColor: '#000000',
                  color: '#FFFFFF',
                  minWidth: '240px',
                }}
                aria-label="Add to Digital Wallet"
              >
                {walletLoading ? (
                  <Icon name="progress_activity" className="animate-spin text-[24px]" />
                ) : (
                  <Icon name="wallet" className="text-[24px] text-white" />
                )}
                <span>
                  <span style={{ fontSize: '10px', fontWeight: 400, display: 'block', lineHeight: 1.2 }}>Add to</span>
                  <span style={{ fontSize: '16px', fontWeight: 600, display: 'block', lineHeight: 1.2 }}>Digital Wallet</span>
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
};

const LocalQrCode: React.FC<{ userId: string | number; cardTextColor: string; cardBgColor: string }> = ({ userId, cardTextColor, cardBgColor }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    QRCode.toCanvas(canvas, `MEMBER:${userId}`, { width: 200, margin: 1 }, (err) => {
      if (!err) setReady(true);
    });
  }, [userId]);

  return (
    <div className="px-6 pb-2 flex flex-col items-center" style={{ backgroundColor: cardBgColor }}>
      <div className="bg-white p-3 rounded-xl shadow-md inline-flex items-center justify-center">
        <canvas ref={canvasRef} style={{ display: ready ? 'block' : 'none', width: 'min(140px, 36vw)', height: 'min(140px, 36vw)' }} />
      </div>
      <p className="text-xs mt-1.5 opacity-50" style={{ color: cardTextColor }}>Show for quick check-in</p>
    </div>
  );
};
