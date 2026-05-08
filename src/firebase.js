// src/firebase.js
// ─────────────────────────────────────────────────────────────
// STEP 1: Replace the values below with your Firebase project config.
// Get these from: Firebase Console → Project Settings → Your Apps → SDK setup
// ─────────────────────────────────────────────────────────────
import { initializeApp } from “firebase/app”;
import { getFirestore } from “firebase/firestore”;

const firebaseConfig = {
apiKey: “REPLACE_WITH_YOUR_API_KEY”,
authDomain: “REPLACE_WITH_YOUR_AUTH_DOMAIN”,
projectId: “REPLACE_WITH_YOUR_PROJECT_ID”,
storageBucket: “REPLACE_WITH_YOUR_STORAGE_BUCKET”,
messagingSenderId: “REPLACE_WITH_YOUR_SENDER_ID”,
appId: “REPLACE_WITH_YOUR_APP_ID”
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
