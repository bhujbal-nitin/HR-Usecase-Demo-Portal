import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles/styles.css';
import './styles/wizard.css';
import './styles/dashboard.css';
import './styles/ae.css';
import './styles/ai_agents.css';
import './styles/sample_files.css';
import './styles/app.css';
import './styles/agent-demo.css';
import './styles/agent-stage.css';

import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
