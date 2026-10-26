# How to get your SogoSocial Android APK file through GitHub

Your SogoSocial project is fully configured with **Capacitor Android** and an automated **GitHub Actions Workflow** (`.github/workflows/build-apk.yml`) to compile and deliver the APK file.

---

### Step 1: Export this Project to GitHub
1. In Google AI Studio, click the **Settings / Export** menu in the top right.
2. Select **Export to GitHub** (or **Download ZIP** and push to a new GitHub repository).
3. If exporting to GitHub, select your account/organization and name the repository (e.g. `sogo-app`).

---

### Step 2: Zero-Config Firebase Client Pre-Configured
Your Firebase Web client configuration for project `sogo-e5ea9` is directly embedded in the build process and source code. No additional repository secret is required to build the APK.
*(Optional)* If you use native Firebase Cloud Messaging push notifications, you can add a repository secret named `GOOGLE_SERVICES_JSON` with your `google-services.json` content.

---

### Step 3: GitHub Automatically Builds the APK
Once pushed or exported to GitHub:
1. Go to your repository page on [GitHub](https://github.com).
2. Click the **"Actions"** tab at the top.
3. You will see the workflow **"Build Android APK"** running automatically.
   *(You can also click on **"Build Android APK"** in the left sidebar and click **"Run workflow"** anytime you want a new build).*

---

### Step 4: Download the APK
1. Click on the completed workflow run (with the green checkmark ✔️).
2. Scroll down to the **"Artifacts"** section at the bottom.
3. Click on **`sogo-android-debug-apk`**.
4. GitHub will download a `.zip` file containing **`app-debug.apk`**.
5. Transfer the APK to your Android device or emulator and install it!

---

### Local Build (Alternative):
If you clone the repository locally on a machine with Android Studio or JDK 17:
```bash
npm install
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```
Your compiled APK will be located at:
`android/app/build/outputs/apk/debug/app-debug.apk`
