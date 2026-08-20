import React from 'react';
import ReactDOM from 'react-dom/client';
import { Popup } from './Popup';
import './popup.css';

const container = document.getElementById('root');
if (container) {
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <Popup />
    </React.StrictMode>,
  );
}
