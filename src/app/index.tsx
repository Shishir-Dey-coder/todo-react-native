// StudyFlowScreen.tsx (v4.0 — Production Ready, All Features)
import { Ionicons } from "@expo/vector-icons";
import * as SQLite from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as NavigationBar from "expo-navigation-bar";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

// ==================================================================
//  NOTIFICATION SETUP
// ==================================================================
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function ensureNotificationPermissions(): Promise<boolean> {
  try {
    if (!Device.isDevice) return false;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("reminders", {
        name: "Study Reminders",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#5B4BFF",
      });
      await Notifications.setNotificationChannelAsync("sessions", {
        name: "Study Sessions",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const { status: existing } = await Notifications.getPermissionsAsync();
    let final = existing;
    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      final = status;
    }
    return final === "granted";
  } catch {
    return false;
  }
}

async function scheduleTaskReminder(
  taskId: number,
  title: string,
  dueAt: Date
): Promise<string | null> {
  try {
    const granted = await ensureNotificationPermissions();
    if (!granted) return null;
    if (dueAt.getTime() <= Date.now()) return null;
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "📚 Study Reminder",
        body: title,
        data: { taskId },
        ...(Platform.OS === "android" ? { channelId: "reminders" } : {}),
      },
      trigger:
        Platform.OS === "android"
          ? { type: "date", date: dueAt, channelId: "reminders" }
          : { type: "date", date: dueAt },
    });
    return id;
  } catch (e) {
    console.warn("scheduleTaskReminder failed", e);
    return null;
  }
}

async function cancelNotification(id?: string | null) {
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {}
}

/** Schedule an OS-level notification so it can fire while the app is backgrounded. */
async function scheduleTimerEndNotification(secondsRemaining: number): Promise<string | null> {
  try {
    if (secondsRemaining <= 0) return null;
    const granted = await ensureNotificationPermissions();
    if (!granted) return null;

    return await Notifications.scheduleNotificationAsync({
      content: {
        title: "✅ Session Complete!",
        body: "Your study timer has finished. Great work!",
        ...(Platform.OS === "android" ? { channelId: "sessions" } : {}),
      },
      trigger:
        Platform.OS === "android"
          ? {
              type: "date",
              date: new Date(Date.now() + secondsRemaining * 1000),
              channelId: "sessions",
            }
          : {
              type: "date",
              date: new Date(Date.now() + secondsRemaining * 1000),
            },
    });
  } catch (error) {
    console.warn("Could not schedule timer-end notification:", error);
    return null;
  }
}

// ==================================================================
//  TYPES
// ==================================================================
type Subject = { id: number; name: string; color: string };
type Task = {
  id: number;
  title: string;
  subject_id: number | null;
  subject_name?: string | null;
  completed: number;
  priority: "Low" | "Medium" | "High";
  due_at: string | null;
  notes?: string | null;
  reminder_id?: string | null;
};
type Session = {
  id: number;
  subject_id: number | null;
  subject_name?: string | null;
  duration_seconds: number;
  started_at: string;
  date_key: string;
  note?: string | null;
};
type StickyNote = {
  id: number;
  text: string;
  color: string;
  created_at: string;
};
type Tab = "Home" | "Timer" | "Planner" | "Subjects" | "Stats" | "Settings";
type ModalType =
  | "task"
  | "subject"
  | "editTask"
  | "sessionNote"
  | "editSubject"
  | "fullscreenTimer"
  | "stickyNote"
  | "editSticky"
  | null;
type FilterPriority = "All" | "Low" | "Medium" | "High";
type FilterStatus = "All" | "Active" | "Done";

type ToastKind = "success" | "error" | "info" | "warning";
type Toast = {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  duration?: number;
};

// ==================================================================
//  DESIGN TOKENS
// ==================================================================
const C = {
  background: "#F4F6FB",
  card: "#FFFFFF",
  text: "#131A2E",
  muted: "#8A92A8",
  primary: "#5B4BFF",
  purpleLight: "#EDEBFF",
  green: "#14B87E",
  greenLight: "#E1F8EE",
  orange: "#FF9B3D",
  orangeLight: "#FFF0DE",
  red: "#EF4B4B",
  redLight: "#FDE8E8",
  blue: "#2E96DA",
  blueLight: "#E3F1FB",
  border: "#EAECF4",
};
const SUBJECT_COLORS = [
  "#5B4BFF",
  "#14B87E",
  "#FF9B3D",
  "#E85A98",
  "#2E96DA",
  "#9B6BD9",
  "#EF4B4B",
];
const STICKY_COLORS = ["#FFF4B8", "#FFD6E7", "#D6F0FF", "#D9F7D9", "#EAD9FF"];
const HEATMAP_COLORS = ["#EBEDF0", "#C6E9D8", "#7BCBA4", "#2FA96F", "#0E7A55"];

// ==================================================================
//  UTILITIES
// ==================================================================
const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return h ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatHours(seconds: number) {
  if (seconds < 60) return "0 min";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hours = seconds / 3600;
  return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
}

function calculateStreak(sessions: Session[]) {
  const days = new Set(sessions.map((s) => s.date_key));
  if (days.size === 0) return 0;
  const today = dateKey();
  const yesterday = dateKey(new Date(Date.now() - 86400000));
  const start = days.has(today) ? today : days.has(yesterday) ? yesterday : null;
  if (!start) return 0;
  let streak = 0;
  let cur = new Date(start + "T00:00:00");
  while (days.has(dateKey(cur))) {
    streak++;
    cur = new Date(cur.getTime() - 86400000);
  }
  return streak;
}

type ContributionCell = {
  key: string;
  date: Date;
  seconds: number;
  level: 0 | 1 | 2 | 3 | 4;
};
type ContributionWeek = {
  startDate: Date;
  cells: ContributionCell[];
  monthLabel: string | null;
};

function getContributionGrid(
  sessions: Session[],
  weeks = 18
): { weeks: ContributionWeek[]; maxSeconds: number } {
  const totals = new Map<string, number>();
  for (const s of sessions) {
    totals.set(s.date_key, (totals.get(s.date_key) ?? 0) + s.duration_seconds);
  }
  const maxSeconds = Math.max(3600, ...Array.from(totals.values()));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(today);
  endOfWeek.setDate(endOfWeek.getDate() + (6 - ((endOfWeek.getDay() + 6) % 7)));

  const grid: ContributionWeek[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const weekStart = new Date(endOfWeek);
    weekStart.setDate(weekStart.getDate() - w * 7 - 6);
    weekStart.setHours(0, 0, 0, 0);
    const cells: ContributionCell[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart);
      day.setDate(day.getDate() + d);
      const key = dateKey(day);
      const seconds = totals.get(key) ?? 0;
      const ratio = seconds / maxSeconds;
      const level: 0 | 1 | 2 | 3 | 4 =
        seconds === 0 ? 0 : ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.8 ? 3 : 4;
      cells.push({ key, date: day, seconds, level });
    }
    const firstCell = cells[0];
    const prevWeek = grid[grid.length - 1];
    const monthLabel =
      !prevWeek || prevWeek.startDate.getMonth() !== firstCell.date.getMonth()
        ? firstCell.date.toLocaleDateString("en-US", { month: "short" })
        : null;
    grid.push({ startDate: weekStart, cells, monthLabel });
  }
  return { weeks: grid, maxSeconds };
}

// ==================================================================
//  TOAST SYSTEM
// ==================================================================
type ToastCtx = {
  show: (t: Omit<Toast, "id">) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
};

const ToastContext = React.createContext<ToastCtx | null>(null);
const useToast = () => {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
};

function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (t: Omit<Toast, "id">) => {
      counterRef.current += 1;
      const id = counterRef.current;
      const duration = t.duration ?? (t.kind === "error" ? 4200 : 2600);
      setToasts((prev) => [...prev.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  const ctx = useMemo<ToastCtx>(
    () => ({
      show,
      success: (title, message) => show({ kind: "success", title, message }),
      error: (title, message) => show({ kind: "error", title, message }),
      info: (title, message) => show({ kind: "info", title, message }),
      warning: (title, message) => show({ kind: "warning", title, message }),
    }),
    [show]
  );

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <View
        pointerEvents="box-none"
        style={[styles.toastHost, { top: insets.top + 10 }]}
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const translateY = useRef(new Animated.Value(-80)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.94)).current;
  const progress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 220, mass: 0.9 }),
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 16, stiffness: 220 }),
    ]).start();
    const duration = toast.duration ?? (toast.kind === "error" ? 4200 : 2600);
    Animated.timing(progress, { toValue: 0, duration, easing: Easing.linear, useNativeDriver: false }).start();
  }, [toast, translateY, opacity, scale, progress]);

  const palette = TOAST_PALETTE[toast.kind];
  const icon: React.ComponentProps<typeof Ionicons>["name"] =
    toast.kind === "success" ? "checkmark-circle"
    : toast.kind === "error" ? "alert-circle"
    : toast.kind === "warning" ? "warning"
    : "information-circle";

  return (
    <Animated.View
      style={[styles.toast, {
        backgroundColor: palette.bg,
        borderColor: palette.border,
        opacity,
        transform: [{ translateY }, { scale }],
      }]}
    >
      <Pressable onPress={onDismiss} style={styles.toastInner} android_ripple={{ color: "rgba(0,0,0,0.05)" }}>
        <View style={[styles.toastIconWrap, { backgroundColor: palette.iconBg }]}>
          <Ionicons name={icon} size={16} color={palette.icon} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.toastTitle, { color: palette.title }]}>{toast.title}</Text>
          {toast.message ? (
            <Text style={[styles.toastMessage, { color: palette.message }]} numberOfLines={2}>
              {toast.message}
            </Text>
          ) : null}
        </View>
        <Ionicons name="close" size={15} color={palette.message} />
      </Pressable>
      <Animated.View style={[styles.toastProgress, {
        backgroundColor: palette.icon,
        width: progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
      }]} />
    </Animated.View>
  );
}

const TOAST_PALETTE: Record<ToastKind, {
  bg: string; border: string; icon: string; iconBg: string; title: string; message: string;
}> = {
  success: { bg: "#F0FBF5", border: "#C8F0DE", icon: "#14B87E", iconBg: "#DCF7EB", title: "#0E7A55", message: "#3F8B70" },
  error: { bg: "#FEF2F2", border: "#FBD5D5", icon: "#EF4B4B", iconBg: "#FDE0E0", title: "#B3261E", message: "#9A5454" },
  info: { bg: "#F1F6FF", border: "#D6E4FA", icon: "#2E96DA", iconBg: "#E1EEFB", title: "#1B5C93", message: "#4F6E8C" },
  warning: { bg: "#FFF9EE", border: "#F8E4BF", icon: "#FF9B3D", iconBg: "#FFF0D6", title: "#A75A12", message: "#9A7A50" },
};

// ==================================================================
//  MAIN COMPONENT
// ==================================================================
function StudyFlowInner() {
  const insets = useSafeAreaInsets();
  const dbRef = useRef<SQLite.SQLiteDatabase | null>(null);
  const toast = useToast();

  const timerStartRef = useRef<number | null>(null);
  const baseElapsedRef = useRef(0);
  const timerNotificationRef = useRef<string | null>(null);
  const sessionStartedAtRef = useRef<string | null>(null);
  const savedSessionRef = useRef(false);

  const breakStartRef = useRef<number | null>(null);
  const breakBaseRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("Home");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stickyNotes, setStickyNotes] = useState<StickyNote[]>([]);

  const [selectedSubject, setSelectedSubject] = useState<number | null>(null);

  // Timer duration — hours + minutes separately
  const [durationHours, setDurationHours] = useState("0");
  const [durationMinutesInput, setDurationMinutesInput] = useState("25");
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [timerSubject, setTimerSubject] = useState<number | null>(null);

  // Break duration — hours + minutes separately
  const [breakHours, setBreakHours] = useState("0");
  const [breakMinutesInput, setBreakMinutesInput] = useState("5");
  const [breakSeconds, setBreakSeconds] = useState(0);
  const [breakRunning, setBreakRunning] = useState(false);

  const [modal, setModal] = useState<ModalType>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState<"Low" | "Medium" | "High">("Medium");
  const [taskSubject, setTaskSubject] = useState<number | null>(null);
  const [taskTime, setTaskTime] = useState("");
  const [taskNotes, setTaskNotes] = useState("");
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const [sessionNote, setSessionNote] = useState("");
  const [lastSessionId, setLastSessionId] = useState<number | null>(null);

  const [subjectName, setSubjectName] = useState("");
  const [subjectColor, setSubjectColor] = useState(SUBJECT_COLORS[0]);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);

  // Sticky notes
  const [stickyText, setStickyText] = useState("");
  const [stickyColor, setStickyColor] = useState(STICKY_COLORS[0]);
  const [editingSticky, setEditingSticky] = useState<StickyNote | null>(null);

  const [darkMode, setDarkMode] = useState(false);
  const [dailyGoal, setDailyGoal] = useState(120);
  const [weekOffset, setWeekOffset] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterPriority, setFilterPriority] = useState<FilterPriority>("All");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("All");
  const [filterSubject, setFilterSubject] = useState<number | null>(null);

  const [selectedCell, setSelectedCell] = useState<ContributionCell | null>(null);

  const durationTotalSeconds = useMemo(() => {
    const h = Math.max(0, Math.min(23, parseInt(durationHours || "0", 10) || 0));
    const m = Math.max(0, Math.min(59, parseInt(durationMinutesInput || "0", 10) || 0));
    return h * 3600 + m * 60;
  }, [durationHours, durationMinutesInput]);

  const breakTotalSeconds = useMemo(() => {
    const h = Math.max(0, Math.min(23, parseInt(breakHours || "0", 10) || 0));
    const m = Math.max(0, Math.min(59, parseInt(breakMinutesInput || "0", 10) || 0));
    return h * 3600 + m * 60;
  }, [breakHours, breakMinutesInput]);

  const theme = darkMode
    ? {
        ...C,
        background: "#0F1424",
        card: "#1A2032",
        text: "#F2F4FB",
        muted: "#98A0B8",
        border: "#2A3146",
        purpleLight: "#2E2A55",
        greenLight: "#15453A",
        orangeLight: "#4A3418",
        redLight: "#4A2020",
        blueLight: "#183A54",
      }
    : C;
  const bg = theme.background;
  const card = theme.card;
  const text = theme.text;
  const muted = theme.muted;

  // ---- Android nav bar dark mode fix ----
  useEffect(() => {
    if (Platform.OS !== "android") return;
    (async () => {
      try {
        await NavigationBar.setButtonStyleAsync(darkMode ? "light" : "dark");
      } catch {}
    })();
  }, [darkMode]);

  // ============================================================
  //  DATA
  // ============================================================
  const loadData = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;
    const [loadedSubjects, loadedTasks, loadedSessions, loadedNotes] = await Promise.all([
      db.getAllAsync<Subject>("SELECT id, name, color FROM subjects ORDER BY id DESC"),
      db.getAllAsync<Task>(
        `SELECT tasks.*, subjects.name AS subject_name 
         FROM tasks LEFT JOIN subjects ON tasks.subject_id = subjects.id 
         ORDER BY tasks.completed ASC, tasks.id DESC`
      ),
      db.getAllAsync<Session>(
        `SELECT study_sessions.*, subjects.name AS subject_name 
         FROM study_sessions LEFT JOIN subjects ON study_sessions.subject_id = subjects.id 
         ORDER BY study_sessions.id DESC`
      ),
      db.getAllAsync<StickyNote>("SELECT * FROM sticky_notes ORDER BY id DESC"),
    ]);
    setSubjects(loadedSubjects);
    setTasks(loadedTasks);
    setSessions(loadedSessions);
    setStickyNotes(loadedNotes);
    setSelectedSubject((cur) =>
      cur !== null && loadedSubjects.some((s) => s.id === cur) ? cur : loadedSubjects[0]?.id ?? null
    );
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // ---- INIT ----
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const db = await SQLite.openDatabaseAsync("studyflow.db");
        dbRef.current = db;
        await db.execAsync(`
          PRAGMA journal_mode = WAL;
          CREATE TABLE IF NOT EXISTS subjects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            subject_id INTEGER,
            completed INTEGER NOT NULL DEFAULT 0,
            priority TEXT NOT NULL DEFAULT 'Medium',
            reminder_id TEXT,
            due_at TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE IF NOT EXISTS study_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject_id INTEGER,
            duration_seconds INTEGER NOT NULL,
            started_at TEXT NOT NULL,
            date_key TEXT NOT NULL,
            note TEXT
          );
          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
          );
          CREATE TABLE IF NOT EXISTS sticky_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            color TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
        `);
        try { await db.execAsync(`ALTER TABLE tasks ADD COLUMN notes TEXT`); } catch {}
        try { await db.execAsync(`ALTER TABLE tasks ADD COLUMN reminder_id TEXT`); } catch {}
        try { await db.execAsync(`ALTER TABLE study_sessions ADD COLUMN note TEXT`); } catch {}

        const count = await db.getFirstAsync<{ count: number }>(
          "SELECT COUNT(*) AS count FROM subjects"
        );
        if (!count || count.count === 0) {
          for (const [name, color] of [
            ["Physics", "#5B4BFF"],
            ["Chemistry", "#14B87E"],
            ["Higher Math", "#FF9B3D"],
            ["Biology", "#E85A98"],
          ]) {
            await db.runAsync("INSERT OR IGNORE INTO subjects (name, color) VALUES (?, ?)", name, color);
          }
        }
        const dark = await db.getFirstAsync<{ value: string }>(
          "SELECT value FROM settings WHERE key = 'darkMode'"
        );
        if (dark) setDarkMode(dark.value === "1");
        const goal = await db.getFirstAsync<{ value: string }>(
          "SELECT value FROM settings WHERE key = 'dailyGoal'"
        );
        if (goal) setDailyGoal(Number(goal.value) || 120);

        ensureNotificationPermissions().catch(() => {});

        if (mounted) {
          await loadData();
          setReady(true);
        }
      } catch (error) {
        console.error("StudyFlow DB init failed:", error);
        if (mounted) toast.error("Database unavailable", "StudyFlow could not initialize local storage.");
      }
    })();
    return () => { mounted = false; };
  }, [loadData, toast]);

  useEffect(() => {
    const db = dbRef.current;
    if (!db || !ready) return;
    db.runAsync(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('darkMode', ?)",
      darkMode ? "1" : "0"
    ).catch(() => {});
  }, [darkMode, ready]);

  useEffect(() => {
    const db = dbRef.current;
    if (!db || !ready) return;
    db.runAsync(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('dailyGoal', ?)",
      String(dailyGoal)
    ).catch(() => {});
  }, [dailyGoal, ready]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      setTab("Planner");
    });
    return () => sub.remove();
  }, []);

  // ============================================================
  //  SESSION SAVE
  // ============================================================
  const saveSession = useCallback(
    async (seconds: number) => {
      const db = dbRef.current;
      if (!db || seconds < 1) return;
      try {
        const startedAt = sessionStartedAtRef.current ?? new Date().toISOString();
        const startedDate = new Date(startedAt);
        const result = await db.runAsync(
          "INSERT INTO study_sessions (subject_id, duration_seconds, started_at, date_key) VALUES (?, ?, ?, ?)",
          timerSubject, Math.floor(seconds), startedAt, dateKey(startedDate)
        );
        await loadData();
        return result.lastInsertRowId;
      } catch (error) {
        console.error("Could not save study session:", error);
        toast.error("Session not saved", "Your study time could not be stored.");
      }
    },
    [timerSubject, loadData, toast]
  );

  // ============================================================
  //  TIMER TICK
  // ============================================================
  useEffect(() => {
    if (!running || timerStartRef.current === null) return;
    const startedAt = timerStartRef.current;
    const baseElapsed = baseElapsedRef.current;
    const targetSeconds = durationTotalSeconds;

    const updateTimer = () => {
      const total = Math.min(targetSeconds, baseElapsed + Math.floor((Date.now() - startedAt) / 1000));
      setElapsed(total);
      if (total >= targetSeconds) {
        timerStartRef.current = null;
        baseElapsedRef.current = total;
        setRunning(false);
        setPaused(false);
        setModal(null);
        void cancelNotification(timerNotificationRef.current);
        timerNotificationRef.current = null;
        if (!savedSessionRef.current) {
          savedSessionRef.current = true;
          void saveSession(total).then((id) => {
            if (id) {
              setLastSessionId(id);
              setSessionNote("");
              setModal("sessionNote");
              toast.success("Session complete", `${formatHours(total)} of focused study recorded.`);
            }
          });
        }
      }
    };
    updateTimer();
    const i = setInterval(updateTimer, 250);
    return () => clearInterval(i);
  }, [running, durationTotalSeconds, saveSession, toast]);

  // Break tick
  useEffect(() => {
    if (!breakRunning || breakStartRef.current === null) return;
    const startedAt = breakStartRef.current;
    const base = breakBaseRef.current;
    const target = breakTotalSeconds;
    const tick = () => {
      const total = Math.min(target, base + Math.floor((Date.now() - startedAt) / 1000));
      setBreakSeconds(total);
      if (total >= target) {
        breakStartRef.current = null;
        breakBaseRef.current = 0;
        setBreakRunning(false);
        setBreakSeconds(0);
        toast.warning("Break finished", "Ready to resume your next session.");
      }
    };
    tick();
    const i = setInterval(tick, 250);
    return () => clearInterval(i);
  }, [breakRunning, breakTotalSeconds, toast]);

  // Do not auto-pause on background. Elapsed time is derived from Date.now().

  // ============================================================
  //  TIMER CONTROLS
  // ============================================================
  function startTimer() {
    if (subjects.length === 0) {
      Alert.alert("No subjects available", "Add a study subject first.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Add subject",
          onPress: () => {
            setSubjectName("");
            setSubjectColor(SUBJECT_COLORS[0]);
            setEditingSubject(null);
            setModal("subject");
          },
        },
      ]);
      return;
    }
    if (durationTotalSeconds < 60) {
      toast.warning("Duration too short", "Set at least 1 minute.");
      return;
    }
    if (!paused && elapsed === 0) {
      savedSessionRef.current = false;
      baseElapsedRef.current = 0;
      sessionStartedAtRef.current = new Date().toISOString();
      setTimerSubject(selectedSubject);
    } else {
      baseElapsedRef.current = elapsed;
    }
    timerStartRef.current = Date.now();
    setRunning(true);
    setPaused(false);
    setModal("fullscreenTimer");

    void cancelNotification(timerNotificationRef.current);
    timerNotificationRef.current = null;
    const remaining = Math.max(0, durationTotalSeconds - baseElapsedRef.current);
    void scheduleTimerEndNotification(remaining).then((id) => {
      timerNotificationRef.current = id;
    });
  }

  function pauseTimer() {
    if (timerStartRef.current !== null) {
      const total = Math.min(
        durationTotalSeconds,
        baseElapsedRef.current + Math.floor((Date.now() - timerStartRef.current) / 1000)
      );
      baseElapsedRef.current = total;
      setElapsed(total);
    }
    timerStartRef.current = null;
    setRunning(false);
    setPaused(true);
    void cancelNotification(timerNotificationRef.current);
    timerNotificationRef.current = null;
  }

  async function finishTimer() {
    let total = elapsed;
    if (running && timerStartRef.current !== null)
      total = Math.min(
        durationTotalSeconds,
        baseElapsedRef.current + Math.floor((Date.now() - timerStartRef.current) / 1000)
      );
    timerStartRef.current = null;
    baseElapsedRef.current = 0;
    void cancelNotification(timerNotificationRef.current);
    timerNotificationRef.current = null;
    setRunning(false);
    setPaused(false);
    setElapsed(0);
    setModal(null);
    if (total > 0 && !savedSessionRef.current) {
      savedSessionRef.current = true;
      const id = await saveSession(total);
      if (id) {
        setLastSessionId(id);
        setSessionNote("");
        setModal("sessionNote");
        toast.success("Session saved", `${formatHours(total)} added to study history.`);
      }
    }
    sessionStartedAtRef.current = null;
  }

  function resetTimer() {
    timerStartRef.current = null;
    baseElapsedRef.current = 0;
    void cancelNotification(timerNotificationRef.current);
    timerNotificationRef.current = null;
    sessionStartedAtRef.current = null;
    setRunning(false);
    setPaused(false);
    setElapsed(0);
    savedSessionRef.current = false;
  }

  function startBreak() {
    if (breakTotalSeconds < 30) {
      toast.warning("Break too short", "Set at least 30 seconds.");
      return;
    }
    breakBaseRef.current = 0;
    breakStartRef.current = Date.now();
    setBreakRunning(true);
  }
  function pauseBreak() {
    if (breakStartRef.current !== null) {
      breakBaseRef.current = Math.min(
        breakTotalSeconds,
        breakBaseRef.current + Math.floor((Date.now() - breakStartRef.current) / 1000)
      );
      setBreakSeconds(breakBaseRef.current);
    }
    breakStartRef.current = null;
    setBreakRunning(false);
  }
  function stopBreak() {
    breakStartRef.current = null;
    breakBaseRef.current = 0;
    setBreakRunning(false);
    setBreakSeconds(0);
  }

  // ============================================================
  //  TASK CRUD
  // ============================================================
  function openTaskModal() {
    setEditingTask(null);
    setTaskTitle("");
    setTaskSubject(selectedSubject);
    setTaskTime("");
    setTaskPriority("Medium");
    setTaskNotes("");
    setModal("task");
  }

  function openEditTask(task: Task) {
    setEditingTask(task);
    setTaskTitle(task.title);
    setTaskSubject(task.subject_id);
    setTaskPriority(task.priority);
    setTaskNotes(task.notes ?? "");
    if (task.due_at) {
      const d = new Date(task.due_at);
      setTaskTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    } else setTaskTime("");
    setModal("editTask");
  }

  async function addTask() {
    const title = taskTitle.trim();
    const db = dbRef.current;
    if (!title || !db) {
      toast.warning("Title required", "Provide a short task name.");
      return;
    }
    let dueAt: Date | null = null;
    if (taskTime.trim()) {
      const match = taskTime.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
      if (!match) {
        toast.error("Invalid time format", "Use 24-hour HH:MM (e.g. 18:30).");
        return;
      }
      dueAt = new Date();
      dueAt.setHours(Number(match[1]), Number(match[2]), 0, 0);
      if (dueAt.getTime() <= Date.now()) dueAt.setDate(dueAt.getDate() + 1);
    }
    try {
      const result = await db.runAsync(
        "INSERT INTO tasks (title, subject_id, completed, priority, reminder_id, due_at, notes) VALUES (?, ?, 0, ?, NULL, ?, ?)",
        title, taskSubject, taskPriority, dueAt?.toISOString() ?? null, taskNotes.trim() || null
      );
      let reminderId: string | null = null;
      if (dueAt) {
        reminderId = await scheduleTaskReminder(result.lastInsertRowId!, title, dueAt);
        if (reminderId) {
          await db.runAsync("UPDATE tasks SET reminder_id = ? WHERE id = ?", reminderId, result.lastInsertRowId!);
        }
      }
      setTaskTitle("");
      setTaskTime("");
      setTaskNotes("");
      setTaskPriority("Medium");
      setModal(null);
      await loadData();
      toast.success(
        "Task created",
        dueAt
          ? `Reminder set for ${pad(dueAt.getHours())}:${pad(dueAt.getMinutes())}.`
          : `"${title}" added to planner.`
      );
    } catch (error) {
      console.error("Could not create task:", error);
      toast.error("Task not created", "Please try again.");
    }
  }

  async function updateTask() {
    if (!editingTask) return;
    const title = taskTitle.trim();
    const db = dbRef.current;
    if (!title || !db) {
      toast.warning("Title required", "Provide a short task name.");
      return;
    }
    let dueAt: Date | null = null;
    if (taskTime.trim()) {
      const match = taskTime.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
      if (!match) {
        toast.error("Invalid time format", "Use 24-hour HH:MM.");
        return;
      }
      dueAt = new Date();
      dueAt.setHours(Number(match[1]), Number(match[2]), 0, 0);
      if (dueAt.getTime() <= Date.now()) dueAt.setDate(dueAt.getDate() + 1);
    }
    try {
      await cancelNotification(editingTask.reminder_id);
      await db.runAsync(
        "UPDATE tasks SET title = ?, subject_id = ?, priority = ?, due_at = ?, notes = ?, reminder_id = NULL WHERE id = ?",
        title, taskSubject, taskPriority, dueAt?.toISOString() ?? null, taskNotes.trim() || null, editingTask.id
      );
      let reminderId: string | null = null;
      if (dueAt) {
        reminderId = await scheduleTaskReminder(editingTask.id, title, dueAt);
        if (reminderId) await db.runAsync("UPDATE tasks SET reminder_id = ? WHERE id = ?", reminderId, editingTask.id);
      }
      setModal(null);
      setEditingTask(null);
      await loadData();
      toast.success("Task updated", dueAt ? "Reminder rescheduled." : "Changes saved.");
    } catch {
      toast.error("Update failed", "The task could not be updated.");
    }
  }

  async function toggleTask(task: Task) {
    const next = task.completed ? 0 : 1;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: next } : t)));
    const db = dbRef.current;
    if (!db) return;
    try {
      await db.runAsync("UPDATE tasks SET completed = ? WHERE id = ?", next, task.id);
      if (next && task.reminder_id) {
        await cancelNotification(task.reminder_id);
        await db.runAsync("UPDATE tasks SET reminder_id = NULL WHERE id = ?", task.id);
      }
      await loadData();
      if (next) toast.success("Task complete", `"${task.title}" checked off.`);
    } catch {
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, completed: task.completed } : t))
      );
      toast.error("Update failed", "The task could not be updated.");
    }
  }

  async function deleteTask(task: Task) {
    const db = dbRef.current;
    if (!db) return;
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    try {
      await cancelNotification(task.reminder_id);
      await db.runAsync("DELETE FROM tasks WHERE id = ?", task.id);
      await loadData();
      toast.info("Task deleted", `"${task.title}" removed.`);
    } catch {
      toast.error("Delete failed", "The task could not be deleted.");
      await loadData();
    }
  }

  // ============================================================
  //  SUBJECT CRUD
  // ============================================================
  function openAddSubject() {
    setEditingSubject(null);
    setSubjectName("");
    setSubjectColor(SUBJECT_COLORS[0]);
    setModal("subject");
  }

  function openEditSubject(subject: Subject) {
    setEditingSubject(subject);
    setSubjectName(subject.name);
    setSubjectColor(subject.color);
    setModal("editSubject");
  }

  async function saveSubject() {
    const name = subjectName.trim();
    const db = dbRef.current;
    if (!name || !db) {
      toast.warning("Subject name required", "Enter a name to continue.");
      return;
    }
    try {
      if (editingSubject) {
        await db.runAsync("UPDATE subjects SET name = ?, color = ? WHERE id = ?", name, subjectColor, editingSubject.id);
        toast.success("Subject updated", `"${name}" has been saved.`);
      } else {
        await db.runAsync("INSERT INTO subjects (name, color) VALUES (?, ?)", name, subjectColor);
        toast.success("Subject added", `"${name}" is ready for study.`);
      }
      setSubjectName("");
      setEditingSubject(null);
      setModal(null);
      await loadData();
    } catch {
      toast.error("Could not save subject", "A subject with this name may already exist.");
    }
  }

  function deleteSubject(subject: Subject) {
    const db = dbRef.current;
    if (!db) return;
    Alert.alert(
      "Delete subject?",
      `Delete ${subject.name}? Existing tasks and sessions will remain but be unlinked.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            setSubjects((prev) => prev.filter((s) => s.id !== subject.id));
            await db.runAsync("UPDATE tasks SET subject_id = NULL WHERE subject_id = ?", subject.id);
            await db.runAsync("UPDATE study_sessions SET subject_id = NULL WHERE subject_id = ?", subject.id);
            await db.runAsync("DELETE FROM subjects WHERE id = ?", subject.id);
            if (selectedSubject === subject.id) setSelectedSubject(null);
            await loadData();
            toast.info("Subject deleted", `"${subject.name}" was removed.`);
          },
        },
      ]
    );
  }

  async function saveSessionNote() {
    if (!lastSessionId) { setModal(null); return; }
    const db = dbRef.current;
    if (!db) return;
    try {
      await db.runAsync(
        "UPDATE study_sessions SET note = ? WHERE id = ?",
        sessionNote.trim() || null,
        lastSessionId
      );
      await loadData();
      toast.success("Note saved", "Your session note was recorded.");
    } catch {
      toast.error("Note failed", "Your note could not be saved.");
    }
    setModal(null);
    setSessionNote("");
    setLastSessionId(null);
  }

  // ============================================================
  //  STICKY NOTES CRUD
  // ============================================================
  function openAddSticky() {
    setEditingSticky(null);
    setStickyText("");
    setStickyColor(STICKY_COLORS[0]);
    setModal("stickyNote");
  }

  function openEditSticky(note: StickyNote) {
    setEditingSticky(note);
    setStickyText(note.text);
    setStickyColor(note.color);
    setModal("editSticky");
  }

  async function saveSticky() {
    const t = stickyText.trim();
    const db = dbRef.current;
    if (!t || !db) {
      toast.warning("Note is empty", "Write something first.");
      return;
    }
    try {
      if (editingSticky) {
        await db.runAsync(
          "UPDATE sticky_notes SET text = ?, color = ? WHERE id = ?",
          t, stickyColor, editingSticky.id
        );
        toast.success("Note updated", "Your sticky note was saved.");
      } else {
        await db.runAsync(
          "INSERT INTO sticky_notes (text, color) VALUES (?, ?)",
          t, stickyColor
        );
        toast.success("Note added", "Sticky note pinned to home.");
      }
      setModal(null);
      setEditingSticky(null);
      setStickyText("");
      await loadData();
    } catch {
      toast.error("Save failed", "Could not save sticky note.");
    }
  }

  async function deleteSticky(note: StickyNote) {
    const db = dbRef.current;
    if (!db) return;
    Alert.alert("Delete note?", "This sticky note will be removed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          await db.runAsync("DELETE FROM sticky_notes WHERE id = ?", note.id);
          await loadData();
          toast.info("Note deleted", "Sticky note removed.");
        },
      },
    ]);
  }

  function exportStats() {
    const total = sessions.reduce((s, x) => s + x.duration_seconds, 0);
    const lines = [
      "StudyFlow Report",
      "──────────────────",
      `Total study time: ${formatHours(total)}`,
      `Total sessions: ${sessions.length}`,
      `Active tasks: ${openTasks.length}`,
      `Completed tasks: ${completedTasks}`,
      `Current streak: ${streak} days`,
      "",
      "Top subjects:",
      ...subjectStats
        .filter((s) => s.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 5)
        .map((s, i) => `${i + 1}. ${s.name} — ${formatHours(s.seconds)}`),
    ];
    Share.share({ message: lines.join("\n") })
      .then(() => toast.success("Report shared", "Your study stats were shared."))
      .catch(() => {});
  }

  // ============================================================
  //  DERIVED
  // ============================================================
  const todaySessions = useMemo(
    () => sessions.filter((s) => s.date_key === dateKey()),
    [sessions]
  );
  const todaySeconds = useMemo(
    () => todaySessions.reduce((sum, s) => sum + s.duration_seconds, 0),
    [todaySessions]
  );
  const openTasks = useMemo(() => tasks.filter((t) => !t.completed), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((t) => t.completed).length, [tasks]);
  const streak = useMemo(() => calculateStreak(sessions), [sessions]);
  const dailyGoalSeconds = dailyGoal * 60;
  const goalProgress = Math.min(1, todaySeconds / Math.max(1, dailyGoalSeconds));

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (filterPriority !== "All" && t.priority !== filterPriority) return false;
      if (filterStatus === "Active" && t.completed) return false;
      if (filterStatus === "Done" && !t.completed) return false;
      if (filterSubject !== null && t.subject_id !== filterSubject) return false;
      return true;
    });
  }, [tasks, searchQuery, filterPriority, filterStatus, filterSubject]);

  const weeklyData = useMemo(() => {
    const ws = new Date();
    ws.setDate(ws.getDate() - ((ws.getDay() + 6) % 7));
    ws.setHours(0, 0, 0, 0);
    ws.setDate(ws.getDate() + weekOffset * 7);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(ws);
      day.setDate(day.getDate() + index);
      const key = dateKey(day);
      return {
        key,
        label: day.toLocaleDateString("en-US", { weekday: "short" }),
        seconds: sessions.filter((s) => s.date_key === key).reduce((sum, s) => sum + s.duration_seconds, 0),
        isToday: key === dateKey(),
      };
    });
  }, [sessions, weekOffset]);

  const weeklyTotal = useMemo(() => weeklyData.reduce((sum, d) => sum + d.seconds, 0), [weeklyData]);
  const maxBar = Math.max(...weeklyData.map((d) => d.seconds), 3600);
  const bestDay = useMemo(() => weeklyData.reduce((a, b) => (b.seconds > a.seconds ? b : a), weeklyData[0]), [weeklyData]);
  const activeDays = weeklyData.filter((d) => d.seconds > 0).length;

  const subjectStats = useMemo(
    () =>
      subjects.map((subject) => ({
        ...subject,
        seconds: sessions.filter((s) => s.subject_id === subject.id).reduce((sum, s) => sum + s.duration_seconds, 0),
      })),
    [subjects, sessions]
  );

  const timerProgress = Math.min(1, elapsed / Math.max(1, durationTotalSeconds));
  const remainingTime = Math.max(0, durationTotalSeconds - elapsed);

  const contributionGrid = useMemo(() => getContributionGrid(sessions, 18), [sessions]);

  // ============================================================
  //  SMALL UI COMPONENTS
  // ============================================================
  function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
    return (
      <View style={styles.sectionTitle}>
        <Text style={[styles.sectionHeading, { color: text }]}>{title}</Text>
        {action ? (
          <Pressable onPress={onAction}>
            <Text style={styles.actionText}>{action}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  function Card({ children, style }: { children: React.ReactNode; style?: object }) {
    return (
      <View style={[styles.card, { backgroundColor: card, borderColor: theme.border }, style]}>
        {children}
      </View>
    );
  }
  function EmptyState({ title, subtitle, icon, actionLabel, onAction }: {
    title: string; subtitle: string; icon: React.ComponentProps<typeof Ionicons>["name"];
    actionLabel?: string; onAction?: () => void;
  }) {
    return (
      <View style={styles.emptyState}>
        <View style={styles.emptyIcon}>
          <Ionicons name={icon} size={25} color={C.primary} />
        </View>
        <Text style={[styles.emptyTitle, { color: text }]}>{title}</Text>
        <Text style={[styles.emptySubtitle, { color: muted }]}>{subtitle}</Text>
        {actionLabel && onAction ? (
          <Pressable style={styles.emptyAction} onPress={onAction}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.emptyActionText}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  function ProgressRing({ progress, size = 66, stroke = 7, color = C.primary, bgColor = "#E6E6F5", children }: {
    progress: number; size?: number; stroke?: number; color?: string; bgColor?: string;
    children?: React.ReactNode;
  }) {
    const inner = size - stroke * 2;
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <View style={{
          position: "absolute", width: size, height: size, borderRadius: size / 2,
          borderWidth: stroke, borderColor: bgColor,
        }} />
        <View style={{
          position: "absolute", width: size, height: size, borderRadius: size / 2,
          borderWidth: stroke, borderColor: "transparent",
          borderTopColor: progress > 0.02 ? color : "transparent",
          borderRightColor: progress > 0.27 ? color : "transparent",
          borderBottomColor: progress > 0.52 ? color : "transparent",
          borderLeftColor: progress > 0.77 ? color : "transparent",
          transform: [{ rotate: "-45deg" }],
        }} />
        <View style={{
          width: inner, height: inner, borderRadius: inner / 2,
          alignItems: "center", justifyContent: "center",
        }}>
          {children}
        </View>
      </View>
    );
  }

  function renderTask(task: Task) {
    const subject = subjects.find((s) => s.id === task.subject_id);
    const overdue =
      task.due_at && !task.completed && new Date(task.due_at).getTime() < Date.now();
    return (
      <View key={task.id} style={[styles.taskRow, { borderBottomColor: theme.border }]}>
        <Pressable
          onPress={() => toggleTask(task)}
          style={[styles.checkCircle, !!task.completed && styles.checkedCircle]}
        >
          {task.completed ? <Ionicons name="checkmark" size={15} color="#fff" /> : null}
        </Pressable>
        <Pressable style={styles.taskTextWrap} onPress={() => openEditTask(task)}>
          <Text style={[styles.taskTitle, { color: text }, !!task.completed && styles.completedText]}>
            {task.title}
          </Text>
          <View style={styles.taskMeta}>
            <View style={[styles.miniDot, { backgroundColor: subject?.color ?? muted }]} />
            <Text style={[styles.smallText, { color: muted }]}>{subject?.name ?? "General"}</Text>
            {task.due_at ? (
              <Text style={[styles.smallText, { color: overdue ? C.red : muted }]}>
                {" "}· {new Date(task.due_at).toLocaleTimeString([], {
                  hour: "2-digit", minute: "2-digit",
                })}{overdue ? " (overdue)" : ""}
              </Text>
            ) : null}
            {task.reminder_id ? <Ionicons name="notifications" size={11} color={C.primary} /> : null}
            {task.notes ? <Ionicons name="document-text-outline" size={11} color={muted} /> : null}
          </View>
        </Pressable>
        <View style={[styles.priorityBadge, {
          backgroundColor:
            task.priority === "High" ? theme.redLight
            : task.priority === "Low" ? theme.greenLight
            : theme.orangeLight,
        }]}>
          <Text style={{
            color: task.priority === "High" ? C.red : task.priority === "Low" ? C.green : C.orange,
            fontSize: 10, fontWeight: "700",
          }}>{task.priority}</Text>
        </View>
        <Pressable
          onPress={() => Alert.alert("Delete task?", task.title, [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => deleteTask(task) },
          ])}
          style={styles.deleteButton}
        >
          <Ionicons name="trash-outline" size={17} color={muted} />
        </Pressable>
      </View>
    );
  }

  // ============================================================
  //  SCREENS
  // ============================================================
  function renderHome() {
    const progressPct = Math.round(goalProgress * 100);
    return (
      <>
        <View style={styles.greetingRow}>
          <View>
            <Text style={[styles.eyebrow, { color: muted }]}>YOUR STUDY SPACE</Text>
            <Text style={[styles.pageTitle, { color: text }]}>Dashboard</Text>
            <Text style={[styles.subtitle, { color: muted }]}>
              Track your daily progress and focus.
            </Text>
          </View>
          <Pressable style={styles.avatar} onPress={openAddSubject}>
            <Ionicons name="add" size={26} color={C.primary} />
          </Pressable>
        </View>

        <Card style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroEyebrow}>TODAY'S STUDY TIME</Text>
              <Text style={styles.heroNumber}>{formatHours(todaySeconds)}</Text>
              <Text style={styles.heroSub}>
                {streak > 0 ? `Current streak: ${streak} days` : "No active streak"}
              </Text>
            </View>
            <View style={styles.heroRingWrap}>
              <ProgressRing progress={goalProgress} size={72} stroke={6} color="#FFFFFF" bgColor="rgba(255,255,255,0.22)">
                <Text style={styles.heroRingText}>{progressPct}%</Text>
              </ProgressRing>
            </View>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroBottom}>
            <View>
              <Text style={styles.heroStatLabel}>Daily goal</Text>
              <Text style={styles.heroStatValue}>{dailyGoal} min</Text>
            </View>
            <View>
              <Text style={styles.heroStatLabel}>Tasks left</Text>
              <Text style={styles.heroStatValue}>{openTasks.length}</Text>
            </View>
            <Pressable style={styles.heroButton} onPress={() => setTab("Timer")}>
              <Ionicons name="play" size={15} color={C.primary} />
              <Text style={styles.heroButtonText}>Study now</Text>
            </Pressable>
          </View>
        </Card>

        {/* STICKY NOTES */}
        <SectionTitle title="Sticky notes" action="+ New note" onAction={openAddSticky} />
        {stickyNotes.length === 0 ? (
          <Card>
            <EmptyState
              title="No sticky notes"
              subtitle="Pin quick reminders, formulas, or ideas here."
              icon="document-text-outline"
              actionLabel="Add note"
              onAction={openAddSticky}
            />
          </Card>
        ) : (
          <View style={styles.stickyGrid}>
            {stickyNotes.slice(0, 6).map((note) => (
              <Pressable
                key={note.id}
                onPress={() => openEditSticky(note)}
                onLongPress={() => deleteSticky(note)}
                style={[styles.stickyCard, { backgroundColor: note.color }]}
              >
                <Text style={styles.stickyText} numberOfLines={6}>{note.text}</Text>
                <View style={styles.stickyFooter}>
                  <Text style={styles.stickyDate}>
                    {new Date(note.created_at).toLocaleDateString("en-US", {
                      month: "short", day: "numeric",
                    })}
                  </Text>
                  <Pressable onPress={() => deleteSticky(note)} hitSlop={8}>
                    <Ionicons name="close-circle" size={16} color="rgba(0,0,0,0.35)" />
                  </Pressable>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <SectionTitle title="Quick overview" action="View planner" onAction={() => setTab("Planner")} />
        <View style={styles.statsRow}>
          <Card style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: theme.purpleLight }]}>
              <Ionicons name="timer-outline" size={20} color={C.primary} />
            </View>
            <Text style={[styles.statValue, { color: text }]}>{todaySessions.length}</Text>
            <Text style={[styles.statLabel, { color: muted }]}>Sessions today</Text>
          </Card>
          <Card style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: theme.greenLight }]}>
              <Ionicons name="checkmark-done" size={20} color={C.green} />
            </View>
            <Text style={[styles.statValue, { color: text }]}>{completedTasks}</Text>
            <Text style={[styles.statLabel, { color: muted }]}>Completed tasks</Text>
          </Card>
        </View>

        <SectionTitle title="Study activity" action="See stats" onAction={() => setTab("Stats")} />
        <Card>
          <View style={styles.chartHeader}>
            <View>
              <Text style={[styles.chartTotal, { color: text }]}>{formatHours(weeklyTotal)}</Text>
              <Text style={[styles.smallText, { color: muted }]}>Total this week</Text>
            </View>
            <View style={styles.weekControls}>
              <Pressable onPress={() => setWeekOffset((v) => v - 1)} style={styles.weekArrow}>
                <Ionicons name="chevron-back" size={16} color={text} />
              </Pressable>
              <Pressable
                onPress={() => setWeekOffset((v) => Math.min(0, v + 1))}
                disabled={weekOffset === 0}
                style={[styles.weekArrow, weekOffset === 0 && { opacity: 0.3 }]}
              >
                <Ionicons name="chevron-forward" size={16} color={text} />
              </Pressable>
            </View>
          </View>
          <View style={styles.chart}>
            {weeklyData.map((day) => (
              <View key={day.key} style={styles.chartColumn}>
                <Text style={[styles.chartValue, { color: day.isToday ? C.primary : muted }]}>
                  {day.seconds
                    ? day.seconds >= 3600
                      ? `${(day.seconds / 3600).toFixed(1)}h`
                      : `${Math.round(day.seconds / 60)}m`
                    : "—"}
                </Text>
                <View style={styles.barTrack}>
                  <View style={[styles.chartBar, {
                    height: Math.max(day.seconds > 0 ? 5 : 3, (day.seconds / maxBar) * 112),
                    backgroundColor: day.isToday ? C.primary : "#C7C3FF",
                  }]} />
                </View>
                <Text style={[styles.chartLabel, {
                  color: day.isToday ? C.primary : muted,
                  fontWeight: day.isToday ? "800" : "500",
                }]}>{day.label}</Text>
              </View>
            ))}
          </View>
        </Card>

        <SectionTitle title="Upcoming tasks" action="+ Add task" onAction={openTaskModal} />
        <Card>
          {openTasks.length ? (
            openTasks.slice(0, 4).map(renderTask)
          ) : (
            <EmptyState
              title="No upcoming tasks"
              subtitle="Add a task to plan your next study session."
              icon="checkbox-outline"
              actionLabel="Add task"
              onAction={openTaskModal}
            />
          )}
        </Card>

        <SectionTitle title="Your subjects" action="+ Add subject" onAction={openAddSubject} />
        <View style={styles.subjectGrid}>
          {subjectStats.slice(0, 4).map((s) => (
            <Pressable
              key={s.id}
              onPress={() => { setSelectedSubject(s.id); setTab("Timer"); }}
              onLongPress={() => openEditSubject(s)}
              style={[styles.subjectTile, { backgroundColor: card, borderColor: theme.border }]}
            >
              <View style={[styles.subjectColorBar, { backgroundColor: s.color }]} />
              <Text style={[styles.subjectTileName, { color: text }]}>{s.name}</Text>
              <Text style={[styles.smallText, { color: muted }]}>{formatHours(s.seconds)} studied</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={openAddSubject}
            style={[styles.subjectTile, styles.addSubjectTile, { borderColor: theme.border, backgroundColor: card }]}
          >
            <View style={[styles.addSubjectIcon, { backgroundColor: theme.purpleLight }]}>
              <Ionicons name="add" size={22} color={C.primary} />
            </View>
            <Text style={[styles.subjectTileName, { color: text }]}>Add subject</Text>
            <Text style={[styles.smallText, { color: muted }]}>Create new</Text>
          </Pressable>
        </View>
      </>
    );
  }

  // ---------- TIMER ----------
  function renderTimer() {
    const breakRemaining = Math.max(0, breakTotalSeconds - breakSeconds);
    return (
      <>
        <Text style={[styles.eyebrow, { color: muted }]}>STAY FOCUSED</Text>
        <Text style={[styles.pageTitle, { color: text }]}>Study timer</Text>
        <Text style={[styles.subtitle, { color: muted }]}>Focus on one thing at a time.</Text>

        <Card style={styles.timerCard}>
          <View style={styles.timerBadge}>
            <Ionicons name="headset-outline" size={16} color={C.primary} />
            <Text style={styles.timerBadgeText}>
              {running || paused ? "SESSION ACTIVE" : "READY TO FOCUS"}
            </Text>
          </View>
          <View style={styles.timerCircleOuter}>
            <View style={[styles.timerProgress, {
              borderColor: C.primary,
              opacity: timerProgress > 0 ? 1 : 0.22,
            }]} />
            <View style={styles.timerCircleInner}>
              <Text style={[styles.timerTime, { color: text }]}>{formatTime(remainingTime)}</Text>
              <Text style={[styles.timerStatus, { color: muted }]}>
                {running ? "In progress" : paused ? "Paused" : "Ready"}
              </Text>
            </View>
          </View>

          <View style={styles.timerLabelRow}>
            <Text style={[styles.timerLabel, { color: muted }]}>STUDY SUBJECT</Text>
            <Pressable onPress={openAddSubject}>
              <Text style={styles.actionText}>+ New</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
            {subjects.length === 0 ? (
              <Pressable onPress={openAddSubject} style={styles.subjectChipEmpty}>
                <Ionicons name="add" size={14} color={C.primary} />
                <Text style={{ color: C.primary, fontSize: 12, fontWeight: "700" }}>
                  Add your first subject
                </Text>
              </Pressable>
            ) : subjects.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => {
                  if (running || elapsed > 0) {
                    toast.warning("Timer active", "Finish or reset the session before changing subjects.");
                    return;
                  }
                  setSelectedSubject(s.id);
                }}
                onLongPress={() => openEditSubject(s)}
                style={[styles.subjectChip, {
                  backgroundColor: selectedSubject === s.id ? s.color : theme.background,
                  borderColor: selectedSubject === s.id ? s.color : theme.border,
                }]}
              >
                <Text style={{
                  color: selectedSubject === s.id ? "#fff" : text,
                  fontSize: 12, fontWeight: "700",
                }}>{s.name}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={[styles.timerLabel, { color: muted }]}>SESSION LENGTH</Text>
          <View style={styles.durationRow}>
            {[{ h: 0, m: 15 }, { h: 0, m: 25 }, { h: 0, m: 45 }, { h: 1, m: 0 }].map((d) => {
              const active = durationHours === String(d.h) && durationMinutesInput === String(d.m);
              return (
                <Pressable
                  key={`${d.h}-${d.m}`}
                  disabled={running || elapsed > 0}
                  onPress={() => {
                    setDurationHours(String(d.h));
                    setDurationMinutesInput(String(d.m));
                  }}
                  style={[styles.durationChip, {
                    backgroundColor: active ? C.primary : theme.background,
                    borderColor: active ? C.primary : theme.border,
                    opacity: running || elapsed > 0 ? 0.5 : 1,
                  }]}
                >
                  <Text style={{ color: active ? "#fff" : text, fontWeight: "800", fontSize: 11 }}>
                    {d.h > 0 ? `${d.h}h ${d.m}m` : `${d.m}m`}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Custom hours + minutes */}
          <View style={styles.customDurationRow}>
            <View style={[styles.customDurationInput, {
              backgroundColor: theme.background, borderColor: theme.border,
              flexDirection: "row", alignItems: "center",
            }]}>
              <TextInput
                value={durationHours}
                onChangeText={(v) => setDurationHours(v.replace(/[^0-9]/g, "").slice(0, 2))}
                editable={!running && elapsed === 0}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={muted}
                style={{ flex: 1, color: text, fontSize: 14, fontWeight: "700", textAlign: "center" }}
              />
              <Text style={{ color: muted, fontSize: 12, fontWeight: "700" }}>h</Text>
            </View>
            <View style={[styles.customDurationInput, {
              backgroundColor: theme.background, borderColor: theme.border,
              flexDirection: "row", alignItems: "center",
            }]}>
              <TextInput
                value={durationMinutesInput}
                onChangeText={(v) => setDurationMinutesInput(v.replace(/[^0-9]/g, "").slice(0, 2))}
                editable={!running && elapsed === 0}
                keyboardType="number-pad"
                placeholder="25"
                placeholderTextColor={muted}
                style={{ flex: 1, color: text, fontSize: 14, fontWeight: "700", textAlign: "center" }}
              />
              <Text style={{ color: muted, fontSize: 12, fontWeight: "700" }}>m</Text>
            </View>
            <View style={[styles.applyButton, { backgroundColor: theme.purpleLight, minWidth: 90 }]}>
              <Text style={{ color: C.primary, fontSize: 11, fontWeight: "800" }}>
                {formatTime(durationTotalSeconds)}
              </Text>
            </View>
          </View>

          <View style={styles.timerActions}>
            {!running ? (
              <Pressable onPress={startTimer} style={styles.startButton}>
                <Ionicons name="play" size={20} color="#fff" />
                <Text style={styles.startButtonText}>
                  {paused ? "Resume session" : elapsed > 0 ? "Resume" : "Start studying"}
                </Text>
              </Pressable>
            ) : (
              <Pressable onPress={pauseTimer} style={[styles.startButton, { backgroundColor: C.orange }]}>
                <Ionicons name="pause" size={20} color="#fff" />
                <Text style={styles.startButtonText}>Pause session</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                if (elapsed > 0 || running)
                  Alert.alert("Finish session?", "Save your elapsed study time?", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Save & finish", onPress: () => void finishTimer() },
                  ]);
                else resetTimer();
              }}
              style={[styles.resetButton, { backgroundColor: theme.background }]}
            >
              <Ionicons name="stop" size={19} color={text} />
            </Pressable>
          </View>
          <Text style={[styles.timerNote, { color: muted }]}>
            Your study history is saved locally on this device.
          </Text>
        </Card>

        {/* Break timer */}
        <SectionTitle title="Break timer" />
        <Card>
          <View style={styles.breakRow}>
            <View style={[styles.breakIcon, { backgroundColor: theme.orangeLight }]}>
              <Ionicons name="cafe-outline" size={22} color={C.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.breakTime, { color: text }]}>{formatTime(breakRemaining)}</Text>
              <Text style={[styles.smallText, { color: muted }]}>
                {breakRunning ? "Break in progress" : "Short break between sessions"}
              </Text>
            </View>
            {breakRunning ? (
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Pressable onPress={pauseBreak} style={[styles.breakBtn, { backgroundColor: C.orange }]}>
                  <Ionicons name="pause" size={16} color="#fff" />
                </Pressable>
                <Pressable onPress={stopBreak} style={[styles.breakBtn, { backgroundColor: theme.background }]}>
                  <Ionicons name="close" size={16} color={text} />
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={startBreak} style={[styles.breakBtn, { backgroundColor: C.orange }]}>
                <Ionicons name="play" size={16} color="#fff" />
              </Pressable>
            )}
          </View>
          <View style={styles.breakLengthRow}>
            {[5, 10, 15, 20].map((m) => {
              const active = breakHours === "0" && breakMinutesInput === String(m);
              return (
                <Pressable
                  key={m}
                  onPress={() => {
                    if (breakRunning) return;
                    setBreakHours("0");
                    setBreakMinutesInput(String(m));
                    setBreakSeconds(0);
                  }}
                  style={[styles.breakChip, {
                    backgroundColor: active ? C.orange : theme.background,
                    borderColor: active ? C.orange : theme.border,
                  }]}
                >
                  <Text style={{
                    color: active ? "#fff" : text,
                    fontWeight: "700", fontSize: 11,
                  }}>{m}m</Text>
                </Pressable>
              );
            })}
          </View>
          {/* Custom break hours + minutes */}
          <View style={styles.customDurationRow}>
            <View style={[styles.customDurationInput, {
              backgroundColor: theme.background, borderColor: theme.border,
              flexDirection: "row", alignItems: "center",
            }]}>
              <TextInput
                value={breakHours}
                onChangeText={(v) => setBreakHours(v.replace(/[^0-9]/g, "").slice(0, 2))}
                editable={!breakRunning}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={muted}
                style={{ flex: 1, color: text, fontSize: 14, fontWeight: "700", textAlign: "center" }}
              />
              <Text style={{ color: muted, fontSize: 12, fontWeight: "700" }}>h</Text>
            </View>
            <View style={[styles.customDurationInput, {
              backgroundColor: theme.background, borderColor: theme.border,
              flexDirection: "row", alignItems: "center",
            }]}>
              <TextInput
                value={breakMinutesInput}
                onChangeText={(v) => setBreakMinutesInput(v.replace(/[^0-9]/g, "").slice(0, 2))}
                editable={!breakRunning}
                keyboardType="number-pad"
                placeholder="5"
                placeholderTextColor={muted}
                style={{ flex: 1, color: text, fontSize: 14, fontWeight: "700", textAlign: "center" }}
              />
              <Text style={{ color: muted, fontSize: 12, fontWeight: "700" }}>m</Text>
            </View>
          </View>
        </Card>

        <SectionTitle title="Today's sessions" />
        <Card>
          {todaySessions.length ? todaySessions.map((s) => (
            <View key={s.id} style={[styles.sessionRow, { borderBottomColor: theme.border }]}>
              <View style={[styles.sessionIcon, { backgroundColor: theme.purpleLight }]}>
                <Ionicons name="book-outline" size={19} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.taskTitle, { color: text }]}>{s.subject_name ?? "General study"}</Text>
                <Text style={[styles.smallText, { color: muted }]}>
                  {new Date(s.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {s.note ? ` · ${s.note}` : ""}
                </Text>
              </View>
              <Text style={[styles.sessionDuration, { color: text }]}>{formatTime(s.duration_seconds)}</Text>
            </View>
          )) : (
            <EmptyState
              title="No sessions yet"
              subtitle="Start your first timer to build your study history."
              icon="hourglass-outline"
            />
          )}
        </Card>
      </>
    );
  }

  // ---------- PLANNER ----------
  function renderPlanner() {
    return (
      <>
        <Text style={[styles.eyebrow, { color: muted }]}>GET THINGS DONE</Text>
        <Text style={[styles.pageTitle, { color: text }]}>Planner</Text>
        <Text style={[styles.subtitle, { color: muted }]}>Manage your tasks and track progress.</Text>

        <Card style={styles.plannerSummary}>
          <View style={{ flex: 1 }}>
            <Text style={styles.plannerSummaryTitle}>Task progress</Text>
            <Text style={styles.plannerSummarySubtitle}>
              {completedTasks} completed · {openTasks.length} remaining
            </Text>
          </View>
          <View style={styles.plannerProgressCircle}>
            <Text style={styles.plannerProgressText}>
              {tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0}%
            </Text>
          </View>
        </Card>

        <View style={[styles.searchWrap, { backgroundColor: card, borderColor: theme.border }]}>
          <Ionicons name="search-outline" size={18} color={muted} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search tasks..."
            placeholderTextColor={muted}
            style={[styles.searchInput, { color: text }]}
          />
          {searchQuery ? (
            <Pressable onPress={() => setSearchQuery("")}>
              <Ionicons name="close-circle" size={18} color={muted} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
          {(["All", "Active", "Done"] as FilterStatus[]).map((s) => (
            <Pressable
              key={s}
              onPress={() => setFilterStatus(s)}
              style={[styles.filterChip, {
                backgroundColor: filterStatus === s ? C.primary : card,
                borderColor: filterStatus === s ? C.primary : theme.border,
              }]}
            >
              <Text style={{ color: filterStatus === s ? "#fff" : text, fontSize: 11, fontWeight: "700" }}>{s}</Text>
            </Pressable>
          ))}
          <View style={[styles.filterDivider, { backgroundColor: theme.border }]} />
          {(["All", "Low", "Medium", "High"] as FilterPriority[]).map((p) => (
            <Pressable
              key={p}
              onPress={() => setFilterPriority(p)}
              style={[styles.filterChip, {
                backgroundColor: filterPriority === p ? C.primary : card,
                borderColor: filterPriority === p ? C.primary : theme.border,
              }]}
            >
              <Text style={{ color: filterPriority === p ? "#fff" : text, fontSize: 11, fontWeight: "700" }}>{p}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Subject-wise filter */}
        <View style={{ marginBottom: 12 }}>
          <Text style={[styles.timerLabel, { color: muted, marginBottom: 8 }]}>FILTER BY SUBJECT</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <Pressable
              onPress={() => setFilterSubject(null)}
              style={[styles.filterChip, {
                backgroundColor: filterSubject === null ? C.primary : card,
                borderColor: filterSubject === null ? C.primary : theme.border,
              }]}
            >
              <Text style={{ color: filterSubject === null ? "#fff" : text, fontSize: 11, fontWeight: "700" }}>
                All subjects
              </Text>
            </Pressable>
            {subjects.map((s) => {
              const active = filterSubject === s.id;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setFilterSubject(active ? null : s.id)}
                  style={[styles.filterChip, {
                    backgroundColor: active ? s.color : card,
                    borderColor: active ? s.color : theme.border,
                    flexDirection: "row", alignItems: "center", gap: 6,
                  }]}
                >
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: active ? "#fff" : s.color }} />
                  <Text style={{ color: active ? "#fff" : text, fontSize: 11, fontWeight: "700" }}>{s.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <SectionTitle title={`Tasks (${filteredTasks.length})`} action="+ New task" onAction={openTaskModal} />
        <Card>
          {filteredTasks.length ? filteredTasks.map(renderTask) : (
            <EmptyState
              title="No matching tasks"
              subtitle="Try changing filters or add a new task."
              icon="funnel-outline"
              actionLabel="Add task"
              onAction={openTaskModal}
            />
          )}
        </Card>
      </>
    );
  }

  // ---------- SUBJECTS ----------
  function renderSubjects() {
    return (
      <>
        <Text style={[styles.eyebrow, { color: muted }]}>YOUR LEARNING</Text>
        <Text style={[styles.pageTitle, { color: text }]}>Subjects</Text>
        <Text style={[styles.subtitle, { color: muted }]}>Manage your subjects and track time spent.</Text>

        <Pressable onPress={openAddSubject} style={styles.addSubjectButton}>
          <Ionicons name="add-circle-outline" size={22} color="#fff" />
          <Text style={styles.addSubjectText}>Add a new subject</Text>
        </Pressable>

        {subjectStats.length === 0 ? (
          <Card>
            <EmptyState
              title="No subjects yet"
              subtitle="Add your first subject to start tracking study time."
              icon="library-outline"
              actionLabel="Add subject"
              onAction={openAddSubject}
            />
          </Card>
        ) : subjectStats.map((s) => (
          <Card key={s.id} style={styles.subjectCard}>
            <View style={styles.subjectCardTop}>
              <View style={[styles.subjectLargeIcon, { backgroundColor: `${s.color}20` }]}>
                <Ionicons name="book" size={23} color={s.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.subjectCardName, { color: text }]}>{s.name}</Text>
                <Text style={[styles.smallText, { color: muted }]}>{formatHours(s.seconds)} total study time</Text>
              </View>
              <Pressable onPress={() => openEditSubject(s)} style={styles.deleteButton}>
                <Ionicons name="pencil" size={17} color={C.primary} />
              </Pressable>
              <Pressable onPress={() => deleteSubject(s)} style={styles.deleteButton}>
                <Ionicons name="trash-outline" size={18} color={muted} />
              </Pressable>
            </View>
            <View style={[styles.subjectProgressTrack, { backgroundColor: theme.background }]}>
              <View style={[styles.subjectProgressFill, {
                backgroundColor: s.color,
                width: `${Math.min(100, (s.seconds / 3600) * 100)}%`,
              }]} />
            </View>
            <View style={styles.subjectCardBottom}>
              <Text style={[styles.smallText, { color: muted }]}>
                {s.seconds >= 3600
                  ? `${(s.seconds / 3600).toFixed(1)} hours recorded`
                  : `${Math.round(s.seconds / 60)} minutes recorded`}
              </Text>
              <Pressable onPress={() => {
                setSelectedSubject(s.id);
                resetTimer();
                setTab("Timer");
              }}>
                <Text style={styles.actionText}>Study this →</Text>
              </Pressable>
            </View>
          </Card>
        ))}
      </>
    );
  }

  // ---------- STATS ----------
  function renderStats() {
    const totalSeconds = sessions.reduce((s, x) => s + x.duration_seconds, 0);
    return (
      <>
        <Text style={[styles.eyebrow, { color: muted }]}>INSIGHTS</Text>
        <Text style={[styles.pageTitle, { color: text }]}>Statistics</Text>
        <Text style={[styles.subtitle, { color: muted }]}>Track your progress over time.</Text>

        <View style={styles.statsRow}>
          <Card style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: theme.purpleLight }]}>
              <Ionicons name="time-outline" size={20} color={C.primary} />
            </View>
            <Text style={[styles.statValue, { color: text }]}>{formatHours(totalSeconds)}</Text>
            <Text style={[styles.statLabel, { color: muted }]}>Total study time</Text>
          </Card>
          <Card style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: theme.orangeLight }]}>
              <Ionicons name="flame" size={20} color={C.orange} />
            </View>
            <Text style={[styles.statValue, { color: text }]}>{streak}</Text>
            <Text style={[styles.statLabel, { color: muted }]}>Day streak</Text>
          </Card>
        </View>

        <SectionTitle title="Contribution history" />
        <Card>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ paddingVertical: 4 }}>
              <View style={{ flexDirection: "row", marginBottom: 6 }}>
                <View style={{ width: 20 }} />
                <View style={{ flexDirection: "row", gap: 3 }}>
                  {contributionGrid.weeks.map((w, i) => (
                    <View key={i} style={{ width: 11, alignItems: "center" }}>
                      {w.monthLabel ? (
                        <Text style={{
                          fontSize: 8, color: muted,
                          position: "absolute", top: -2, left: 0, width: 30,
                        }}>{w.monthLabel}</Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              </View>
              <View style={{ flexDirection: "row" }}>
                <View style={{ width: 20, justifyContent: "space-between", paddingVertical: 2 }}>
                  <Text style={{ fontSize: 8, color: muted }}>Mon</Text>
                  <Text style={{ fontSize: 8, color: muted }}>Wed</Text>
                  <Text style={{ fontSize: 8, color: muted }}>Fri</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 3 }}>
                  {contributionGrid.weeks.map((week, wi) => (
                    <View key={wi} style={{ gap: 3 }}>
                      {week.cells.map((cell) => (
                        <Pressable key={cell.key} onPress={() => setSelectedCell(cell)}>
                          <View style={{
                            width: 11, height: 11, borderRadius: 2,
                            backgroundColor: HEATMAP_COLORS[cell.level],
                          }} />
                        </Pressable>
                      ))}
                    </View>
                  ))}
                </View>
              </View>
            </View>
          </ScrollView>
          {selectedCell && (
            <View style={{
              marginTop: 12, padding: 10,
              backgroundColor: theme.background, borderRadius: 8,
            }}>
              <Text style={{ fontSize: 11, color: text, fontWeight: "600" }}>
                {selectedCell.date.toLocaleDateString("en-US", {
                  weekday: "long", month: "short", day: "numeric",
                })}
              </Text>
              <Text style={{ fontSize: 11, color: muted, marginTop: 2 }}>
                {selectedCell.seconds > 0
                  ? `${formatHours(selectedCell.seconds)} of study`
                  : "No study recorded"}
              </Text>
            </View>
          )}
          <View style={{
            flexDirection: "row", alignItems: "center",
            justifyContent: "flex-end", marginTop: 12, gap: 4,
          }}>
            <Text style={{ fontSize: 9, color: muted }}>Less</Text>
            {HEATMAP_COLORS.map((c, i) => (
              <View key={i} style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: c }} />
            ))}
            <Text style={{ fontSize: 9, color: muted }}>More</Text>
          </View>
        </Card>

        <SectionTitle title="Weekly insight" />
        <Card>
          <View style={styles.insightRow}>
            <View style={styles.insightItem}>
              <Text style={[styles.insightLabel, { color: muted }]}>Best day</Text>
              <Text style={[styles.insightValue, { color: text }]}>
                {bestDay?.seconds > 0 ? bestDay.label : "—"}
              </Text>
            </View>
            <View style={styles.insightItem}>
              <Text style={[styles.insightLabel, { color: muted }]}>Active days</Text>
              <Text style={[styles.insightValue, { color: text }]}>{activeDays}/7</Text>
            </View>
            <View style={styles.insightItem}>
              <Text style={[styles.insightLabel, { color: muted }]}>Daily avg</Text>
              <Text style={[styles.insightValue, { color: text }]}>{formatHours(weeklyTotal / 7)}</Text>
            </View>
          </View>
        </Card>

        <SectionTitle title="Subject breakdown" action="+ Add subject" onAction={openAddSubject} />
        {subjectStats.length === 0 ? (
          <Card>
            <EmptyState
              title="No subjects yet"
              subtitle="Add your first subject to see stats."
              icon="library-outline"
              actionLabel="Add subject"
              onAction={openAddSubject}
            />
          </Card>
        ) : subjectStats.map((s) => {
          const pct = totalSeconds ? (s.seconds / totalSeconds) * 100 : 0;
          return (
            <Card key={s.id} style={styles.subjectCard}>
              <View style={styles.subjectCardTop}>
                <View style={[styles.subjectLargeIcon, { backgroundColor: `${s.color}20` }]}>
                  <Ionicons name="book" size={23} color={s.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.subjectCardName, { color: text }]}>{s.name}</Text>
                  <Text style={[styles.smallText, { color: muted }]}>
                    {formatHours(s.seconds)} · {pct.toFixed(0)}% of total
                  </Text>
                </View>
                <Pressable onPress={() => openEditSubject(s)} style={styles.deleteButton}>
                  <Ionicons name="pencil" size={17} color={C.primary} />
                </Pressable>
                <Pressable onPress={() => deleteSubject(s)} style={styles.deleteButton}>
                  <Ionicons name="trash-outline" size={18} color={muted} />
                </Pressable>
              </View>
              <View style={[styles.subjectProgressTrack, { backgroundColor: theme.background }]}>
                <View style={[styles.subjectProgressFill, {
                  backgroundColor: s.color, width: `${Math.min(100, pct)}%`,
                }]} />
              </View>
            </Card>
          );
        })}

        <Pressable onPress={exportStats} style={styles.exportButton}>
          <Ionicons name="share-outline" size={19} color="#fff" />
          <Text style={styles.exportButtonText}>Export Stats</Text>
        </Pressable>
      </>
    );
  }

  // ---------- SETTINGS ----------
  function renderSettings() {
    return (
      <>
        <Text style={[styles.eyebrow, { color: muted }]}>MAKE IT YOURS</Text>
        <Text style={[styles.pageTitle, { color: text }]}>Settings</Text>
        <Text style={[styles.subtitle, { color: muted }]}>Customize your study experience.</Text>

        <Card style={styles.profileCard}>
          <View style={styles.profileIcon}>
            <Ionicons name="school" size={28} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.profileName, { color: text }]}>StudyFlow</Text>
            <Text style={[styles.smallText, { color: muted }]}>Professional Study Tracker</Text>
          </View>
          <View style={styles.versionBadge}>
            <Text style={styles.versionText}>v4.0</Text>
          </View>
        </Card>

        <Text style={[styles.settingsHeading, { color: muted }]}>PREFERENCES</Text>
        <Card>
          <View style={styles.settingRow}>
            <View style={[styles.settingIcon, { backgroundColor: theme.purpleLight }]}>
              <Ionicons name="moon-outline" size={19} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingTitle, { color: text }]}>Dark mode</Text>
              <Text style={[styles.smallText, { color: muted }]}>A darker study environment</Text>
            </View>
            <Switch value={darkMode} onValueChange={setDarkMode} trackColor={{ true: C.primary }} />
          </View>

          <View style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: theme.border }]}>
            <View style={[styles.settingIcon, { backgroundColor: theme.greenLight }]}>
              <Ionicons name="flag-outline" size={19} color={C.green} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingTitle, { color: text }]}>Daily goal</Text>
              <Text style={[styles.smallText, { color: muted }]}>Target: {dailyGoal} minutes per day</Text>
            </View>
          </View>
          <View style={styles.goalRow}>
            {[30, 60, 90, 120, 180].map((m) => (
              <Pressable
                key={m}
                onPress={() => setDailyGoal(m)}
                style={[styles.goalChip, {
                  backgroundColor: dailyGoal === m ? C.green : theme.background,
                  borderColor: dailyGoal === m ? C.green : theme.border,
                }]}
              >
                <Text style={{
                  color: dailyGoal === m ? "#fff" : text,
                  fontSize: 11, fontWeight: "700",
                }}>{m}m</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: theme.border }]}
            onPress={async () => {
              const ok = await ensureNotificationPermissions();
              toast[ok ? "success" : "error"](
                ok ? "Notifications enabled" : "Permission denied",
                ok ? "Reminders will fire on time." : "Enable notifications in system settings."
              );
            }}
          >
            <View style={[styles.settingIcon, { backgroundColor: theme.blueLight }]}>
              <Ionicons name="notifications-outline" size={19} color={C.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingTitle, { color: text }]}>Reminders & notifications</Text>
              <Text style={[styles.smallText, { color: muted }]}>Tap to test permission</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={muted} />
          </Pressable>
        </Card>

        <Text style={[styles.settingsHeading, { color: muted }]}>DATA & PRIVACY</Text>
        <Card>
          <View style={styles.settingRow}>
            <View style={[styles.settingIcon, { backgroundColor: theme.orangeLight }]}>
              <Ionicons name="server-outline" size={19} color={C.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingTitle, { color: text }]}>Local database</Text>
              <Text style={[styles.smallText, { color: muted }]}>
                Your study records are stored on this device.
              </Text>
            </View>
            <Ionicons name="checkmark-circle" size={22} color={C.green} />
          </View>
          <Pressable
            style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: theme.border }]}
            onPress={exportStats}
          >
            <View style={[styles.settingIcon, { backgroundColor: theme.blueLight }]}>
              <Ionicons name="share-outline" size={19} color={C.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingTitle, { color: text }]}>Export stats</Text>
              <Text style={[styles.smallText, { color: muted }]}>Share your study report</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={muted} />
          </Pressable>
          <Pressable
            style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: theme.border }]}
            onPress={() => Alert.alert(
              "About StudyFlow",
              "StudyFlow helps you manage tasks, track study time, and build consistent habits. Your records are stored locally on this device."
            )}
          >
            <View style={[styles.settingIcon, { backgroundColor: theme.purpleLight }]}>
              <Ionicons name="information-circle-outline" size={19} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingTitle, { color: text }]}>About StudyFlow</Text>
              <Text style={[styles.smallText, { color: muted }]}>App information</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={muted} />
          </Pressable>
        </Card>
      </>
    );
  }

  // ============================================================
  //  LOADING
  // ============================================================
  if (!ready)
    return (
      <SafeAreaView style={[styles.loadingScreen, { backgroundColor: bg }]}>
        <StatusBar style={darkMode ? "light" : "dark"} />
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={[styles.loadingText, { color: text }]}>Loading application...</Text>
      </SafeAreaView>
    );

  // ============================================================
  //  MAIN RENDER
  // ============================================================
  const NAV: readonly [Tab, React.ComponentProps<typeof Ionicons>["name"]][] = [
    ["Home", "home-outline"],
    ["Timer", "timer-outline"],
    ["Planner", "calendar-outline"],
    ["Subjects", "book-outline"],
    ["Stats", "stats-chart-outline"],
    ["Settings", "settings-outline"],
  ];

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: bg }]} edges={["top", "left", "right"]}>
      <StatusBar style={darkMode ? "light" : "dark"} />
      <View style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.primary}
              colors={[C.primary]}
            />
          }
          contentContainerStyle={[
            styles.pageContent,
            { paddingBottom: 110 + Math.max(insets.bottom, 8) },
          ]}
        >
          {tab === "Home" && renderHome()}
          {tab === "Timer" && renderTimer()}
          {tab === "Planner" && renderPlanner()}
          {tab === "Subjects" && renderSubjects()}
          {tab === "Stats" && renderStats()}
          {tab === "Settings" && renderSettings()}
        </ScrollView>

        <View style={[styles.bottomNavPosition, { bottom: Math.max(insets.bottom, 8) + 8 }]}>
          <View style={[styles.bottomNav, { backgroundColor: card, borderColor: theme.border }]}>
            {NAV.map(([name, icon]) => {
              const active = tab === name;
              return (
                <Pressable key={name} onPress={() => setTab(name)} style={styles.navItem}>
                  <View style={[styles.navIconWrap, active && { backgroundColor: theme.purpleLight }]}>
                    <Ionicons name={icon} size={20} color={active ? C.primary : muted} />
                  </View>
                  <Text style={[styles.navLabel, { color: active ? C.primary : muted }, active && { fontWeight: "800" }]}>
                    {name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      {/* MODALS */}
      <Modal
        visible={modal !== null}
        transparent
        animationType={modal === "fullscreenTimer" ? "fade" : "slide"}
        onRequestClose={() => {
          if (modal === "fullscreenTimer") return;
          setModal(null);
        }}
      >
        {modal === "fullscreenTimer" ? (
          <View style={styles.fullscreenTimerOverlay}>
            <SafeAreaView style={{ flex: 1, width: "100%", justifyContent: "center", alignItems: "center" }}>
              <StatusBar style="light" />
              <Text style={styles.fsSubject}>
                {subjects.find((s) => s.id === selectedSubject)?.name || "General Study"}
              </Text>
              <View style={styles.fsTimeWrap}>
                <Text style={styles.fsTimeText}>{formatTime(remainingTime)}</Text>
              </View>
              <View style={styles.fsControls}>
                {running ? (
                  <Pressable onPress={pauseTimer} style={styles.fsBtn}>
                    <Ionicons name="pause" size={32} color="#FFF" />
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => {
                      timerStartRef.current = Date.now();
                      setRunning(true);
                      setPaused(false);
                      void cancelNotification(timerNotificationRef.current);
                      timerNotificationRef.current = null;
                      const remaining = Math.max(0, durationTotalSeconds - baseElapsedRef.current);
                      void scheduleTimerEndNotification(remaining).then((id) => {
                        timerNotificationRef.current = id;
                      });
                    }}
                    style={[styles.fsBtn, { backgroundColor: "#14B87E" }]}
                  >
                    <Ionicons name="play" size={32} color="#FFF" />
                  </Pressable>
                )}
                <Pressable
                  onPress={() => {
                    if (running || elapsed > 0) {
                      Alert.alert("Finish Session?", "Save your elapsed study time?", [
                        { text: "Cancel", style: "cancel" },
                        { text: "Save & Finish", onPress: () => void finishTimer() },
                      ]);
                    } else {
                      resetTimer();
                      setModal(null);
                    }
                  }}
                  style={[styles.fsBtn, { backgroundColor: "#EF4B4B" }]}
                >
                  <Ionicons name="stop" size={32} color="#FFF" />
                </Pressable>
              </View>
              <Pressable onPress={() => setModal(null)} style={styles.fsCloseBtn}>
                <Text style={styles.fsCloseText}>Minimize (Keep Timer Running)</Text>
              </Pressable>
            </SafeAreaView>
          </View>
        ) : (
          <KeyboardAvoidingView
            style={styles.modalOverlay}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
          >
            <Pressable style={styles.modalBackdrop} onPress={() => setModal(null)} />
            <View style={[styles.modalSheet, {
              backgroundColor: card,
              paddingBottom: Math.max(insets.bottom, 20),
            }]}>
              <View style={styles.modalHandle} />
              <View style={styles.modalTitleRow}>
                <Text style={[styles.modalTitle, { color: text }]}>
                  {modal === "task" ? "Create a task"
                    : modal === "editTask" ? "Edit task"
                    : modal === "subject" ? "Add a subject"
                    : modal === "editSubject" ? "Edit subject"
                    : modal === "stickyNote" ? "New sticky note"
                    : modal === "editSticky" ? "Edit sticky note"
                    : "Session note"}
                </Text>
                <Pressable onPress={() => setModal(null)}>
                  <Ionicons name="close" size={24} color={muted} />
                </Pressable>
              </View>

              {/* TASK / EDIT TASK */}
              {(modal === "task" || modal === "editTask") && (
                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  <Text style={[styles.inputLabel, { color: text }]}>TASK TITLE</Text>
                  <TextInput
                    value={taskTitle}
                    onChangeText={setTaskTitle}
                    placeholder="e.g. Revise Static Electricity"
                    placeholderTextColor={muted}
                    style={[styles.modalInput, {
                      color: text, backgroundColor: theme.background, borderColor: theme.border,
                    }]}
                  />

                  <View style={styles.inlineLabelRow}>
                    <Text style={[styles.inputLabel, { color: text }]}>SUBJECT</Text>
                    <Pressable onPress={() => { setModal(null); setTimeout(openAddSubject, 200); }}>
                      <Text style={styles.actionText}>+ New subject</Text>
                    </Pressable>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    <Pressable
                      onPress={() => setTaskSubject(null)}
                      style={[styles.subjectChip, {
                        backgroundColor: taskSubject === null ? C.primary : theme.background,
                        borderColor: taskSubject === null ? C.primary : theme.border,
                      }]}
                    >
                      <Text style={{ color: taskSubject === null ? "#fff" : text, fontWeight: "700" }}>
                        General
                      </Text>
                    </Pressable>
                    {subjects.map((s) => (
                      <Pressable
                        key={s.id}
                        onPress={() => setTaskSubject(s.id)}
                        style={[styles.subjectChip, {
                          backgroundColor: taskSubject === s.id ? s.color : theme.background,
                          borderColor: taskSubject === s.id ? s.color : theme.border,
                        }]}
                      >
                        <Text style={{ color: taskSubject === s.id ? "#fff" : text, fontWeight: "700" }}>
                          {s.name}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>

                  <Text style={[styles.inputLabel, { color: text }]}>PRIORITY</Text>
                  <View style={styles.priorityOptions}>
                    {(["Low", "Medium", "High"] as const).map((p) => (
                      <Pressable
                        key={p}
                        onPress={() => setTaskPriority(p)}
                        style={[styles.priorityOption, {
                          backgroundColor: taskPriority === p ? C.primary : theme.background,
                          borderColor: taskPriority === p ? C.primary : theme.border,
                        }]}
                      >
                        <Text style={{ color: taskPriority === p ? "#fff" : text, fontWeight: "700" }}>{p}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={[styles.inputLabel, { color: text }]}>
                    REMINDER TIME (OPTIONAL) — 24h HH:MM
                  </Text>
                  <TextInput
                    value={taskTime}
                    onChangeText={setTaskTime}
                    placeholder="HH:MM — e.g. 18:30"
                    placeholderTextColor={muted}
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                    style={[styles.modalInput, {
                      color: text, backgroundColor: theme.background, borderColor: theme.border,
                    }]}
                  />
                  <Text style={[styles.smallText, { color: muted, marginBottom: 4 }]}>
                    🔔 A notification will fire at this time (reliable in production builds).
                  </Text>

                  <Text style={[styles.inputLabel, { color: text }]}>NOTES (OPTIONAL)</Text>
                  <TextInput
                    value={taskNotes}
                    onChangeText={setTaskNotes}
                    placeholder="Add details, chapters, page numbers..."
                    placeholderTextColor={muted}
                    multiline
                    numberOfLines={3}
                    style={[styles.modalInput, styles.modalTextArea, {
                      color: text, backgroundColor: theme.background, borderColor: theme.border,
                    }]}
                  />

                  <Pressable
                    onPress={() => modal === "editTask" ? void updateTask() : void addTask()}
                    style={styles.modalSubmit}
                  >
                    <Text style={styles.modalSubmitText}>
                      {modal === "editTask" ? "Save changes" : "Create task"}
                    </Text>
                  </Pressable>
                </ScrollView>
              )}

              {/* SUBJECT / EDIT SUBJECT */}
              {(modal === "subject" || modal === "editSubject") && (
                <ScrollView keyboardShouldPersistTaps="handled">
                  <Text style={[styles.inputLabel, { color: text }]}>SUBJECT NAME</Text>
                  <TextInput
                    value={subjectName}
                    onChangeText={setSubjectName}
                    placeholder="e.g. ICT, English, Geography..."
                    placeholderTextColor={muted}
                    autoFocus
                    style={[styles.modalInput, {
                      color: text, backgroundColor: theme.background, borderColor: theme.border,
                    }]}
                  />
                  <Text style={[styles.inputLabel, { color: text }]}>CHOOSE A COLOR</Text>
                  <View style={styles.colorOptions}>
                    {SUBJECT_COLORS.map((color) => (
                      <Pressable
                        key={color}
                        onPress={() => setSubjectColor(color)}
                        style={[styles.colorOption, {
                          backgroundColor: color,
                          borderWidth: subjectColor === color ? 3 : 0,
                          borderColor: text,
                        }]}
                      >
                        {subjectColor === color ? (
                          <Ionicons name="checkmark" size={17} color="#fff" />
                        ) : null}
                      </Pressable>
                    ))}
                  </View>
                  <Pressable onPress={() => void saveSubject()} style={styles.modalSubmit}>
                    <Text style={styles.modalSubmitText}>
                      {editingSubject ? "Save changes" : "Add subject"}
                    </Text>
                  </Pressable>
                </ScrollView>
              )}

              {/* STICKY NOTE / EDIT STICKY */}
              {(modal === "stickyNote" || modal === "editSticky") && (
                <ScrollView keyboardShouldPersistTaps="handled">
                  <Text style={[styles.inputLabel, { color: text }]}>YOUR NOTE</Text>
                  <TextInput
                    value={stickyText}
                    onChangeText={setStickyText}
                    placeholder="Write a quick reminder, formula, or idea..."
                    placeholderTextColor={muted}
                    multiline
                    numberOfLines={5}
                    autoFocus
                    style={[styles.modalInput, {
                      height: 110, paddingTop: 12, textAlignVertical: "top",
                      color: text, backgroundColor: theme.background, borderColor: theme.border,
                    }]}
                  />
                  <Text style={[styles.inputLabel, { color: text }]}>NOTE COLOR</Text>
                  <View style={styles.colorOptions}>
                    {STICKY_COLORS.map((color) => (
                      <Pressable
                        key={color}
                        onPress={() => setStickyColor(color)}
                        style={{
                          height: 40, width: 40, borderRadius: 14,
                          backgroundColor: color,
                          alignItems: "center", justifyContent: "center",
                          borderWidth: stickyColor === color ? 3 : 0,
                          borderColor: text,
                        }}
                      >
                        {stickyColor === color ? <Ionicons name="checkmark" size={18} color="#333" /> : null}
                      </Pressable>
                    ))}
                  </View>
                  <Pressable onPress={() => void saveSticky()} style={styles.modalSubmit}>
                    <Text style={styles.modalSubmitText}>
                      {editingSticky ? "Save changes" : "Pin note"}
                    </Text>
                  </Pressable>
                </ScrollView>
              )}

              {/* SESSION NOTE */}
              {modal === "sessionNote" && (
                <ScrollView keyboardShouldPersistTaps="handled">
                  <Text style={[styles.inputLabel, { color: text }]}>
                    WHAT DID YOU STUDY? (OPTIONAL)
                  </Text>
                  <TextInput
                    value={sessionNote}
                    onChangeText={setSessionNote}
                    placeholder="e.g. Chapter 5 - Thermodynamics"
                    placeholderTextColor={muted}
                    multiline
                    numberOfLines={3}
                    style={[styles.modalInput, styles.modalTextArea, {
                      color: text, backgroundColor: theme.background, borderColor: theme.border,
                    }]}
                  />
                  <Pressable onPress={() => void saveSessionNote()} style={styles.modalSubmit}>
                    <Text style={styles.modalSubmitText}>Save note</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setModal(null);
                      setSessionNote("");
                      setLastSessionId(null);
                    }}
                    style={styles.skipButton}
                  >
                    <Text style={[styles.skipButtonText, { color: muted }]}>Skip</Text>
                  </Pressable>
                </ScrollView>
              )}
            </View>
          </KeyboardAvoidingView>
        )}
      </Modal>
    </SafeAreaView>
  );
}

// ==================================================================
//  WRAPPER
// ==================================================================
export default function StudyFlowScreen() {
  return (
    <ToastProvider>
      <StudyFlowInner />
    </ToastProvider>
  );
}

// ==================================================================
//  STYLES
// ==================================================================
const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  loadingScreen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  loadingText: { fontSize: 14, fontWeight: "600" },
  pageContent: { paddingHorizontal: 20, paddingTop: 16 },
  greetingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 22 },
  eyebrow: { fontSize: 10, fontWeight: "900", letterSpacing: 1.6, marginBottom: 7 },
  pageTitle: { fontSize: 27, fontWeight: "900", letterSpacing: -0.8 },
  subtitle: { fontSize: 13, marginTop: 5, lineHeight: 19 },
  avatar: { height: 48, width: 48, borderRadius: 17, backgroundColor: "#EDEBFF", alignItems: "center", justifyContent: "center" },
  card: { borderRadius: 23, padding: 17, marginBottom: 16, borderWidth: 1 },
  heroCard: { backgroundColor: "#5B4BFF", borderColor: "#5B4BFF", padding: 20 },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroEyebrow: { color: "#D5D1FF", fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  heroNumber: { color: "#FFFFFF", fontSize: 36, fontWeight: "900", marginTop: 7 },
  heroSub: { color: "#E2E0FF", fontSize: 11, marginTop: 4, maxWidth: 215, lineHeight: 16 },
  heroRingWrap: { alignItems: "center", justifyContent: "center" },
  heroRingText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  heroDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.22)", marginVertical: 19 },
  heroBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 9 },
  heroStatLabel: { color: "#D5D1FF", fontSize: 10 },
  heroStatValue: { color: "#FFFFFF", fontSize: 19, fontWeight: "900", marginTop: 4 },
  heroButton: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#FFFFFF", paddingHorizontal: 12, paddingVertical: 11, borderRadius: 13 },
  heroButtonText: { color: "#5B4BFF", fontWeight: "800", fontSize: 11 },
  sectionTitle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10, marginBottom: 12 },
  sectionHeading: { fontSize: 17, fontWeight: "900", letterSpacing: -0.3 },
  actionText: { color: "#5B4BFF", fontSize: 12, fontWeight: "800" },
  statsRow: { flexDirection: "row", gap: 12 },
  statCard: { flex: 1, marginBottom: 16 },
  statIcon: { width: 37, height: 37, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  statValue: { fontSize: 23, fontWeight: "900" },
  statLabel: { fontSize: 11, marginTop: 4 },
  smallText: { fontSize: 11, lineHeight: 16 },
  chartHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chartTotal: { fontSize: 25, fontWeight: "900" },
  weekControls: { flexDirection: "row", gap: 6 },
  weekArrow: { width: 30, height: 30, borderRadius: 10, backgroundColor: "#F0F1F7", alignItems: "center", justifyContent: "center" },
  chart: { flexDirection: "row", height: 168, marginTop: 17, gap: 6 },
  chartColumn: { flex: 1, alignItems: "center" },
  chartValue: { fontSize: 9, fontWeight: "800", height: 17 },
  barTrack: { height: 118, width: "100%", justifyContent: "flex-end", alignItems: "center" },
  chartBar: { width: "58%", minWidth: 12, maxWidth: 25, borderRadius: 8 },
  chartLabel: { fontSize: 10, marginTop: 8 },
  taskRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, gap: 9 },
  checkCircle: { width: 21, height: 21, borderRadius: 7, borderWidth: 1.5, borderColor: "#D5D8E5", alignItems: "center", justifyContent: "center" },
  checkedCircle: { backgroundColor: "#14B87E", borderColor: "#14B87E" },
  taskTextWrap: { flex: 1 },
  taskTitle: { fontSize: 12, fontWeight: "800" },
  completedText: { textDecorationLine: "line-through", opacity: 0.55 },
  taskMeta: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5, flexWrap: "wrap" },
  miniDot: { height: 6, width: 6, borderRadius: 3 },
  priorityBadge: { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 7 },
  deleteButton: { padding: 5, marginLeft: 2 },
  subjectGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  subjectTile: { width: "48%", flexGrow: 1, borderWidth: 1, borderRadius: 17, padding: 13, marginBottom: 4 },
  addSubjectTile: { borderStyle: "dashed", borderWidth: 1.5, alignItems: "flex-start", justifyContent: "center", minHeight: 90 },
  addSubjectIcon: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  subjectColorBar: { width: 25, height: 5, borderRadius: 3, marginBottom: 12 },
  subjectTileName: { fontSize: 13, fontWeight: "900", marginBottom: 5 },
  stickyGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  stickyCard: {
    width: "48%", flexGrow: 1, borderRadius: 14, padding: 12, minHeight: 100,
    justifyContent: "space-between",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  stickyText: { fontSize: 12, fontWeight: "700", color: "#2A2230", lineHeight: 17 },
  stickyFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  stickyDate: { fontSize: 9, color: "rgba(0,0,0,0.4)", fontWeight: "700" },
  bottomNavPosition: { position: "absolute", left: 14, right: 14 },
  bottomNav: {
    minHeight: 66, borderRadius: 25, borderWidth: 1, flexDirection: "row",
    justifyContent: "space-around", alignItems: "center", paddingHorizontal: 4, paddingVertical: 6,
    elevation: 12, shadowColor: "#17162B",
    shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.12, shadowRadius: 12,
  },
  navItem: { alignItems: "center", justifyContent: "center", gap: 2, flex: 1 },
  navIconWrap: { height: 32, width: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  navLabel: { fontSize: 9, fontWeight: "600" },
  timerCard: { alignItems: "center", paddingVertical: 24, marginTop: 20 },
  timerBadge: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "#EDEBFF", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  timerBadgeText: { fontSize: 9, color: "#5B4BFF", fontWeight: "900", letterSpacing: 1 },
  timerCircleOuter: { height: 218, width: 218, borderRadius: 109, alignItems: "center", justifyContent: "center", marginVertical: 23 },
  timerProgress: { ...StyleSheet.absoluteFillObject, borderRadius: 109, borderWidth: 8 },
  timerCircleInner: { alignItems: "center", justifyContent: "center" },
  timerTime: { fontSize: 43, fontWeight: "900", fontVariant: ["tabular-nums"], letterSpacing: -1.5 },
  timerStatus: { fontSize: 12, marginTop: 8 },
  timerLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", alignSelf: "stretch", marginTop: 4, marginBottom: 11 },
  timerLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 1.1, alignSelf: "flex-start", marginBottom: 11, marginTop: 4 },
  chipScroll: { gap: 8, paddingBottom: 15 },
  subjectChip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10 },
  subjectChipEmpty: {
    borderWidth: 1, borderStyle: "dashed", borderColor: "#5B4BFF",
    borderRadius: 12, paddingHorizontal: 15, paddingVertical: 10,
    flexDirection: "row", alignItems: "center", gap: 6,
  },
  durationRow: { flexDirection: "row", gap: 9, width: "100%" },
  durationChip: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  customDurationRow: { flexDirection: "row", gap: 8, width: "100%", marginTop: 10 },
  customDurationInput: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, height: 44, fontSize: 13 },
  applyButton: { backgroundColor: "#5B4BFF", borderRadius: 12, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  applyButtonText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  timerActions: { flexDirection: "row", gap: 10, width: "100%", marginTop: 19 },
  startButton: {
    flex: 1, height: 53, borderRadius: 16, backgroundColor: "#5B4BFF",
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  startButtonText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  resetButton: { height: 53, width: 53, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  timerNote: { fontSize: 10, marginTop: 14, textAlign: "center" },
  breakRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  breakIcon: { width: 47, height: 47, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  breakTime: { fontSize: 22, fontWeight: "900", fontVariant: ["tabular-nums"] },
  breakBtn: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  breakLengthRow: { flexDirection: "row", gap: 8, marginTop: 14 },
  breakChip: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 9, alignItems: "center" },
  sessionRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 10, borderBottomWidth: 1 },
  sessionIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  sessionDuration: { fontSize: 13, fontWeight: "900" },
  plannerSummary: { backgroundColor: "#5B4BFF", borderColor: "#5B4BFF", flexDirection: "row", alignItems: "center" },
  plannerSummaryTitle: { color: "#fff", fontSize: 17, fontWeight: "900" },
  plannerSummarySubtitle: { color: "#E0DEFF", fontSize: 11, marginTop: 6 },
  plannerProgressCircle: {
    height: 58, width: 58, borderRadius: 29, backgroundColor: "rgba(255,255,255,0.17)",
    borderWidth: 3, borderColor: "#D5D1FF", alignItems: "center", justifyContent: "center",
  },
  plannerProgressText: { color: "#fff", fontWeight: "900", fontSize: 14 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 14, height: 46, borderRadius: 14, borderWidth: 1, marginBottom: 12 },
  searchInput: { flex: 1, fontSize: 13 },
  filterChip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  filterDivider: { width: 1, height: 24, marginHorizontal: 4, alignSelf: "center" },
  insightRow: { flexDirection: "row", justifyContent: "space-between" },
  insightItem: { alignItems: "center", flex: 1 },
  insightLabel: { fontSize: 10, marginBottom: 5 },
  insightValue: { fontSize: 15, fontWeight: "900" },
  exportButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#14B87E", borderRadius: 15, paddingVertical: 15, marginTop: 16,
  },
  exportButtonText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  addSubjectButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#5B4BFF", borderRadius: 15,
    paddingVertical: 16, marginTop: 20, marginBottom: 20,
  },
  addSubjectText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  subjectCard: { marginBottom: 12 },
  subjectCardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  subjectLargeIcon: { height: 48, width: 48, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  subjectCardName: { fontSize: 15, fontWeight: "900", marginBottom: 5 },
  subjectProgressTrack: { height: 7, borderRadius: 5, overflow: "hidden", marginTop: 19 },
  subjectProgressFill: { height: 7, borderRadius: 5 },
  subjectCardBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 11, gap: 8 },
  profileCard: { flexDirection: "row", alignItems: "center", gap: 13, marginTop: 22 },
  profileIcon: { width: 54, height: 54, borderRadius: 17, backgroundColor: "#5B4BFF", alignItems: "center", justifyContent: "center" },
  profileName: { fontSize: 17, fontWeight: "900", marginBottom: 5 },
  versionBadge: { backgroundColor: "#E1F8EE", paddingHorizontal: 9, paddingVertical: 6, borderRadius: 9 },
  versionText: { color: "#14B87E", fontSize: 10, fontWeight: "900" },
  settingsHeading: { fontSize: 10, fontWeight: "900", letterSpacing: 1.4, marginTop: 12, marginBottom: 10, marginLeft: 3 },
  settingRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 12 },
  settingIcon: { width: 39, height: 39, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  settingTitle: { fontSize: 12, fontWeight: "800", marginBottom: 4 },
  goalRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  goalChip: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 9, alignItems: "center" },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 25, paddingHorizontal: 12 },
  emptyIcon: { height: 48, width: 48, borderRadius: 16, backgroundColor: "#EDEBFF", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyTitle: { fontSize: 14, fontWeight: "900", textAlign: "center" },
  emptySubtitle: { fontSize: 11, textAlign: "center", marginTop: 6, lineHeight: 17 },
  emptyAction: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#5B4BFF", paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 11, marginTop: 14,
  },
  emptyActionText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  inlineLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 13, marginBottom: 9 },
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(12,16,32,0.48)" },
  modalSheet: { maxHeight: "88%", borderTopLeftRadius: 27, borderTopRightRadius: 27, paddingHorizontal: 22, paddingTop: 12 },
  modalHandle: { height: 5, width: 43, borderRadius: 4, backgroundColor: "#D9DCE7", alignSelf: "center", marginBottom: 18 },
  modalTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  modalTitle: { fontSize: 21, fontWeight: "900" },
  inputLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 1.1, marginBottom: 9, marginTop: 13 },
  modalInput: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 14, height: 49, fontSize: 13, marginBottom: 8 },
  modalTextArea: { height: 80, paddingTop: 12, textAlignVertical: "top" },
  priorityOptions: { flexDirection: "row", gap: 9, marginBottom: 8 },
  priorityOption: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  modalSubmit: {
    height: 52, borderRadius: 15, backgroundColor: "#5B4BFF",
    alignItems: "center", justifyContent: "center", marginTop: 10, marginBottom: 15,
  },
  modalSubmitText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  skipButton: { alignItems: "center", paddingVertical: 10, marginBottom: 15 },
  skipButtonText: { fontSize: 13, fontWeight: "700" },
  colorOptions: { flexDirection: "row", gap: 13, marginVertical: 10, flexWrap: "wrap" },
  colorOption: { height: 36, width: 36, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  fullscreenTimerOverlay: { flex: 1, backgroundColor: "#0A0C10", justifyContent: "center", alignItems: "center" },
  fsSubject: { color: "#8A92A8", fontSize: 18, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 20 },
  fsTimeWrap: { paddingVertical: 40 },
  fsTimeText: { color: "#FFFFFF", fontSize: 86, fontWeight: "200", fontVariant: ["tabular-nums"], letterSpacing: -2 },
  fsControls: { flexDirection: "row", gap: 30, marginTop: 40 },
  fsBtn: { width: 80, height: 80, borderRadius: 40, backgroundColor: "#5B4BFF", justifyContent: "center", alignItems: "center" },
  fsCloseBtn: { position: "absolute", bottom: 40, paddingVertical: 12, paddingHorizontal: 24 },
  fsCloseText: { color: "#8A92A8", fontSize: 13, fontWeight: "600" },
  toastHost: { position: "absolute", left: 14, right: 14, zIndex: 9999, alignItems: "center", gap: 8 },
  toast: {
    width: "100%", borderRadius: 16, borderWidth: 1, overflow: "hidden", elevation: 10,
    shadowColor: "#0B0F1E", shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14, shadowRadius: 14,
  },
  toastInner: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, paddingHorizontal: 12 },
  toastIconWrap: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  toastTitle: { fontSize: 12, fontWeight: "900" },
  toastMessage: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  toastProgress: { height: 2.5, width: "100%" },
});
