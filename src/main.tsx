import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// A worker from a prior production preview must not serve stale UI in local dev.
async function mountApp() {
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map(registration => registration.unregister()));
  if (navigator.serviceWorker.controller) {
    window.location.reload();
    return;
  }
}
const updateSW = import.meta.env.PROD ? registerSW({
  immediate: true,
  onNeedRefresh() {
    window.dispatchEvent(new CustomEvent('nova-pwa-update', { detail: { updateSW } }));
  },
}) : undefined;

createRoot(document.getElementById('root')!).render(<App />);
}
void mountApp();
