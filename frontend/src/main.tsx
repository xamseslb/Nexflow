import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './design.css'
import './workspace.css'
import './console.css'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* Online app remains available when installation is unsupported. */ }) })
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
