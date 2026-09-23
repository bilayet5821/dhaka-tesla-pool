import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function App() {
  return (
    <main>
      <p className="eyebrow">Dhaka Tesla Pool</p>
      <h1>Share a seat. Split the fare.</h1>
      <p>Project foundation is ready. Passenger and driver flows are planned for later feature branches.</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
