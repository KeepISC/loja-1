import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { isDemo } from './deployment';
import App from './App';
import './index.css';

// Hash routes survive direct links and refresh on static GitHub Pages hosting.
const Router = isDemo ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>,
);
