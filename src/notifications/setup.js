import { Platform } from "react-native";
import Constants from "expo-constants";

// 🚨 CRITICAL: Expo Go te import korlei crash hobe (SDK 53+)
// Tai dynamic require use korchi — shudhu production build e load hobe
let Notifications = null;

export const isExpoGo = Constants.appOwnership === "expo";

export async function setupNotifications() {
  if (isExpoGo) {
    console.log("[StudyFlow] Expo Go detected — notifications disabled (SDK 53+ limitation)");
    return null;
  }

  try {
    // Dynamic import — Expo Go te eita execute hobe na
    Notifications = require("expo-notifications");

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });

    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return null;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("task-reminders", {
        name: "Task Reminders",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    return Notifications;
  } catch (e) {
    console.warn("Notification setup failed:", e.message);
    return null;
  }
}

/**
 * Schedule a task reminder.
 * @param {Object} task - { id, title, due_at }
 * @param {number} pendingCount - remaining open tasks
 */
export async function scheduleTaskReminder(task, pendingCount) {
  if (isExpoGo || !Notifications) return null;

  const dueDate = task.due_at ? new Date(task.due_at) : new Date(Date.now() + 3600_000);
  if (dueDate.getTime() <= Date.now()) return null;

  // Cancel age er notification
  await Notifications.cancelScheduledNotificationAsync(`task-${task.id}`).catch(() => {});

  const body = pendingCount > 1
    ? `⏰ "${task.title}" due in 15 min. You still have ${pendingCount} tasks pending!`
    : `⏰ "${task.title}" is due in 15 min. Let's go!`;

  return Notifications.scheduleNotificationAsync({
    identifier: `task-${task.id}`,
    content: {
      title: "StudyFlow Reminder 📚",
      body,
      sound: true,
      data: { taskId: task.id },
    },
    trigger: new Date(dueDate.getTime() - 15 * 60 * 1000), // 15 min age
  });
}

/**
 * Daily end-of-day nudge — "tomar kaj baki ase"
 */
export async function scheduleDailyTaskCheck() {
  if (isExpoGo || !Notifications) return null;

  await Notifications.cancelScheduledNotificationAsync("daily-check").catch(() => {});

  return Notifications.scheduleNotificationAsync({
    identifier: "daily-check",
    content: {
      title: "StudyFlow",
      body: "Check your tasks — apnar kaj baki thakte pare! 📋",
      sound: true,
    },
    trigger: { hour: 20, minute: 0, repeats: true }, // 8 PM daily
  });
}

export async function cancelTaskReminder(taskId) {
  if (isExpoGo || !Notifications) return;
  await Notifications.cancelScheduledNotificationAsync(`task-${taskId}`).catch(() => {});
}