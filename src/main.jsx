import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { BusyOverlayProvider } from './contexts/BusyOverlayContext.jsx';
import { AmadeusShareProvider } from './contexts/AmadeusShareContext.jsx';
import IdleSignOut from './components/IdleSignOut.jsx';
import TooltipLayer from './components/TooltipLayer.jsx';
import BrandTryBanner from './components/BrandTryBanner.jsx';
import { loadPublishedPalette } from './lib/branding.js';
import './styles/index.css';
import './styles/shell.css';
import './styles/sessions.css';

// Settings → Branding. index.html already applied the remembered palette;
// this fetches the published one and remembers it for next time. Not awaited:
// the app does not wait on colours.
loadPublishedPalette().catch(() => {});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <BusyOverlayProvider>
          <AmadeusShareProvider>
            <App />
          </AmadeusShareProvider>
          <IdleSignOut />
          <TooltipLayer />
          <BrandTryBanner />
        </BusyOverlayProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
