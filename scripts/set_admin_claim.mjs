/**
 * Standalone SogoSocial Administrator Setup Script
 * 
 * Sets custom claim `admin: true` on the designated administrator account:
 * azlanmalik774@gmail.com
 * 
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/set_admin_claim.mjs
 *   or
 *   node scripts/set_admin_claim.mjs azlanmalik774@gmail.com
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let admin;
try {
  admin = require('firebase-admin');
} catch {
  try {
    admin = require('../functions/node_modules/firebase-admin');
  } catch (e) {
    console.error('Could not load firebase-admin. Run "npm install --prefix functions" or "npm install firebase-admin".');
    process.exit(1);
  }
}

const TARGET_ADMIN_EMAIL = 'azlanmalik774@gmail.com';

async function main() {
  const emailArg = (process.argv[2] || TARGET_ADMIN_EMAIL).toLowerCase().trim();

  if (emailArg !== TARGET_ADMIN_EMAIL) {
    console.error(`[ERROR] Unauthorized email: ${emailArg}. Only ${TARGET_ADMIN_EMAIL} can be granted administrator privileges.`);
    process.exit(1);
  }

  console.log(`[SOGOSOCIAL ADMIN SETUP] Initializing Firebase Admin SDK...`);

  // Initialize Admin SDK with application default credentials or projectId
  if (!admin.apps.length) {
    try {
      admin.initializeApp({
        projectId: 'sogo-e5ea9',
      });
    } catch (e) {
      console.warn('Initialize warning:', e.message);
    }
  }

  const auth = admin.auth();
  const db = admin.firestore();

  console.log(`[SOGOSOCIAL ADMIN SETUP] Looking up user by email: ${TARGET_ADMIN_EMAIL}...`);
  try {
    const userRecord = await auth.getUserByEmail(TARGET_ADMIN_EMAIL);
    console.log(`[SOGOSOCIAL ADMIN SETUP] User found: UID = ${userRecord.uid}, Name = ${userRecord.displayName || 'N/A'}`);

    console.log(`[SOGOSOCIAL ADMIN SETUP] Assigning custom claim { admin: true }...`);
    await auth.setCustomUserClaims(userRecord.uid, { admin: true });

    // Write audit record
    try {
      await db.collection('adminAuditLogs').add({
        adminUid: userRecord.uid,
        adminEmail: TARGET_ADMIN_EMAIL,
        action: 'ASSIGN_ADMIN_CLAIM_CLI',
        targetType: 'user',
        targetId: userRecord.uid,
        reason: 'One-time CLI administrator setup script execution',
        timestamp: new Date().toISOString(),
      });
      console.log(`[SOGOSOCIAL ADMIN SETUP] Audit log recorded in adminAuditLogs.`);
    } catch (dbErr) {
      console.warn(`[NOTE] Could not write audit log (may need firestore credentials): ${dbErr.message}`);
    }

    console.log(`\n======================================================`);
    console.log(` SUCCESS: Custom claim { admin: true } successfully assigned!`);
    console.log(` Administrator: ${TARGET_ADMIN_EMAIL} (UID: ${userRecord.uid})`);
    console.log(` Next steps: User can sign in or call getIdTokenResult(true) to refresh permissions.`);
    console.log(`======================================================\n`);
    process.exit(0);
  } catch (err) {
    console.error(`[ERROR] Failed to set admin claim:`, err.message);
    console.error(`\nPlease ensure GOOGLE_APPLICATION_CREDENTIALS environment variable points to a valid service account JSON.`);
    process.exit(1);
  }
}

main();
