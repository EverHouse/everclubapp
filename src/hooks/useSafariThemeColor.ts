import { useEffect, useRef } from 'react';

const LIGHT_DEFAULT = '#293515';
const DARK_DEFAULT = '#1a2310';
const LIGHT_OVERLAY = '#FFFFFF';
const DARK_OVERLAY = '#1a1d15';

export function useSafariThemeColor(isActive: boolean) {
  const previousLightRef = useRef<string | null>(null);
  const previousDarkRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isActive) return;

    const metaLight = document.querySelector('meta[name="theme-color"][media*="light"]');
    const metaDark = document.querySelector('meta[name="theme-color"][media*="dark"]');

    previousLightRef.current = metaLight?.getAttribute('content') || LIGHT_DEFAULT;
    previousDarkRef.current = metaDark?.getAttribute('content') || DARK_DEFAULT;

    if (metaLight) metaLight.setAttribute('content', LIGHT_OVERLAY);
    if (metaDark) metaDark.setAttribute('content', DARK_OVERLAY);

    return () => {
      const metaLight = document.querySelector('meta[name="theme-color"][media*="light"]');
      const metaDark = document.querySelector('meta[name="theme-color"][media*="dark"]');

      if (metaLight) metaLight.setAttribute('content', previousLightRef.current || LIGHT_DEFAULT);
      if (metaDark) metaDark.setAttribute('content', previousDarkRef.current || DARK_DEFAULT);
    };
  }, [isActive]);
}
