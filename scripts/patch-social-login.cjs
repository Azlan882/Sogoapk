const fs = require('fs');
const path = require('path');

const EXPECTED_PLUGIN_VERSION = '8.5.7';

const pluginPkgPath = path.resolve(
  __dirname,
  '../node_modules/@capgo/capacitor-social-login/package.json'
);

const targetFile = path.resolve(
  __dirname,
  '../node_modules/@capgo/capacitor-social-login/android/src/main/java/ee/forgr/capacitor/social/login/GoogleProvider.java'
);

if (!fs.existsSync(pluginPkgPath)) {
  console.error(
    `[patch-social-login] ERROR: Plugin package.json not found: ${pluginPkgPath}`
  );
  process.exit(1);
}

let pluginPkg;
try {
  pluginPkg = JSON.parse(fs.readFileSync(pluginPkgPath, 'utf8'));
} catch (err) {
  console.error(
    `[patch-social-login] ERROR: Failed to parse ${pluginPkgPath}: ${err.message}`
  );
  process.exit(1);
}

if (pluginPkg.version !== EXPECTED_PLUGIN_VERSION) {
  console.error(
    `[patch-social-login] ERROR: Expected @capgo/capacitor-social-login version ${EXPECTED_PLUGIN_VERSION}, but found ${pluginPkg.version || 'unknown'}. Refusing to patch.`
  );
  process.exit(1);
}

if (!fs.existsSync(targetFile)) {
  console.error(`[patch-social-login] ERROR: Target file not found: ${targetFile}`);
  process.exit(1);
}

const rawContent = fs.readFileSync(targetFile, 'utf8');
const lineEnding = rawContent.includes('\r\n') ? '\r\n' : '\n';
const content = rawContent.replace(/\r\n/g, '\n');

const patches = [
  {
    name: 'Patch 1 (login-activity-context)',
    unpatched: [
      '        GetCredentialRequest filteredRequest = requestBuilder.build();',
      '',
      '        // Execute credential request',
      '        Executor executor = Executors.newSingleThreadExecutor();',
      '        credentialManager.getCredentialAsync(',
      '            context,',
      '            filteredRequest,',
    ].join('\n'),
    patched: [
      '        GetCredentialRequest filteredRequest = requestBuilder.build();',
      '',
      '        // Execute credential request',
      '        Executor executor = Executors.newSingleThreadExecutor();',
      '        credentialManager.getCredentialAsync(',
      '            activity,',
      '            filteredRequest,',
    ].join('\n'),
  },
  {
    name: 'Patch 2 (auth-only-early-return)',
    unpatched: [
      '                    GoogleIdTokenCredential googleIdTokenCredential = GoogleIdTokenCredential.createFrom(credential.getData());',
      '                    String idToken = googleIdTokenCredential.getIdToken();',
      '',
      '                    ListenableFuture<AuthorizationResult> future = getAuthorizationResult(forceRefreshToken);',
    ].join('\n'),
    patched: [
      '                    GoogleIdTokenCredential googleIdTokenCredential = GoogleIdTokenCredential.createFrom(credential.getData());',
      '                    String idToken = googleIdTokenCredential.getIdToken();',
      '',
      '                    if (this.mode == GoogleProviderLoginType.ONLINE && isAuthenticationOnlyScopes(this.scopes)) {',
      '                        resolveOnlineLogin(call, response, resultObj, user, idToken, null);',
      '                        return;',
      '                    }',
      '',
      '                    ListenableFuture<AuthorizationResult> future = getAuthorizationResult(forceRefreshToken);',
    ].join('\n'),
  },
  {
    name: 'Patch 3 (reauth-diagnostic-rejection)',
    unpatched: [
      '        if (isReauthRetry(call)) {',
      '            logAccountReauthFailedHelp(errorMessage);',
      '            call.reject(',
      '                "Google Sign-In failed: [16] Account reauth failed. The plugin cleared Credential Manager credential-selection state and retried once. " +',
      '                    "If this affects only some users, check OAuth consent screen (External vs Internal, test users in Testing mode), " +',
      '                    "Family Link accounts (ensure filterByAuthorizedAccounts is not set to true), and whether the user disabled Sign in with Google for your app. " +',
      '                    "See Logcat tag GoogleProvider for package, signingSha1, and webClientId."',
      '            );',
      '            return;',
      '        }',
    ].join('\n'),
    patched: [
      '        if (isReauthRetry(call)) {',
      '            logAccountReauthFailedHelp(errorMessage);',
      '            String runtimeSha1 = getSigningCertificateSha1(context);',
      '            String pkgName = context != null ? context.getPackageName() : "unknown";',
      '            String exClass = e != null ? e.getClass().getName() : "unknown";',
      '            String exType = e != null && e.getType() != null ? e.getType() : "unknown";',
      '            String exMsg = e != null && e.getMessage() != null ? e.getMessage() : "null";',
      '            String configuredClientId = this.clientId != null ? this.clientId : "null";',
      '            String androidVer = Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")";',
      '            call.reject(',
      '                "Google Sign-In failed: [16] Account reauth failed. The plugin cleared Credential Manager credential-selection state and retried once. " +',
      '                    "Diag[package=" + pkgName +',
      '                    ", signingSha1=" + (runtimeSha1 != null ? runtimeSha1 : "unknown") +',
      '                    ", clientId=" + configuredClientId +',
      '                    ", exceptionClass=" + exClass +',
      '                    ", exceptionType=" + exType +',
      '                    ", exceptionMessage=" + exMsg +',
      '                    ", android=" + androidVer + "]"',
      '            );',
      '            return;',
      '        }',
    ].join('\n'),
  },
];

function countOccurrences(haystack, needle) {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

let updatedContent = content;
const appliedPatches = [];

for (const patch of patches) {
  const patchedCount = countOccurrences(updatedContent, patch.patched);
  const unpatchedCount = countOccurrences(updatedContent, patch.unpatched);

  if (patchedCount === 1 && unpatchedCount === 0) {
    continue;
  }

  if (patchedCount > 1) {
    console.error(
      `[patch-social-login] ERROR: ${patch.name} already appears ${patchedCount} times in GoogleProvider.java. Refusing to patch.`
    );
    process.exit(1);
  }

  if (patchedCount === 1 && unpatchedCount > 0) {
    console.error(
      `[patch-social-login] ERROR: ${patch.name} has both patched and unpatched patterns present in GoogleProvider.java. Refusing to patch.`
    );
    process.exit(1);
  }

  if (unpatchedCount !== 1) {
    console.error(
      `[patch-social-login] ERROR: ${patch.name} failed verification — expected unpatched pattern exactly once in GoogleProvider.java, but found ${unpatchedCount} occurrence(s). Refusing to patch.`
    );
    process.exit(1);
  }

  updatedContent = updatedContent.replace(patch.unpatched, patch.patched);
  appliedPatches.push(patch.name);
}

for (const patch of patches) {
  const finalPatchedCount = countOccurrences(updatedContent, patch.patched);
  const finalUnpatchedCount = countOccurrences(updatedContent, patch.unpatched);
  if (finalPatchedCount !== 1 || finalUnpatchedCount !== 0) {
    console.error(
      `[patch-social-login] ERROR: Post-patch verification failed for ${patch.name} (patched=${finalPatchedCount}, unpatched=${finalUnpatchedCount}).`
    );
    process.exit(1);
  }
}

if (appliedPatches.length === 0) {
  console.log('[patch-social-login] All 3 patches already present. Nothing to do.');
  process.exit(0);
}

fs.writeFileSync(
  targetFile,
  lineEnding === '\r\n' ? updatedContent.replace(/\n/g, '\r\n') : updatedContent,
  'utf8'
);

console.log(
  `[patch-social-login] Successfully applied ${appliedPatches.length} patch(es): ${appliedPatches.join(', ')}.`
);
