"use client";

import { useMemo, useState } from "react";
import {
  CalendarDays, ChevronLeft, ChevronRight, CircleAlert, Clock3, Gauge, Plus,
  Sparkles, UserRound, Users, WandSparkles,
} from "lucide-react";

const dayLabels = ["Пн", "Вт", "Ср", "Чт", "Пт"];

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateFromIso(value) {
  return value ? new Date(`${value}T12:00:00`) : null;
}

function startOfWeek(value) {
  const date = new Date(value);
  date.setHours(12, 0, 0, 0);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return date;
}

function addDays(value, count) {
  const date = new Date(value);
  date.setDate(date.getDate() + count);
  return date;
}

function taskProgress(task) {
  if (task.subtasks?.length) return Math.round((task.subtasks.filter((item) => item.done).length / task.subtasks.length) * 100);
  return Math.min(100, Math.max(0, Number(task.progress) || 0));
}

function remainingHours(task) {
  const effort = Math.max(0, Number(task.effortHours) || 0);
  return task.status === "done" ? 0 : Math.max(0, effort * (1 - taskProgress(task) / 100));
}

function workdaysBetween(start, end) {
  if (!start || !end || end < start) return [];
  const days = [];
  const cursor = new Date(start);
  let guard = 0;
  while (cursor <= end && guard < 740) {
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return days;
}

function taskWeekHours(task, weekDays) {
  const remaining = remainingHours(task);
  if (!remaining || task.status === "done") return weekDays.map(() => 0);
  const start = dateFromIso(task.start) || weekDays[0];
  const due = dateFromIso(task.due) || weekDays[4];
  const scheduleStart = start <= due ? start : due;
  const scheduleEnd = due >= start ? due : start;
  const schedule = workdaysBetween(scheduleStart, scheduleEnd);
  if (!schedule.length) return weekDays.map(() => 0);
  const perDay = remaining / schedule.length;
  return weekDays.map((day) => day >= scheduleStart && day <= scheduleEnd ? perDay : 0);
}

function formatHours(value) {
  const rounded = Math.round(value * 10) / 10;
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(rounded)} ч`;
}

function formatShortDate(value) {
  if (!value) return "Без срока";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(dateFromIso(value));
}

function loadMeta(hours, capacity) {
  const ratio = capacity ? hours / capacity : 0;
  if (ratio > 1) return { id: "overload", label: "Перегрузка", percent: Math.round(ratio * 100) };
  if (ratio >= 0.85) return { id: "tight", label: "Плотно", percent: Math.round(ratio * 100) };
  if (ratio >= 0.5) return { id: "balanced", label: "Нормально", percent: Math.round(ratio * 100) };
  return { id: "free", label: "Есть резерв", percent: Math.round(ratio * 100) };
}

export default function TeamWorkloadPanel({
  project,
  tasks,
  members,
  canEdit,
  onChangeTasks,
  onChangeCapacity,
  onOpenTask,
  onOpenTeam,
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [memberFilter, setMemberFilter] = useState("all");
  const weekDays = useMemo(() => Array.from({ length: 5 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const realMembers = useMemo(() => (members || []).filter((member) => !member.synthetic), [members]);

  const taskLoads = useMemo(() => new Map(tasks.map((task) => {
    const days = taskWeekHours(task, weekDays);
    return [task.id, { days, week: days.reduce((sum, value) => sum + value, 0), remaining: remainingHours(task) }];
  })), [tasks, weekDays]);

  const memberRows = useMemo(() => (members || []).map((member) => {
    const memberTasks = tasks.filter((task) => task.assigneeKey === member.member_key && task.status !== "done");
    const days = weekDays.map((_, dayIndex) => memberTasks.reduce((sum, task) => sum + (taskLoads.get(task.id)?.days[dayIndex] || 0), 0));
    const hours = days.reduce((sum, value) => sum + value, 0);
    const capacity = Math.min(80, Math.max(4, Number(project?.teamCapacity?.[member.member_key]) || 40));
    return { member, tasks: memberTasks, days, hours, capacity, meta: loadMeta(hours, capacity) };
  }), [members, tasks, taskLoads, weekDays, project?.teamCapacity]);

  const unassigned = useMemo(() => tasks
    .filter((task) => task.status !== "done" && !task.assigneeKey)
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999")), [tasks]);
  const visibleRows = memberFilter === "all" ? memberRows : memberRows.filter((row) => row.member.member_key === memberFilter);
  const totalHours = memberRows.reduce((sum, row) => sum + row.hours, 0);
  const totalCapacity = memberRows.reduce((sum, row) => sum + row.capacity, 0);
  const freeCapacity = Math.max(0, totalCapacity - totalHours);
  const overloaded = memberRows.filter((row) => row.hours > row.capacity).length;
  const unassignedHours = unassigned.reduce((sum, task) => sum + (taskLoads.get(task.id)?.week || 0), 0);
  const teamPercent = totalCapacity ? Math.round((totalHours / totalCapacity) * 100) : 0;
  const todayIso = isoDate(new Date());

  function patchTask(taskId, patch, message) {
    const now = new Date().toISOString();
    onChangeTasks(tasks.map((task) => task.id === taskId ? { ...task, ...patch, updatedAt: now } : task), message);
  }

  function autoAssign() {
    if (!realMembers.length || !unassigned.length) return;
    const projected = new Map(realMembers.map((member) => [member.member_key, memberRows.find((row) => row.member.member_key === member.member_key)?.hours || 0]));
    const assignments = new Map();
    [...unassigned].sort((a, b) => (taskLoads.get(b.id)?.week || 0) - (taskLoads.get(a.id)?.week || 0)).forEach((task) => {
      const target = [...realMembers].sort((a, b) => {
        const aCapacity = Number(project?.teamCapacity?.[a.member_key]) || 40;
        const bCapacity = Number(project?.teamCapacity?.[b.member_key]) || 40;
        return (projected.get(a.member_key) || 0) / aCapacity - (projected.get(b.member_key) || 0) / bCapacity;
      })[0];
      assignments.set(task.id, target.member_key);
      projected.set(target.member_key, (projected.get(target.member_key) || 0) + (taskLoads.get(task.id)?.week || 0));
    });
    const now = new Date().toISOString();
    onChangeTasks(tasks.map((task) => assignments.has(task.id) ? { ...task, assigneeKey: assignments.get(task.id), updatedAt: now } : task), "Нагрузка распределена между участниками");
  }

  return (
    <section className="workload-panel" aria-label="Загрузка команды">
      <header className="workload-header">
        <div><span className="section-kicker">Ресурсы проекта</span><h2>Загрузка команды</h2><p>Планируйте трудоёмкость, находите перегрузку и распределяйте задачи по свободной ёмкости.</p></div>
        <div className="workload-header-actions">
          <button className="workload-team-button" onClick={onOpenTeam}><Users size={16} /> Участники</button>
          {canEdit && <button className="workload-auto-button" onClick={autoAssign} disabled={!realMembers.length || !unassigned.length}><WandSparkles size={16} /> Распределить автоматически</button>}
        </div>
      </header>

      <div className="workload-kpis">
        <article><span className="workload-kpi-icon green"><Gauge size={18} /></span><div><strong>{teamPercent}%</strong><span>Загрузка команды</span></div><em>{formatHours(totalHours)} из {formatHours(totalCapacity)}</em></article>
        <article className={overloaded ? "attention" : ""}><span className="workload-kpi-icon red"><CircleAlert size={18} /></span><div><strong>{overloaded}</strong><span>Перегружено</span></div><em>{overloaded ? "Нужно перераспределить" : "Баланс соблюдён"}</em></article>
        <article><span className="workload-kpi-icon blue"><Clock3 size={18} /></span><div><strong>{formatHours(freeCapacity)}</strong><span>Свободная ёмкость</span></div><em>На выбранной неделе</em></article>
        <article className={unassigned.length ? "attention" : ""}><span className="workload-kpi-icon warm"><UserRound size={18} /></span><div><strong>{unassigned.length}</strong><span>Без исполнителя</span></div><em>{formatHours(unassignedHours)} на неделе</em></article>
      </div>

      <div className="workload-weekbar">
        <div><span className="section-kicker">Недельный план</span><h3>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(weekDays[0])} — {new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(weekDays[4])}</h3></div>
        <div className="workload-week-controls">
          <select value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)} aria-label="Фильтр участника"><option value="all">Вся команда</option>{(members || []).map((member) => <option key={member.member_key} value={member.member_key}>{member.display_name}</option>)}</select>
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Предыдущая неделя"><ChevronLeft size={18} /></button>
          <button className="workload-today" onClick={() => setWeekStart(startOfWeek(new Date()))}>Сегодня</button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Следующая неделя"><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="workload-grid">
        <div className="workload-roster">
          <div className="workload-roster-head"><span>Участник</span><div>{weekDays.map((day, index) => <span className={isoDate(day) === todayIso ? "today" : ""} key={isoDate(day)}><strong>{dayLabels[index]}</strong><em>{day.getDate()}</em></span>)}</div><span>Итого</span></div>
          {visibleRows.length ? visibleRows.map((row) => (
            <article className={`workload-member-row state-${row.meta.id}`} key={row.member.member_key}>
              <div className="workload-member">
                <span className="workload-avatar">{row.member.display_name.slice(0, 1).toUpperCase()}</span>
                <div><strong>{row.member.display_name}</strong><span>{row.member.role === "owner" ? "Владелец" : row.member.role === "viewer" ? "Наблюдатель" : "Редактор"}</span></div>
              </div>
              <div className="workload-day-bars">
                {row.days.map((hours, index) => {
                  const dayCapacity = row.capacity / 5;
                  const percent = dayCapacity ? Math.round((hours / dayCapacity) * 100) : 0;
                  return <div className={isoDate(weekDays[index]) === todayIso ? "today" : ""} key={isoDate(weekDays[index])}><span className={percent > 100 ? "over" : percent >= 85 ? "tight" : ""} style={{ height: `${Math.min(100, percent)}%` }} /><strong>{hours ? formatHours(hours) : "—"}</strong></div>;
                })}
              </div>
              <div className="workload-total">
                <strong>{formatHours(row.hours)}</strong><span className={`workload-state ${row.meta.id}`}>{row.meta.label} · {row.meta.percent}%</span>
                <label><span>Норма</span><input type="number" min="4" max="80" step="4" value={row.capacity} disabled={!canEdit || row.member.synthetic} onChange={(event) => onChangeCapacity(row.member.member_key, event.target.value)} /><em>ч</em></label>
              </div>
              <div className="workload-member-tasks">
                {row.tasks.filter((task) => (taskLoads.get(task.id)?.week || 0) > 0).slice(0, 4).map((task) => <button onClick={() => onOpenTask(task)} key={task.id}><span className={`priority-dot ${task.priority}`} /><strong>{task.title}</strong><em>{formatHours(taskLoads.get(task.id)?.week || 0)}</em></button>)}
                {!row.tasks.some((task) => (taskLoads.get(task.id)?.week || 0) > 0) && <span className="workload-no-tasks"><Sparkles size={14} /> На этой неделе есть резерв</span>}
              </div>
            </article>
          )) : <div className="workload-empty"><Users size={28} /><strong>В команде пока нет участников</strong><p>Добавьте коллег, чтобы распределять задачи и видеть загрузку.</p><button onClick={onOpenTeam}><Plus size={15} /> Добавить участника</button></div>}
        </div>

        <aside className="workload-unassigned">
          <div><span className="section-kicker">Очередь работ</span><h3>Нераспределённые задачи</h3><p>Укажите оценку и назначьте ответственного.</p></div>
          <div className="workload-unassigned-list">
            {unassigned.length ? unassigned.map((task) => <article key={task.id}>
              <button className="workload-task-title" onClick={() => onOpenTask(task)}><span className={`priority-dot ${task.priority}`} /><strong>{task.title}</strong><em>{formatShortDate(task.due)}</em></button>
              <div><label><Clock3 size={13} /><input type="number" min="1" max="500" step="1" value={task.effortHours || ""} disabled={!canEdit} onChange={(event) => patchTask(task.id, { effortHours: Math.max(1, Number(event.target.value) || 1) }, "Трудоёмкость задачи обновлена")} /><span>ч</span></label><select value="" disabled={!canEdit || !realMembers.length} onChange={(event) => event.target.value && patchTask(task.id, { assigneeKey: event.target.value }, "Исполнитель назначен")}><option value="">Назначить…</option>{realMembers.map((member) => <option key={member.member_key} value={member.member_key}>{member.display_name}</option>)}</select></div>
            </article>) : <div className="workload-queue-empty"><Sparkles size={23} /><strong>Все задачи распределены</strong><p>В очереди нет работ без исполнителя.</p></div>}
          </div>
          <div className="workload-hint"><CalendarDays size={16} /><span><strong>Как считается загрузка</strong><em>Оставшиеся часы распределяются по рабочим дням между началом и сроком задачи.</em></span></div>
        </aside>
      </div>
    </section>
  );
}
