import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { initializeFirestore, getFirestore, setLogLevel, type Firestore } from 'firebase/firestore';
import { getFunctions, type Functions } from 'firebase/functions';
import { perf } from '../utils/perfLogger';

perf.milestone('App start');

// Production Firebase Web configuration for project sogo-e5ea9
export const firebaseConfig = {
  apiKey: (
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_API_KEY) ||
    (typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_API_KEY || process.env?.FIREBASE_API_KEY : '') ||
    'AIzaSyA7XXZaXGrs6g4La5lkd3Vil8AJSUXTlek'
  ).trim(),
  authDomain: (
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN) ||
    (typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_AUTH_DOMAIN || process.env?.FIREBASE_AUTH_DOMAIN : '') ||
    'sogo-e5ea9.firebaseapp.com'
  ).trim(),
  projectId: (
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID) ||
    (typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_PROJECT_ID || process.env?.FIREBASE_PROJECT_ID : '') ||
    'sogo-e5ea9'
  ).trim(),
  storageBucket: (
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_STORAGE_BUCKET) ||
    (typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_STORAGE_BUCKET || process.env?.FIREBASE_STORAGE_BUCKET : '') ||
    'sogo-e5ea9.firebasestorage.app'
  ).trim(),
  messagingSenderId: (
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_MESSAGING_SENDER_ID) ||
    (typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env?.FIREBASE_MESSAGING_SENDER_ID : '') ||
    '1035132864845'
  ).trim(),
  appId: (
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_APP_ID) ||
    (typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_APP_ID || process.env?.FIREBASE_APP_ID : '') ||
    '1:1035132864845:web:6508bc026762f4887f8f04'
  ).trim(),
  measurementId: (
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_MEASUREMENT_ID) ||
    (typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_MEASUREMENT_ID || process.env?.FIREBASE_MEASUREMENT_ID : '') ||
    'G-7FCKN828JC'
  ).trim(),
};

export const isFirebaseConfigured = true;

// OAuth 2.0 Web Client ID for Google Sign-In (Firebase & Credential Manager)
export const GOOGLE_WEB_CLIENT_ID = (
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GOOGLE_WEB_CLIENT_ID) ||
  '1035132864845-ulhcdqfeknujp5mc1naj6vhrujqc828t.apps.googleusercontent.com'
).trim();

const app: FirebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];
const auth: Auth = getAuth(app);

// Suppress transient WebChannel transport probe errors during auto-detect long-polling negotiation
try {
  setLogLevel('silent');
} catch {}

// Use initializeFirestore with auto-detect long polling and disabled fetch streams.
// In modern Firebase (v10+ / v12+), this ensures reliable WebChannel connectivity
// across sandboxed iframes, proxies, and varying network conditions.
let db: Firestore;
try {
  db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    ...({ useFetchStreams: false } as any),
  });
} catch {
  db = getFirestore(app);
}

let functions: Functions;
try {
  functions = getFunctions(app);
} catch {
  functions = {} as Functions;
}

perf.milestone('Firebase initialized');

export { app, auth, db, functions };
