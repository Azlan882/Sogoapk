import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '');
  const firebaseApiKey = env.VITE_FIREBASE_API_KEY || env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || 'AIzaSyA7XXZaXGrs6g4La5lkd3Vil8AJSUXTlek';
  const firebaseProjectId = env.VITE_FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'sogo-e5ea9';
  const firebaseAuthDomain = env.VITE_FIREBASE_AUTH_DOMAIN || env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN || 'sogo-e5ea9.firebaseapp.com';
  const firebaseStorageBucket = env.VITE_FIREBASE_STORAGE_BUCKET || env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || 'sogo-e5ea9.firebasestorage.app';
  const firebaseMessagingSenderId = env.VITE_FIREBASE_MESSAGING_SENDER_ID || env.FIREBASE_MESSAGING_SENDER_ID || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID || '1035132864845';
  const firebaseAppId = env.VITE_FIREBASE_APP_ID || env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID || '1:1035132864845:web:6508bc026762f4887f8f04';
  const firebaseMeasurementId = env.VITE_FIREBASE_MEASUREMENT_ID || env.FIREBASE_MEASUREMENT_ID || process.env.VITE_FIREBASE_MEASUREMENT_ID || process.env.FIREBASE_MEASUREMENT_ID || 'G-7FCKN828JC';
  const cloudinaryCloudName = env.VITE_CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME || 'eiwwjhkq';
  const cloudinaryUploadPreset = env.VITE_CLOUDINARY_UPLOAD_PRESET || process.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'sogo_upload';
  const cloudinaryVideoPreset = env.VITE_CLOUDINARY_VIDEO_PRESET || process.env.VITE_CLOUDINARY_VIDEO_PRESET || cloudinaryUploadPreset || 'sogo_upload';
  const publicAppUrl = env.VITE_PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL || 'https://sogo-e5ea9.web.app';

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    envPrefix: ['VITE_', 'FIREBASE_'],
    define: {
      'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify(firebaseApiKey),
      'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify(firebaseAuthDomain),
      'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify(firebaseProjectId),
      'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET': JSON.stringify(firebaseStorageBucket),
      'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(firebaseMessagingSenderId),
      'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify(firebaseAppId),
      'import.meta.env.VITE_FIREBASE_MEASUREMENT_ID': JSON.stringify(firebaseMeasurementId),
      'import.meta.env.VITE_CLOUDINARY_CLOUD_NAME': JSON.stringify(cloudinaryCloudName),
      'import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET': JSON.stringify(cloudinaryUploadPreset),
      'import.meta.env.VITE_CLOUDINARY_VIDEO_PRESET': JSON.stringify(cloudinaryVideoPreset),
      'import.meta.env.VITE_PUBLIC_APP_URL': JSON.stringify(publicAppUrl),
    },


    server: {
      port: 3000,
      host: '0.0.0.0',
      // HMR is disabled in AI Studio via DISABLE_HMR env VAR.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
