import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './render/fonts';
import './render/postLayout';
import './styles/app.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
