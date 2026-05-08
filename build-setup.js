const fs = require(‘fs’);

// ── Write src/index.js ──────────────────────────────────────────────────────
fs.writeFileSync(’./src/index.js’, [
‘import React from “react”;’,
‘import ReactDOM from “react-dom/client”;’,
‘import App from “./App”;’,
‘’,
‘const root = ReactDOM.createRoot(document.getElementById(“root”));’,
‘root.render(<React.StrictMode><App /></React.StrictMode>);’,
].join(’\n’), ‘utf8’);
console.log(‘index.js written’);

// ── Write src/firebase.js ───────────────────────────────────────────────────
fs.writeFileSync(’./src/firebase.js’, [
‘import { initializeApp } from “firebase/app”;’,
‘import { getFirestore } from “firebase/firestore”;’,
‘’,
‘const firebaseConfig = {’,
’  apiKey: “REPLACE_WITH_YOUR_API_KEY”,’,
’  authDomain: “REPLACE_WITH_YOUR_AUTH_DOMAIN”,’,
’  projectId: “REPLACE_WITH_YOUR_PROJECT_ID”,’,
’  storageBucket: “REPLACE_WITH_YOUR_STORAGE_BUCKET”,’,
’  messagingSenderId: “REPLACE_WITH_YOUR_SENDER_ID”,’,
’  appId: “REPLACE_WITH_YOUR_APP_ID”’,
‘};’,
‘’,
‘const app = initializeApp(firebaseConfig);’,
‘export const db = getFirestore(app);’,
].join(’\n’), ‘utf8’);
console.log(‘firebase.js written’);

// ── Write src/App.js ────────────────────────────────────────────────────────
const appCode = fs.readFileSync(’./src/App.js.template’, ‘utf8’);
fs.writeFileSync(’./src/App.js’, appCode, ‘utf8’);
console.log(‘App.js written’);
