import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        updateViaCache: 'none'
      });
      
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[App] New service worker installed');
            }
          });
        }
      });
      
      setInterval(() => {
        registration.update().catch(() => {});
      }, 60 * 60 * 1000);
      
    } catch (error) {
      console.error('[App] Service worker registration failed:', error);
    }
  });
}

const removeSplash = () => {
  const splash = document.getElementById('app-splash');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(() => {
      splash.remove();
    }, 500);
  }
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

requestAnimationFrame(() => {
  removeSplash();
});
