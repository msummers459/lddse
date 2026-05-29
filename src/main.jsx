import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// Polyfill window.storage using localStorage so the app works
// identically when deployed outside the Claude artifact sandbox.
// The API shape matches exactly what the app expects.
window.storage = {
  set: async (key, value) => {
    try {
      localStorage.setItem(key, value);
      return { key, value };
    } catch(e) { return null; }
  },
  get: async (key) => {
    try {
      const value = localStorage.getItem(key);
      if (value === null) throw new Error('not found');
      return { key, value };
    } catch(e) { throw e; }
  },
  delete: async (key) => {
    try {
      localStorage.removeItem(key);
      return { key, deleted: true };
    } catch(e) { return null; }
  },
  list: async (prefix) => {
    try {
      const keys = Object.keys(localStorage)
        .filter(k => prefix ? k.startsWith(prefix) : true);
      return { keys };
    } catch(e) { return { keys: [] }; }
  }
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
