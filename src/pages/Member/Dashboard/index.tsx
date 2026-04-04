import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { getPacificHour, CLUB_TIMEZONE } from '../../../utils/dateUtils';
import { DashboardSkeleton, SkeletonCrossfade, DashboardCardSkeleton, BookingCardSkeleton } from '../../../components/skeletons';
import { SmoothReveal } from '../../../components/motion/SmoothReveal';
import { AnimatedPage } from '../../../components/motion';
import ClosureAlert from '../../../components/ClosureAlert';
import AnnouncementAlert from '../../../components/AnnouncementAlert';
import ErrorState from '../../../components/ErrorState';
import OnboardingChecklist from '../../../components/OnboardingChecklist';
import ModalShell from '../../../components/ModalShell';
import FirstLoginWelcomeModal from '../../../components/FirstLoginWelcomeModal';
import NfcCheckinWelcomeModal from '../../../components/NfcCheckinWelcomeModal';
import { useDashboardData } from './useDashboardData';
import { useTierNames } from '../../../hooks/useTierNames';
import { MembershipCard } from './MembershipCard';
import { ScheduleSection } from './ScheduleSection';
import { PasskeyNudge, BannerAlert, MembershipStatusAlert } from './DashboardAlerts';
import Icon from '../../../components/icons/Icon';

const skeletonExitTransition = {
  type: 'spring' as const,
  stiffness: 200,
  damping: 24,
  mass: 0.6,
};

const contentSpring = {
  type: 'spring' as const,
  stiffness: 160,
  damping: 20,
  mass: 0.8,
};

const sectionVariants = {
  hidden: { opacity: 0, y: 8, scale: 0.95 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      ...contentSpring,
      delay: i * 0.06,
    },
  }),
};

const getGreeting = () => {
  const hour = getPacificHour();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

const Dashboard: React.FC = () => {
  const data = useDashboardData();
  useTierNames();
  const [scheduleRef] = useAutoAnimate();
  const prefersReduced = useReducedMotion();

  const {
    navigate, queryClient, user, isDark, isStaffOrAdminProfile, tierPermissions,
    startNavigation, showToast,

    confirmModal, setConfirmModal,
    isCardOpen, setIsCardOpen,
    bannerDismissed, setBannerDismissed,
    bannerExiting, setBannerExiting,
    bannerExitTimer,
    showPasskeyNudge, setShowPasskeyNudge,
    walletPassDownloading,
    showFirstLoginModal, setShowFirstLoginModal,
    nfcCheckinData, setNfcCheckinData,

    coreScheduleLoading,
    initialLoading,
    statsLoading,
    error,
    rsvpSectionError,
    wellnessSectionError,
    eventsSectionError,
    conferenceRoomSectionError,
    statsSectionError,

    guestPasses,
    bannerAnnouncement,
    isBannerInitiallyDismissed,
    walletPassAvailable,
    statsData,

    simMinutesToday,
    confMinutesToday,
    nextEvent,
    nextWellnessClass,
    upcomingItemsFiltered,

    refetchAllData,
    handleCancelBooking,
    handleLeaveBooking,
    handleCancelRSVP,
    handleCancelWellness,
    handleDownloadBookingWalletPass,
  } = data;

  if (error) {
    return (
      <div className="full-bleed-page px-6 pb-32 bg-transparent pt-4">
        <ErrorState
          title="Unable to load dashboard"
          message={error}
          onRetry={() => {
            refetchAllData();
          }}
          showSupport
        />
      </div>
    );
  }

  return (
    <AnimatedPage>
    <div className="full-bleed-page flex flex-col">
    <AnimatePresence mode="wait">
    {initialLoading ? (
      <motion.div
        key="dashboard-skeleton"
        initial={{ opacity: 1 }}
        exit={prefersReduced
          ? { opacity: 0, transition: { duration: 0 } }
          : { opacity: 0, scale: 0.98, transition: skeletonExitTransition }
        }
      >
        <DashboardSkeleton />
      </motion.div>
    ) : (
    <motion.div
      key="dashboard-content"
      className="flex-1 flex flex-col"
      initial={prefersReduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={prefersReduced ? { duration: 0 } : contentSpring}
    >
      <div className="px-6 lg:px-8 xl:px-12 pt-4 md:pt-2 pb-32 font-sans relative flex-1">
        <ClosureAlert />
        <AnnouncementAlert />

        <PasskeyNudge
          isDark={isDark}
          showPasskeyNudge={showPasskeyNudge}
          setShowPasskeyNudge={setShowPasskeyNudge}
          startNavigation={startNavigation}
          navigate={navigate}
        />

        <SmoothReveal isLoaded={!!bannerAnnouncement && !bannerDismissed && !isBannerInitiallyDismissed} delay={50}>
          <BannerAlert
            isDark={isDark}
            bannerAnnouncement={bannerAnnouncement}
            bannerDismissed={bannerDismissed}
            isBannerInitiallyDismissed={isBannerInitiallyDismissed}
            bannerExiting={bannerExiting}
            setBannerExiting={setBannerExiting}
            setBannerDismissed={setBannerDismissed}
            bannerExitTimer={bannerExitTimer}
            userEmail={user?.email}
            startNavigation={startNavigation}
            navigate={navigate}
          />
        </SmoothReveal>
        
        <SmoothReveal isLoaded={!!user?.status && !['active', 'trialing', 'past_due'].includes(user.status.toLowerCase())} delay={100}>
          <MembershipStatusAlert isDark={isDark} userStatus={user?.status} />
        </SmoothReveal>
        
        <OnboardingChecklist />
        
        <motion.div
          className="mb-6"
          style={{ minHeight: '72px' }}
          {...(prefersReduced
            ? {}
            : { variants: sectionVariants, initial: 'hidden', animate: 'visible', custom: 0 }
          )}
        >
          <div className="flex items-center gap-3">
            <h1 className={`text-3xl sm:text-4xl md:text-5xl leading-none translate-y-[1px] ${isDark ? 'text-white' : 'text-primary'}`} style={{ fontFamily: 'var(--font-display)', fontOpticalSizing: 'auto', letterSpacing: '-0.03em' }}>
              {getGreeting()}, {user?.firstName || (user?.name && !user.name.includes('@') ? user.name.split(' ')[0] : 'there')}
            </h1>
          </div>
          <p className={`text-sm lg:text-base font-medium mt-1 ${isDark ? 'text-white/80' : 'text-primary/80'}`}>
            {new Date().toLocaleDateString('en-US', { timeZone: CLUB_TIMEZONE, weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </motion.div>

        {!isStaffOrAdminProfile && (
          <div>
            <SkeletonCrossfade
              loading={!!statsLoading}
              delay={60}
              skeleton={
                <div className="mb-6 p-5 rounded-xl backdrop-blur-xl border shadow-lg shadow-black/5 bg-white/10 border-white/20 space-y-3">
                  <DashboardCardSkeleton isDark={isDark} />
                  <DashboardCardSkeleton isDark={isDark} />
                </div>
              }
            >
              <MembershipCard
                user={user}
                isDark={isDark}
                isStaffOrAdminProfile={isStaffOrAdminProfile}
                statsData={statsData}
                guestPasses={guestPasses}
                tierPermissions={tierPermissions}
                simMinutesToday={simMinutesToday}
                confMinutesToday={confMinutesToday}
                nextWellnessClass={nextWellnessClass}
                nextEvent={nextEvent}
                walletPassAvailable={walletPassAvailable}
                isCardOpen={isCardOpen}
                setIsCardOpen={setIsCardOpen}
                navigate={navigate}
                showToast={showToast}
              />
            </SkeletonCrossfade>
            {statsSectionError && (
              <div className={`mt-3 p-3 rounded-xl text-xs flex items-center gap-2 ${isDark ? 'bg-red-500/10 border border-red-500/20 text-red-300' : 'bg-red-50 border border-red-200 text-red-600'}`}>
                <Icon name="error" className="text-sm" />
                Unable to load membership stats. Other sections are up to date.
              </div>
            )}
          </div>
        )}

        <div>
          <SkeletonCrossfade
            loading={coreScheduleLoading}
            delay={120}
            skeleton={
              <div style={{ minHeight: '200px' }}>
                <div className="mb-4 px-1">
                  <div className="skeleton-shimmer bg-gray-200 dark:bg-white/10 h-7 w-32 rounded" />
                </div>
                <div className="space-y-3">
                  <BookingCardSkeleton isDark={isDark} />
                  <BookingCardSkeleton isDark={isDark} />
                  <BookingCardSkeleton isDark={isDark} />
                </div>
              </div>
            }
          >
            <ScheduleSection
              isDark={isDark}
              upcomingItemsFiltered={upcomingItemsFiltered}
              isStaffOrAdminProfile={isStaffOrAdminProfile}
              walletPassAvailable={walletPassAvailable}
              walletPassDownloading={walletPassDownloading}
              rsvpSectionError={rsvpSectionError}
              wellnessSectionError={wellnessSectionError}
              eventsSectionError={eventsSectionError}
              conferenceRoomSectionError={conferenceRoomSectionError}
              startNavigation={startNavigation}
              navigate={navigate}
              refetchAllData={refetchAllData}
              handleCancelBooking={handleCancelBooking}
              handleLeaveBooking={handleLeaveBooking}
              handleCancelRSVP={handleCancelRSVP}
              handleCancelWellness={handleCancelWellness}
              handleDownloadBookingWalletPass={handleDownloadBookingWalletPass}
              scheduleRef={scheduleRef}
            />
          </SkeletonCrossfade>
        </div>
      </div>

    <ModalShell 
      isOpen={!!confirmModal} 
      onClose={() => setConfirmModal(null)}
      title={confirmModal?.title || ''}
      size="sm"
    >
      {confirmModal && (
        <div className="p-6">
          <p className="mb-6 text-sm opacity-70">{confirmModal.message}</p>
          <div className="flex gap-3">
            <button 
              onClick={() => setConfirmModal(null)}
              className={`tactile-btn flex-1 py-3 rounded-xl font-bold text-sm cursor-pointer ${isDark ? 'bg-white/10 hover:bg-white/20' : 'bg-gray-100 hover:bg-gray-200'}`}
            >
              Keep it
            </button>
            <button 
              onClick={confirmModal.onConfirm}
              className="tactile-btn flex-1 py-3 rounded-xl font-bold text-sm bg-red-500 hover:bg-red-600 text-white shadow-lg cursor-pointer"
            >
              Yes, Cancel
            </button>
          </div>
        </div>
      )}
    </ModalShell>

    <FirstLoginWelcomeModal
      isOpen={showFirstLoginModal}
      onClose={() => setShowFirstLoginModal(false)}
      firstName={user?.firstName || (user?.name && !user.name.includes('@') ? user.name.split(' ')[0] : undefined)}
    />

    <NfcCheckinWelcomeModal
      isOpen={!!nfcCheckinData}
      onClose={() => setNfcCheckinData(null)}
      checkinData={nfcCheckinData}
    />
    </motion.div>
  )}
    </AnimatePresence>
    </div>
    </AnimatedPage>
  );
};

export default Dashboard;
