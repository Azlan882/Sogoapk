/**
 * Standalone SogoSocial Administrator Setup Script
 * 
 * Sets custom claim `admin: true` on the designated administrator account:
 * azlanmalik774@gmail.com (UID: ACs1GZ1CLeWG8fUoMJD9FWWQcR32)
 * 
 * Run from terminal:
 *   node functions/set_admin_claim.cjs
 * 
 * Or with service account credentials:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json node functions/set_admin_claim.cjs
 * 
 * Or in Google Cloud Shell (zero config needed):
 *   node functions/set_admin_claim.cjs
 */

const admin = require('firebase-admin');

const TARGET_ADMIN_EMAIL = 'azlanmalik774@gmail.com';
const KNOWN_UID = 'ACs1GZ1CLeWG8fUoMJD9FWWQcR32';

async function main() {
  const emailArg = (process.argv[2] || TARGET_ADMIN_EMAIL).toLowerCase().trim();

  if (emailArg !== TARGET_ADMIN_EMAIL) {
    console.error(`[ERROR] Unauthorized email: ${emailArg}. Only ${TARGET_ADMIN_EMAIL} can be granted administrator privileges.`);
    process.exit(1);
  }

  console.log('[SOGOSOCIAL ADMIN SETUP] Initializing Firebase Admin SDK...');

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
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(TARGET_ADMIN_EMAIL);
    console.log(`[SOGOSOCIAL ADMIN SETUP] User found: UID = ${userRecord.uid}, Name = ${userRecord.displayName || 'N/A'}`);
  } catch (lookupErr) {
    console.warn(`[NOTE] getUserByEmail note: ${lookupErr.message}. Attempting direct lookup with known UID ${KNOWN_UID}...`);
    try {
      userRecord = await auth.getUser(KNOWN_UID);
      console.log(`[SOGOSOCIAL ADMIN SETUP] User found via UID: ${userRecord.uid}`);
    } catch (uidErr) {
      console.error(`[ERROR] Could not find user:`, uidErr.message);
      process.exit(1);
    }
  }

  try {
    console.log(`[SOGOSOCIAL ADMIN SETUP] Assigning custom claim { admin: true } to UID ${userRecord.uid}...`);
    await auth.setCustomUserClaims(userRecord.uid, { admin: true });

    // Verify claim immediately
    const verifyUser = await auth.getUser(userRecord.uid);
    console.log(`[SOGOSOCIAL ADMIN SETUP] Verified custom claims:`, verifyUser.customClaims);

    // Record in audit log
    try {
      await db.collection('adminAuditLogs').add({
        adminUid: userRecord.uid,
        adminEmail: TARGET_ADMIN_EMAIL,
        action: 'ASSIGN_ADMIN_CLAIM_CLI',
        targetType: 'user',
        targetId: userRecord.uid,
        reason: 'Administrator initial claim assignment',
        timestamp: new Date().toISOString(),
      });
      console.log('[SOGOSOCIAL ADMIN SETUP] Recorded in adminAuditLogs.');
    } catch (dbErr) {
      console.warn('[NOTE] Firestore audit log write skipped (needs firestore write permissions):', dbErr.message);
    }

    console.log('\n======================================================');
    console.log(' SUCCESS: Custom claim { admin: true } assigned!');
    console.log(` Administrator: ${TARGET_ADMIN_EMAIL} (UID: ${userRecord.uid})`);
    console.log(' In the SogoSocial app, click "Force Refresh Token & Check Claim"');
    console.log(' or reload the page to access the Admin Control Panel.');
    console.log('======================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('[ERROR] Failed to set admin claim:', err.message);
    console.error('\nPlease verify that credentials with the "Firebase Authentication Admin" role are provided.');
    process.exit(1);
  }
}

main();
