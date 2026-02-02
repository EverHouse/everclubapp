import React from 'react';
import { createPortal } from 'react-dom';

interface WalkingGolferLoaderProps {
  isVisible?: boolean;
  onFadeComplete?: () => void;
}

const taglines = [
  "Your second home.",
  "Rooted in golf, built for community.",
  "Where design meets lifestyle.",
  "Elevate your everyday experience.",
  "Come in, settle down, stay awhile.",
  "A place to focus, meet, and connect.",
  "Step onto the green.",
  "Golf all year.",
  "Where every day feels like a day on the course.",
  "Practice with purpose.",
  "Tour-level data, right here at home.",
  "Inspire. Engage. Elevate.",
  "Effortless balance.",
  "Play through.",
  "Refined leisure.",
  "Always open.",
  "A welcoming community.",
  "More than a sport.",
  "Productivity meets leisure."
];

const WalkingGolferLoader: React.FC<WalkingGolferLoaderProps> = ({ isVisible = true, onFadeComplete }) => {
  const [isExiting, setIsExiting] = React.useState(false);
  const [shouldRender, setShouldRender] = React.useState(true);
  const [tagline] = React.useState(() => taglines[Math.floor(Math.random() * taglines.length)]);
  const exitTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const onFadeCompleteRef = React.useRef(onFadeComplete);
  
  // Determine theme using DOM check (works regardless of Router context)
  // This runs on mount and checks current state
  const [themeState] = React.useState(() => {
    const path = window.location.pathname;
    const isPortal = path.startsWith('/member') || path.startsWith('/admin') || path.startsWith('/profile') || 
                     path.startsWith('/history') || path.startsWith('/book') || path.startsWith('/wellness') || 
                     path.startsWith('/events') || path.startsWith('/updates');
    const isDarkMode = document.documentElement.classList.contains('dark');
    return { isPortal, isDarkMode };
  });
  
  // Public pages always light, portals respect theme
  const useDarkBackground = themeState.isPortal && themeState.isDarkMode;
  const backgroundColor = useDarkBackground ? '#1a1a1a' : '#F2F2EC';
  const mascotSrc = useDarkBackground ? '/assets/logos/walking-mascot-white.gif' : '/assets/logos/walking-mascot-green.gif';
  const textColor = useDarkBackground ? 'white' : '#1B4332';
  
  React.useEffect(() => {
    onFadeCompleteRef.current = onFadeComplete;
  }, [onFadeComplete]);

  React.useEffect(() => {
    if (!isVisible) {
      setIsExiting(true);
      
      if (exitTimeoutRef.current) {
        clearTimeout(exitTimeoutRef.current);
      }
      
      exitTimeoutRef.current = setTimeout(() => {
        setShouldRender(false);
        onFadeCompleteRef.current?.();
      }, 750);
      
      return () => {
        if (exitTimeoutRef.current) {
          clearTimeout(exitTimeoutRef.current);
        }
      };
    }
  }, [isVisible]);

  if (!shouldRender) return null;

  const loaderContent = (
    <div 
      className={`loader-overlay ${isExiting ? 'loader-exit' : ''}`}
      style={{ pointerEvents: isExiting ? 'none' : 'auto', backgroundColor }}
    >
      <div className={`loader-content ${isExiting ? 'content-exit' : ''}`}>
        <div className="walking-mascot">
          <img 
            src={mascotSrc}
            alt="Loading..." 
            className="mascot-image"
          />
        </div>
        <p className="tagline-text" style={{ color: textColor }}>{tagline}</p>
      </div>

      <style>{`
        .loader-overlay {
          position: fixed;
          inset: 0;
          z-index: 99999;
          display: flex;
          justify-content: center;
          align-items: center;
          will-change: transform, height, clip-path;
        }

        .loader-exit {
          animation: minimizeToStatusBar 0.55s cubic-bezier(0.32, 0, 0.67, 0) forwards;
          pointer-events: none;
        }

        @keyframes minimizeToStatusBar {
          0% {
            transform: translateY(0);
            opacity: 1;
          }
          100% {
            transform: translateY(-100%);
            opacity: 1;
          }
        }

        .loader-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.5rem;
          will-change: opacity, transform;
        }

        .content-exit {
          animation: contentFadeOut 0.3s cubic-bezier(0.4, 0, 1, 1) forwards;
        }

        @keyframes contentFadeOut {
          0% {
            opacity: 1;
            transform: translateY(0);
          }
          100% {
            opacity: 0;
            transform: translateY(-30px);
          }
        }

        .mascot-image {
          width: 120px;
          height: auto;
        }

        .tagline-text {
          font-family: 'Playfair Display', serif;
          font-size: 1rem;
          text-align: center;
          margin: 0;
          padding: 0 2rem;
          opacity: 0;
          animation: taglineFadeIn 0.6s ease-out 0.3s forwards;
        }

        @keyframes taglineFadeIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .walking-mascot {
          display: flex;
          justify-content: center;
          align-items: center;
        }
      `}</style>
    </div>
  );

  // Portal to body to escape #root's stacking context (isolation: isolate)
  return createPortal(loaderContent, document.body);
};

export default WalkingGolferLoader;
