import { App as CapApp } from '@capacitor/app';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';

export type BackInterceptor = () => boolean;

// LIFO list of active back button interceptors (e.g. modals, drawers, sub-tabs)
const interceptors: BackInterceptor[] = [];

/**
 * Register a priority back button interceptor (e.g. for closing modals, drawers, or sub-tabs).
 * Interceptors are evaluated in LIFO order (the most recently registered interceptor is checked first).
 * If the interceptor returns true, it handled the back action and navigation stops.
 */
export function registerBackInterceptor(interceptor: BackInterceptor): () => void {
  interceptors.push(interceptor);
  return () => {
    const idx = interceptors.lastIndexOf(interceptor);
    if (idx !== -1) {
      interceptors.splice(idx, 1);
    }
  };
}

/**
 * Executes the highest priority registered interceptor.
 * Returns true if an interceptor handled the back event, false otherwise.
 */
export function executeTopInterceptor(): boolean {
  for (let i = interceptors.length - 1; i >= 0; i--) {
    const handler = interceptors[i];
    try {
      if (handler()) {
        return true;
      }
    } catch (err) {
      console.error('Error executing back interceptor:', err);
    }
  }
  return false;
}

let activeListenerHandle: PluginListenerHandle | null = null;
let lastBackTimestamp = 0;

/**
 * Initializes the single global Capacitor Android hardware/system Back button listener.
 * Cleans up any existing listener before registering to ensure exactly one active listener.
 *
 * @param onScreenBack Callback invoked when no interceptor handled the back event.
 *                     Should return true if an in-app screen was navigated back,
 *                     or false if the user is already at the root screen.
 * @returns Cleanup function to remove the listener on unmount.
 */
export function initAppBackButton(onScreenBack: () => boolean): () => void {
  // Always clean up existing handle to avoid duplicate listeners or leaks
  if (activeListenerHandle) {
    activeListenerHandle.remove().catch(() => {});
    activeListenerHandle = null;
  }

  let isCleanedUp = false;

  const setup = async () => {
    try {
      const handle = await CapApp.addListener('backButton', async () => {
        // Debounce rapid hardware back button taps (250ms debounce window)
        const now = Date.now();
        if (now - lastBackTimestamp < 250) {
          return;
        }
        lastBackTimestamp = now;

        // 1. Check if any overlay, modal, or component-specific handler intercepts the back button
        const handledByInterceptor = executeTopInterceptor();
        if (handledByInterceptor) {
          return;
        }

        // 2. Check if in-app screen history can navigate back
        const handledByScreen = onScreenBack();
        if (handledByScreen) {
          return;
        }

        // 3. User is at the root screen with no further in-app navigation history:
        // Gracefully exit or minimize the Android application
        try {
          await CapApp.exitApp();
        } catch (e) {
          console.warn('Could not exit app:', e);
        }
      });

      if (!isCleanedUp) {
        activeListenerHandle = handle;
      } else {
        handle.remove().catch(() => {});
      }
    } catch (e) {
      // In browser development environments where Capacitor native bridge is unavailable, fails gracefully
      console.debug('Capacitor App.addListener(backButton) skipped or unavailable:', e);
    }
  };

  setup();

  return () => {
    isCleanedUp = true;
    if (activeListenerHandle) {
      activeListenerHandle.remove().catch(() => {});
      activeListenerHandle = null;
    }
  };
}
