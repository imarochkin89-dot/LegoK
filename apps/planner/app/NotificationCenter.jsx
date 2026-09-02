"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bell, CalendarClock, CheckCheck, CircleAlert, FileUp, ListChecks, LoaderCircle, MessageSquareText, RefreshCw, Settings2, X } from "lucide-react";

const categoryMeta = {
  taskEvents: { label: "Задачи и проекты", description: "Статусы, прогресс, назначения и новые задачи", icon: ListChecks },
  deadlines: { label: "Контроль сроков", description: "Просрочки, сроки сегодня и ближайшие 3 дня", icon: CalendarClock },
  comments: { label: "Комментарии", description: "Новые сообщения в обсуждениях задач", icon: MessageSquareText },
  files: { label: "Файлы", description: "Загрузка и удаление документов проекта", icon: FileUp },
};

function timeLabel(value) {
  const date = new Date(value);
  const difference = Date.now() - date.getTime();
  if (difference >= 0 && difference < 60_000) return "только что";
  if (difference >= 0 && difference < 3_600_000) return `${Math.max(1, Math.floor(difference / 60_000))} мин. назад`;
  if (difference >= 0 && difference < 86_400_000) return `${Math.max(1, Math.floor(difference / 3_600_000))} ч. назад`;
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function NotificationIcon({ item }) {
  if (item.category === "deadlines") return item.severity === "danger" ? <CircleAlert size={17} /> : <CalendarClock size={17} />;
  if (item.category === "comments") return <MessageSquareText size={17} />;
  if (item.category === "files") return <FileUp size={17} />;
  return <ListChecks size={17} />;
}

export default function NotificationCenter({ onOpenItem }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("list");
  const [filter, setFilter] = useState("all");
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [settings, setSettings] = useState({ taskEvents: true, deadlines: true, comments: true, files: true });
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    loadNotifications(true);
    const interval = setInterval(() => loadNotifications(true), 45_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function loadNotifications(silent = false) {
    if (!silent) setStatus("loading");
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить уведомления");
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      setUnreadCount(Number(data.unreadCount || 0));
      if (data.settings) setSettings(data.settings);
      setStatus("ready");
      setError("");
    } catch (loadError) {
      setStatus("error");
      setError(loadError.message || "Уведомления временно недоступны");
    }
  }

  async function postAction(payload) {
    try {
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось обновить уведомления");
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      setUnreadCount(Number(data.unreadCount || 0));
      if (data.settings) setSettings(data.settings);
      setError("");
      return true;
    } catch (actionError) {
      setError(actionError.message || "Не удалось обновить уведомления");
      return false;
    }
  }

  async function openNotification(item) {
    if (!item.read) {
      setNotifications((current) => current.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry));
      setUnreadCount((current) => Math.max(0, current - 1));
      await postAction({ action: "mark_read", key: item.id });
    }
    if (item.projectId || item.taskId) {
      setOpen(false);
      onOpenItem?.(item);
    }
  }

  async function markAllRead() {
    const keys = notifications.filter((item) => !item.read).map((item) => item.id);
    if (!keys.length) return;
    setNotifications((current) => current.map((item) => ({ ...item, read: true })));
    setUnreadCount(0);
    await postAction({ action: "mark_all_read", keys });
  }

  async function toggleSetting(key) {
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    await postAction({ action: "update_settings", settings: next });
  }

  const visibleNotifications = useMemo(() => notifications.filter((item) => filter === "all" || !item.read), [filter, notifications]);
  const activeCategories = Object.values(settings).filter(Boolean).length;

  return (
    <>
      <button className={`notification-bell ${open ? "active" : ""}`} onClick={() => { setOpen((value) => !value); setMode("list"); if (!open) loadNotifications(true); }} title="Уведомления" aria-label={`Уведомления${unreadCount ? `, непрочитанных: ${unreadCount}` : ""}`} aria-expanded={open}>
        <Bell size={16} />
        {unreadCount > 0 && <span>{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>

      {open && <button className="notification-scrim" onClick={() => setOpen(false)} aria-label="Закрыть уведомления" />}
      <aside className={`notification-panel ${open ? "open" : ""}`} aria-hidden={!open} aria-label="Центр уведомлений">
        <header className="notification-head">
          <div>
            <span className="section-kicker">Рабочее пространство</span>
            <h2>{mode === "settings" ? "Настройки" : "Уведомления"}</h2>
          </div>
          <div>
            {mode === "settings" ? <button onClick={() => setMode("list")} title="Назад"><ArrowLeft size={17} /></button> : <button onClick={() => setMode("settings")} title="Настройки уведомлений"><Settings2 size={17} /></button>}
            <button onClick={() => setOpen(false)} title="Закрыть"><X size={18} /></button>
          </div>
        </header>

        {mode === "settings" ? (
          <div className="notification-settings">
            <div className="notification-settings-intro"><span><Bell size={19} /></span><div><strong>Персональная лента</strong><p>Выберите события, которые должны появляться в вашем центре уведомлений.</p></div></div>
            <div className="notification-setting-list">
              {Object.entries(categoryMeta).map(([key, meta]) => { const Icon = meta.icon; return <label key={key}><span className={`notification-setting-icon category-${key}`}><Icon size={17} /></span><span><strong>{meta.label}</strong><em>{meta.description}</em></span><input type="checkbox" checked={settings[key]} onChange={() => toggleSetting(key)} /><i /></label>; })}
            </div>
            <div className="notification-settings-note"><CheckCheck size={16} /><span><strong>{activeCategories} из 4 категорий включено</strong><em>Настройки сохраняются только для вашего профиля.</em></span></div>
          </div>
        ) : (
          <>
            <div className="notification-toolbar">
              <div><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Все</button><button className={filter === "unread" ? "active" : ""} onClick={() => setFilter("unread")}>Непрочитанные <span>{unreadCount}</span></button></div>
              <button onClick={markAllRead} disabled={!unreadCount}><CheckCheck size={15} /> Прочитать все</button>
            </div>
            {error && <div className="notification-error"><CircleAlert size={15} /><span>{error}</span><button onClick={() => loadNotifications()}><RefreshCw size={14} /></button></div>}
            <div className="notification-list">
              {status === "loading" && !notifications.length ? <div className="notification-empty"><LoaderCircle className="spin" size={25} /><strong>Проверяю обновления…</strong></div> : visibleNotifications.length ? visibleNotifications.map((item) => (
                <button key={item.id} className={`notification-item severity-${item.severity} ${item.read ? "read" : "unread"}`} onClick={() => openNotification(item)}>
                  <span className={`notification-icon category-${item.category}`}><NotificationIcon item={item} /></span>
                  <span className="notification-copy"><strong>{item.label}</strong><span>{item.actorName} · {item.detail}</span><time>{timeLabel(item.createdAt)}</time></span>
                  {!item.read && <i aria-label="Непрочитано" />}
                </button>
              )) : <div className="notification-empty"><CheckCheck size={29} /><strong>{filter === "unread" ? "Всё прочитано" : "Новых событий нет"}</strong><p>{filter === "unread" ? "Вы просмотрели все уведомления." : "Обновления команды появятся здесь."}</p></div>}
            </div>
            <footer className="notification-footer"><span className="live-dot" />Обновляется автоматически каждые 45 секунд</footer>
          </>
        )}
      </aside>
    </>
  );
}
