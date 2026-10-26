import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

export const SOGO_STARS_NOTIFICATION_ID = 70701;
export const SOGO_STARS_CHANNEL_ID = 'sogo_stars_daily_channel';
export const SOGO_STARS_NOTIFICATION_TITLE = 'Sogo Stars';
export const SOGO_STARS_NOTIFICATION_BODY = 'Sogo Stars Are Waiting For You';

const SOGO_NOTIF_REQUESTED_KEY_PREFIX = 'sogo_stars_notif_requested_';
const SOGO_LAST_SCHEDULED_USER_KEY = 'sogo_stars_notif_user_';

let isInitialized = false;
let inFlightSync = false;
let pendingOpenStarsOnLaunch = false;

/**
 * Checks if a cold-start notification tap is waiting to navigate to Sogo Stars.
 */
export function shouldOpenStarsOnLaunch(): boolean {
  if (pendingOpenStarsOnLaunch) {
    pendingOpenStarsOnLaunch = false;
    return true;
  }
  return false;
}

/**
 * Ensures the Android notification channel exists with proper importance.
 */
async function ensureNotificationChannel(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await LocalNotifications.createChannel({
      id: SOGO_STARS_CHANNEL_ID,
      name: 'Sogo Stars',
      description: 'Daily reminders for Sogo Stars missions',
      importance: 4, // High importance (heads-up notification tray alert)
      visibility: 1, // Public visibility
      vibration: true,
    });
  } catch (err) {
    console.warn('Could not register Sogo Stars notification channel:', err);
  }
}

/**
 * Initializes listeners for notification tap actions.
 * Works when app is open, in background, or cold-started.
 */
export function initSogoStarsNotificationListeners(): void {
  if (isInitialized) return;
  isInitialized = true;

  try {
    LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      if (
        action.notification.id === SOGO_STARS_NOTIFICATION_ID ||
        action.notification.extra?.route === 'sogo_stars'
      ) {
        pendingOpenStarsOnLaunch = true;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('sogo_open_stars'));
        }
      }
    });
  } catch (err) {
    console.warn('Error attaching localNotificationActionPerformed listener:', err);
  }
}

/**
 * Checks and requests Android 13+ POST_NOTIFICATIONS permission only once per user.
 * If permission is denied, does not repeatedly prompt or create fallbacks.
 */
export async function ensureNotificationPermission(userId: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    return false;
  }

  try {
    const status = await LocalNotifications.checkPermissions();

    if (status.display === 'granted') {
      return true;
    }

    if (status.display === 'denied') {
      return false;
    }

    // Check if we have already prompted the user on this device
    const promptKey = `${SOGO_NOTIF_REQUESTED_KEY_PREFIX}${userId}`;
    const alreadyPrompted = localStorage.getItem(promptKey);
    if (alreadyPrompted) {
      return false; // Do not repeatedly prompt the user
    }

    localStorage.setItem(promptKey, 'true');
    const req = await LocalNotifications.requestPermissions();
    return req.display === 'granted';
  } catch (err) {
    console.warn('Notification permission check error:', err);
    return false;
  }
}

/**
 * Schedules a real Android system notification every 24 hours.
 * Uses stable ID 70701 to guarantee exactly one schedule exists.
 * Does not create duplicate notifications on restarts, re-renders, or screen switches.
 */
export async function syncSogoStarsReminder(userId: string): Promise<boolean> {
  if (!userId || !Capacitor.isNativePlatform()) {
    return false;
  }

  if (inFlightSync) return false;
  inFlightSync = true;

  try {
    initSogoStarsNotificationListeners();
    await ensureNotificationChannel();

    const hasPermission = await ensureNotificationPermission(userId);
    if (!hasPermission) {
      return false;
    }

    // Check if the reminder is already pending with stable ID
    const pending = await LocalNotifications.getPending();
    const existing = pending.notifications.find((n) => n.id === SOGO_STARS_NOTIFICATION_ID);

    const userKey = `${SOGO_LAST_SCHEDULED_USER_KEY}${userId}`;
    const lastScheduledTimestamp = localStorage.getItem(userKey);

    if (existing && lastScheduledTimestamp) {
      // Schedule is already active and healthy for this user
      return true;
    }

    // Cancel any previous reminder for a different user
    if (existing) {
      await LocalNotifications.cancel({
        notifications: [{ id: SOGO_STARS_NOTIFICATION_ID }],
      }).catch(() => {});
    }

    // Determine next schedule time to respect 24-hour cycle
    const now = Date.now();
    const lastTime = Number(lastScheduledTimestamp || 0);
    const elapsed = now - lastTime;
    let scheduleDate: Date;

    if (lastTime > 0 && elapsed < 24 * 60 * 60 * 1000) {
      // Less than 24h since last schedule, schedule for the remaining duration
      scheduleDate = new Date(lastTime + 24 * 60 * 60 * 1000);
    } else {
      // Schedule 24 hours from now
      scheduleDate = new Date(now + 24 * 60 * 60 * 1000);
    }

    await LocalNotifications.schedule({
      notifications: [
        {
          id: SOGO_STARS_NOTIFICATION_ID,
          title: SOGO_STARS_NOTIFICATION_TITLE,
          body: SOGO_STARS_NOTIFICATION_BODY,
          channelId: SOGO_STARS_CHANNEL_ID,
          isExactNotification: false,
          isExactMandatory: false,
          schedule: {
            at: scheduleDate,
            every: 'day',
            allowWhileIdle: false,
          },
          autoCancel: true,
          extra: {
            route: 'sogo_stars',
            userId,
          },
        },
      ],
    });

    localStorage.setItem(userKey, String(now));
    return true;
  } catch (err) {
    console.warn('Could not schedule Sogo Stars local reminder:', err);
    return false;
  } finally {
    inFlightSync = false;
  }
}

/**
 * Cancels the reminder when user logs out so logged-out users do not receive reminders.
 */
export async function cancelSogoStarsReminder(userId?: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await LocalNotifications.cancel({
      notifications: [{ id: SOGO_STARS_NOTIFICATION_ID }],
    });
    if (userId) {
      localStorage.removeItem(`${SOGO_LAST_SCHEDULED_USER_KEY}${userId}`);
    }
  } catch (err) {
    console.warn('Error cancelling Sogo Stars reminder:', err);
  }
}
