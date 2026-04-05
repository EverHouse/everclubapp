import React, { useState, useEffect } from 'react';

const loadingMessages = [
  "Mowing the fairways…",
  "Raking the bunkers…",
  "Filling in divots…",
  "Chasing geese off the 9th green…",
  "Checking wind speed and direction…",
  "Stocking the beverage cart…",
  "Placing the pins…",
  "Rolling the greens…",
  "Practicing the practice swing…",
  "Looking for lost balls in the woods…",
  "Overthinking the putt…",
  "Blaming the wind…",
  "Taking a mulligan…",
  "Waiting on the group ahead…",
  "Recalculating the handicap…",
  "Fishing a ball out of the water hazard…",
  "Checking the scorecard math…",
  "Selecting the wrong club…",
  "Polishing the irons…",
  "Searching for the lucky tee…",
  "Zipping the golf bag…",
  "Cleaning the golf balls…",
  "Tying the golf spikes…",
  "Consulting the yardage book…",
  "Yelling 'Fore!'…",
  "Slicing into the next dimension…",
  "Trying to get out of the sand…",
  "Reading the break…",
  "Driving for show, putting for dough…",
];

interface PageLoadingSpinnerProps {
  variant?: 'dark' | 'light' | 'auto';
  message?: string;
}

const PageLoadingSpinner: React.FC<PageLoadingSpinnerProps> = ({
  variant = 'auto',
  message,
}) => {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  const [tagline] = useState(() =>
    message || loadingMessages[Math.floor(Math.random() * loadingMessages.length)]
  );

  useEffect(() => {
    if (variant !== 'auto') return;

    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    setIsDark(document.documentElement.classList.contains('dark'));

    return () => observer.disconnect();
  }, [variant]);

  const resolvedDark = variant === 'auto' ? isDark : variant === 'light';

  const imageSrc = resolvedDark
    ? '/assets/logos/walking-mascot-white.gif'
    : '/assets/logos/walking-mascot-green.gif';

  const textColor = resolvedDark ? 'text-white/60' : 'text-primary/50';

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <img
        src={imageSrc}
        alt="Loading"
        className="h-auto"
        width={80}
        height={80}
        style={{ width: '80px' }}
      />
      <p
        className={`text-sm font-medium tracking-wide ${textColor}`}
        style={{ fontFamily: 'var(--font-body)' }}
      >
        {tagline}
      </p>
    </div>
  );
};

export default PageLoadingSpinner;
