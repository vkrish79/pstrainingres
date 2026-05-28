import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { BusyOverlayProvider } from './contexts/BusyOverlayContext.jsx';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <BusyOverlayProvider>
          <App />
        </BusyOverlayProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
