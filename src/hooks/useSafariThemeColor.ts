import { useEffect, useRef } from 'react';

const LIGHT_DEFAULT = '#293515';
const DARK_DEFAULT = '#1a2310';
const OVERLAY_LIGHT = '#FFFFFF';
const OVERLAY_DARK = '#1a1a1a';

export function useSafariThemeColor(isActive: boolean) {
  const previousLightRef = useRef<string | null>(null);
  const previousDarkRef = useRef<string | null>(null);
  const previousBodyBgRef = useRef<string>('');
  const previousHtmlBgRef = useRef<string>('');

  useEffect(() => {
    if (!isActive) return;

    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const overlayColor = isDark ? OVERLAY_DARK : OVERLAY_LIGHT;

    const metaLight = document.querySelector('meta[name="theme-color"][media*="light"]');
    const metaDark = document.querySelector('meta[name="theme-color"][media*="dark"]');

    previousLightRef.current = metaLight?.getAttribute('content') || LIGHT_DEFAULT;
    previousDarkRef.current = metaDark?.getAttribute('content') || DARK_DEFAULT;
    previousBodyBgRef.current = document.body.style.backgroundColor || '';
    previousHtmlBgRef.current = document.documentElement.style.backgroundColor || '';

    if (metaLight) metaLight.setAttribute('content', OVERLAY_LIGHT);
    if (metaDark) metaDark.setAttribute('content', OVERLAY_DARK);
    document.documentElement.style.backgroundColor = overlayColor;
    document.body.style.backgroundColor = overlayColor;

    return () => {
      const metaLight = document.querySelector('meta[name="theme-color"][media*="light"]');
      const metaDark = document.querySelector('meta[name="theme-color"][media*="dark"]');

      if (metaLight) metaLight.setAttribute('content', previousLightRef.current || LIGHT_DEFAULT);
      if (metaDark) metaDark.setAttribute('content', previousDarkRef.current || DARK_DEFAULT);
      document.documentElement.style.backgroundColor = previousHtmlBgRef.current;
      document.body.style.backgroundColor = previousBodyBgRef.current;
    };
  }, [isActive]);
}
