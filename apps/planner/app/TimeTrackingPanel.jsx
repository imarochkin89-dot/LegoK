"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock3, Download, ListChecks, Pause,
  Play, Plus, Search, Sparkles, Timer, Trash2, UserRound, X,
} from "lucide-react";

const weekDayLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfWeek(value) {
  const date = new Date(value);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function addDays(value, count) {
  const date = new Date(value);
  date.setDate(date.getDate() + count);
  return date;
}

function formatMinutes(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} мин`;
  if (!rest) return `${hours} ч`;
  return `${hours} ч ${rest} мин`;
}

function formatTimer(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const rest = String(seconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${rest}`;
}

function formatEntryDate(value) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function downloadCsv(entries, tasks) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const rows = [["Дата", "Участник", "Задача", "Минуты", "Комментарий"], ...entries.map((entry) => [entry.date, entry.memberName || "Участник", taskById.get(entry.taskId)?.title || "Удалённая задача", entry.minutes, entry.note || ""])];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `kontur-time-${isoDate(new Date())}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function TimeTrackingPanel({ project, tasks, members, actor, canEdit, onChangeTimeData, onOpenTask, initialTaskId = "" }) {
  const actorKey = actor?.key || members?.find((member) => member.role === "owner")?.member_key || members?.find((member) => !member.synthetic)?.member_key || "local-owner";
  const actorName = actor?.name || members?.find((member) => member.member_key === actorKey)?.display_name || "Руководитель проекта";
  const entries = project?.timeEntries || [];
  const activeTimers = project?.activeTimers || {};
  const activeTimer = activeTimers[actorKey] || null;
  const [now, setNow] = useState(() => Date.now());
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [timerTaskId, setTimerTaskId] = useState(initialTaskId || tasks.find((task) => task.status !== "done")?.id || "");
  const [timerNote, setTimerNote] = useState("");
  const [memberFilter, setMemberFilter] = useState("all");
  const [taskFilter, setTaskFilter] = useState(initialTaskId || "all");
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [draft, setDraft] = useState({ taskId: initialTaskId || "", memberKey: actorKey, date: isoDate(new Date()), hours: 1, note: "" });

  useEffect(() => {
    if (initialTaskId) { setTaskFilter(initialTaskId); setTimerTaskId(initialTaskId); }
  }, [initialTaskId]);

  useEffect(() => {
    if (!activeTimer) return undefined;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeTimer?.startedAt]);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const weekStartIso = isoDate(weekDays[0]);
  const weekEndIso = isoDate(weekDays[6]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const resolvedMemberKey = (entry) => entry.memberKey || actorKey;

  const roster = useMemo(() => {
    const result = [...(members || [])];
    const known = new Set(result.map((member) => member.member_key));
    entries.forEach((entry) => {
      const key = entry.memberKey || actorKey;
      if (!known.has(key)) {
        known.add(key);
        result.push({ member_key: key, display_name: entry.memberName || "Участник", role: "editor", status: "active" });
      }
    });
    if (!result.length) result.push({ member_key: actorKey, display_name: actorName, role: "owner", status: "active" });
    return result;
  }, [members, entries, actorKey, actorName]);
  const manualRoster = roster.filter((member) => !member.synthetic);

  const weekEntries = useMemo(() => entries.filter((entry) => entry.date >= weekStartIso && entry.date <= weekEndIso), [entries, weekStartIso, weekEndIso]);
  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...entries].filter((entry) => {
      const task = taskById.get(entry.taskId);
      return (memberFilter === "all" || resolvedMemberKey(entry) === memberFilter)
        && (taskFilter === "all" || entry.taskId === taskFilter)
        && `${task?.title || ""} ${entry.note || ""} ${entry.memberName || ""}`.toLowerCase().includes(needle);
    }).sort((a, b) => `${b.date}${b.createdAt || ""}`.localeCompare(`${a.date}${a.createdAt || ""}`));
  }, [entries, memberFilter, taskFilter, query, taskById, actorKey]);

  const todayIso = isoDate(new Date());
  const todayMinutes = entries.filter((entry) => entry.date === todayIso).reduce((sum, entry) => sum + Number(entry.minutes || 0), 0);
  const weekMinutes = weekEntries.reduce((sum, entry) => sum + Number(entry.minutes || 0), 0);
  const activeCount = Object.keys(activeTimers).length;
  const plannedMinutes = tasks.reduce((sum, task) => sum + Math.max(0, Number(task.effortHours) || 0) * 60, 0);
  const loggedMinutes = entries.reduce((sum, entry) => sum + Number(entry.minutes || 0), 0);
  const planPercent = plannedMinutes ? Math.round((loggedMinutes / plannedMinutes) * 100) : 0;

  const memberRows = roster.map((member) => {
    const days = weekDays.map((day) => weekEntries.filter((entry) => resolvedMemberKey(entry) === member.member_key && entry.date === isoDate(day)).reduce((sum, entry) => sum + Number(entry.minutes || 0), 0));
    return { member, days, total: days.reduce((sum, minutes) => sum + minutes, 0) };
  });

  const taskRows = tasks.map((task) => {
    const logged = entries.filter((entry) => entry.taskId === task.id).reduce((sum, entry) => sum + Number(entry.minutes || 0), 0);
    const planned = Math.max(1, Number(task.effortHours) || 0) * 60;
    return { task, logged, planned, percent: Math.round((logged / planned) * 100) };
  }).sort((a, b) => b.logged - a.logged || b.percent - a.percent);

  function update(next, message) {
    onChangeTimeData({ timeEntries: next.timeEntries ?? entries, activeTimers: next.activeTimers ?? activeTimers }, message);
  }

  function startTimer() {
    if (!timerTaskId || activeTimer) return;
    update({ activeTimers: { ...activeTimers, [actorKey]: { taskId: timerTaskId, note: timerNote.trim(), startedAt: new Date().toISOString(), memberName: actorName } } }, "Таймер запущен");
  }

  function stopTimer() {
    if (!activeTimer) return;
    const endedAt = new Date();
    const minutes = Math.max(1, Math.round((endedAt - new Date(activeTimer.startedAt)) / 60000));
    const nextTimers = { ...activeTimers };
    delete nextTimers[actorKey];
    update({
      activeTimers: nextTimers,
      timeEntries: [{ id: `time-${Date.now()}`, taskId: activeTimer.taskId, memberKey: actorKey, memberName: activeTimer.memberName || actorName, date: isoDate(endedAt), minutes, note: activeTimer.note || "", createdAt: endedAt.toISOString() }, ...entries],
    }, "Время сохранено в табеле");
    setTimerNote("");
  }

  function openManual() {
    setDraft({ taskId: initialTaskId || timerTaskId || tasks[0]?.id || "", memberKey: actorKey, date: todayIso, hours: 1, note: "" });
    setModalOpen(true);
  }

  function saveManual(event) {
    event.preventDefault();
    if (!draft.taskId || !draft.date || Number(draft.hours) <= 0) return;
    const member = roster.find((item) => item.member_key === draft.memberKey);
    const minutes = Math.min(1440, Math.max(1, Math.round(Number(draft.hours) * 60)));
    update({ timeEntries: [{ id: `time-${Date.now()}`, taskId: draft.taskId, memberKey: draft.memberKey, memberName: member?.display_name || actorName, date: draft.date, minutes, note: draft.note.trim(), createdAt: new Date().toISOString() }, ...entries] }, "Запись времени добавлена");
    setModalOpen(false);
  }

  function deleteEntry(entry) {
    if (confirmDeleteId !== entry.id) { setConfirmDeleteId(entry.id); return; }
    update({ timeEntries: entries.filter((item) => item.id !== entry.id) }, "Запись времени удалена");
    setConfirmDeleteId("");
  }

  return (
    <section className="time-panel" aria-label="Учёт времени">
      <header className="time-header">
        <div><span className="section-kicker">Фактические трудозатраты</span><h2>Учёт времени</h2><p>Запускайте таймер по задаче, заполняйте табель вручную и сравнивайте фактические часы с планом.</p></div>
        <div className="time-header-actions"><button onClick={() => downloadCsv(filteredEntries, tasks)}><Download size={16} /> Экспорт</button>{canEdit && <button className="time-manual-button" onClick={openManual}><Plus size={16} /> Добавить время</button>}</div>
      </header>

      <section className={`time-timer-card ${activeTimer ? "is-running" : ""}`} aria-label="Таймер задачи">
        <div className="time-timer-icon">{activeTimer ? <Pause size={22} /> : <Timer size={22} />}</div>
        <div className="time-timer-copy"><span>{activeTimer ? "Таймер запущен" : "Быстрый таймер"}</span><strong>{activeTimer ? taskById.get(activeTimer.taskId)?.title || "Удалённая задача" : "Начните работу над задачей"}</strong><em>{activeTimer?.note || "Время сохранится в общем табеле проекта"}</em></div>
        <div className="time-timer-form">
          {!activeTimer && <><select aria-label="Задача для таймера" value={timerTaskId} onChange={(event) => setTimerTaskId(event.target.value)}><option value="">Выберите задачу</option>{tasks.filter((task) => task.status !== "done").map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}</select><input aria-label="Комментарий таймера" value={timerNote} onChange={(event) => setTimerNote(event.target.value)} placeholder="Что делаете?" /></>}
        </div>
        <div className="time-counter"><strong>{activeTimer ? formatTimer(now - new Date(activeTimer.startedAt).getTime()) : "00:00:00"}</strong><button className={activeTimer ? "stop" : "start"} disabled={!canEdit || (!activeTimer && !timerTaskId)} onClick={activeTimer ? stopTimer : startTimer}>{activeTimer ? <><Pause size={16} /> Остановить</> : <><Play size={16} /> Запустить</>}</button></div>
      </section>

      <div className="time-kpis">
        <article><span className="time-kpi-icon green"><Clock3 size={18} /></span><div><strong>{formatMinutes(todayMinutes)}</strong><span>Сегодня</span></div><em>{entries.filter((entry) => entry.date === todayIso).length} записей</em></article>
        <article><span className="time-kpi-icon blue"><CalendarDays size={18} /></span><div><strong>{formatMinutes(weekMinutes)}</strong><span>За неделю</span></div><em>{weekStartIso} — {weekEndIso}</em></article>
        <article className={activeCount ? "active" : ""}><span className="time-kpi-icon warm"><Timer size={18} /></span><div><strong>{activeCount}</strong><span>Активных таймеров</span></div><em>{activeTimer ? "Ваш таймер работает" : "Сейчас никто не считает"}</em></article>
        <article><span className="time-kpi-icon violet"><ListChecks size={18} /></span><div><strong>{planPercent}%</strong><span>Освоено от плана</span></div><em>{formatMinutes(loggedMinutes)} из {formatMinutes(plannedMinutes)}</em></article>
      </div>

      <div className="time-weekbar"><div><span className="section-kicker">Недельный табель</span><h3>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(weekDays[0])} — {new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(weekDays[6])}</h3></div><div><button onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Предыдущая неделя"><ChevronLeft size={18} /></button><button className="time-today" onClick={() => setWeekStart(startOfWeek(new Date()))}>Сегодня</button><button onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Следующая неделя"><ChevronRight size={18} /></button></div></div>

      <div className="time-main-grid">
        <section className="timesheet-card">
          <div className="timesheet-head"><span>Участник</span>{weekDays.map((day, index) => <span className={isoDate(day) === todayIso ? "today" : ""} key={isoDate(day)}><strong>{weekDayLabels[index]}</strong><em>{day.getDate()}</em></span>)}<span>Итого</span></div>
          {memberRows.map((row) => <article key={row.member.member_key}><div className="timesheet-member"><span>{row.member.display_name.slice(0, 1).toUpperCase()}</span><div><strong>{row.member.display_name}</strong><em>{row.member.role === "owner" ? "Владелец" : row.member.role === "viewer" ? "Наблюдатель" : "Редактор"}</em></div></div>{row.days.map((minutes, index) => <div className={`timesheet-cell ${isoDate(weekDays[index]) === todayIso ? "today" : ""} ${minutes ? "has-time" : ""}`} key={isoDate(weekDays[index])}><strong>{minutes ? formatMinutes(minutes) : "—"}</strong></div>)}<div className="timesheet-total"><strong>{formatMinutes(row.total)}</strong><span>{row.total >= 2400 ? "Полная неделя" : `${Math.round(row.total / 24)}% от 40 ч`}</span></div></article>)}
        </section>

        <aside className="time-task-summary"><div><span className="section-kicker">План / факт</span><h3>По задачам</h3></div><div className="time-task-list">{taskRows.slice(0, 7).map((row) => <button onClick={() => onOpenTask(row.task)} key={row.task.id}><div><span className={`priority-dot ${row.task.priority}`} /><strong>{row.task.title}</strong><em>{formatMinutes(row.logged)} / {formatMinutes(row.planned)}</em></div><span className="time-progress-track"><i className={row.percent > 100 ? "over" : ""} style={{ width: `${Math.min(100, row.percent)}%` }} /></span><small>{row.percent}%</small></button>)}</div></aside>
      </div>

      <section className="time-log-card">
        <div className="time-log-head"><div><span className="section-kicker">Журнал работ</span><h3>Записи времени</h3></div><div className="time-log-filters"><label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти запись..." />{query && <button onClick={() => setQuery("")}><X size={13} /></button>}</label><select value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)}><option value="all">Все участники</option>{roster.map((member) => <option key={member.member_key} value={member.member_key}>{member.display_name}</option>)}</select><select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}><option value="all">Все задачи</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></div></div>
        {filteredEntries.length ? <div className="time-log-list">{filteredEntries.map((entry) => { const task = taskById.get(entry.taskId); return <article key={entry.id}><span className="time-log-avatar">{(entry.memberName || actorName).slice(0, 1).toUpperCase()}</span><div className="time-log-main"><strong>{entry.memberName || actorName}</strong><span>{entry.note || "Без комментария"}</span></div><button className="time-log-task" onClick={() => task && onOpenTask(task)}>{task?.title || "Удалённая задача"}</button><time>{formatEntryDate(entry.date)}</time><strong className="time-log-duration">{formatMinutes(entry.minutes)}</strong>{canEdit && <button className={`time-delete ${confirmDeleteId === entry.id ? "confirm" : ""}`} onClick={() => deleteEntry(entry)} onBlur={() => setTimeout(() => setConfirmDeleteId(""), 150)} title={confirmDeleteId === entry.id ? "Нажмите ещё раз" : "Удалить запись"}><Trash2 size={14} /></button>}</article>; })}</div> : <div className="time-empty"><Sparkles size={28} /><strong>Записей пока нет</strong><p>Запустите таймер или добавьте отработанное время вручную.</p></div>}
      </section>

      {modalOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setModalOpen(false)}><div className="modal time-modal" role="dialog" aria-modal="true"><div className="modal-header"><div><span className="section-kicker">Ручная запись</span><h2>Добавить время</h2></div><button className="modal-close" onClick={() => setModalOpen(false)}><X size={20} /></button></div><form onSubmit={saveManual}><div className="form-grid"><label className="field"><span>Задача</span><select value={draft.taskId} onChange={(event) => setDraft({ ...draft, taskId: event.target.value })} required><option value="">Выберите задачу</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><label className="field"><span>Участник</span><select value={draft.memberKey} onChange={(event) => setDraft({ ...draft, memberKey: event.target.value })}>{!manualRoster.length && <option value={actorKey}>{actorName}</option>}{manualRoster.map((member) => <option key={member.member_key} value={member.member_key}>{member.display_name}</option>)}</select></label><label className="field"><span>Дата</span><input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} required /></label><label className="field"><span>Продолжительность, ч</span><input type="number" min="0.25" max="24" step="0.25" value={draft.hours} onChange={(event) => setDraft({ ...draft, hours: Number(event.target.value) })} required /></label></div><label className="field full time-note-field"><span>Комментарий</span><textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="Что было сделано?" rows="3" /></label><div className="modal-actions"><span /><div><button type="button" className="secondary-button" onClick={() => setModalOpen(false)}>Отмена</button><button type="submit" className="primary-button">Добавить</button></div></div></form></div></div>}
    </section>
  );
}
