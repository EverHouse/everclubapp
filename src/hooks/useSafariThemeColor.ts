import { useEffect, useRef } from 'react';

const OVERLAY_LIGHT = '#FFFFFF';
const OVERLAY_DARK = '#1a1a1a';

export function useSafariThemeColor(isActive: boolean) {
  const previousBodyBgRef = useRef<string>('');
  const previousHtmlBgRef = useRef<string>('');

  useEffect(() => {
    if (!isActive) return;

    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const overlayColor = isDark ? OVERLAY_DARK : OVERLAY_LIGHT;

    previousBodyBgRef.current = document.body.style.backgroundColor || '';
    previousHtmlBgRef.current = document.documentElement.style.backgroundColor || '';

    document.documentElement.style.backgroundColor = overlayColor;
    document.body.style.backgroundColor = overlayColor;

    return () => {
      document.documentElement.style.backgroundColor = previousHtmlBgRef.current;
      document.body.style.backgroundColor = previousBodyBgRef.current;
    };
  }, [isActive]);
}
