import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BunnyTestPage } from './standalone/BunnyTestPage';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BunnyTestPage />
  </StrictMode>,
);
