"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, CircleAlert, Link2, Plus } from "lucide-react";

const DAY_MS = 86400000;
const ROW_HEIGHT = 58;

function parseDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function differenceInDays(later, earlier) {
  return Math.round((later - earlier) / DAY_MS);
}

function startOfWeek(date) {
  const day = (date.getDay() + 6) % 7;
  return addDays(date, -day);
}

function taskDates(task) {
  const end = parseDate(task.due);
  const start = parseDate(task.start) || (end ? addDays(end, -3) : null);
  return { start, end: end || (start ? addDays(start, 3) : null) };
}

function shortDate(value) {
  if (!value) return "Без даты";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(value);
}

function plural(number, one, few, many) {
  const mod100 = number % 100;
  const mod10 = number % 10;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export default function GanttView({ tasks, allTasks, projectColor, onOpenTask, onAddDates, canEdit }) {
  const [rangeDays, setRangeDays] = useState(28);
  const [anchor, setAnchor] = useState(() => new Date());
  const dayWidth = rangeDays === 14 ? 64 : rangeDays === 28 ? 42 : 27;
  const timelineWidth = rangeDays * dayWidth;
  const rangeStart = useMemo(() => startOfWeek(anchor), [anchor]);
  const days = useMemo(() => Array.from({ length: rangeDays }, (_, index) => addDays(rangeStart, index)), [rangeDays, rangeStart]);
  const rangeEnd = days[days.length - 1];
  const taskById = useMemo(() => new Map(allTasks.map((task) => [task.id, task])), [allTasks]);

  const scheduledTasks = useMemo(() => tasks
    .filter((task) => task.start || task.due)
    .slice()
    .sort((left, right) => {
      const leftDates = taskDates(left);
      const rightDates = taskDates(right);
      return (leftDates.start || leftDates.end) - (rightDates.start || rightDates.end);
    }), [tasks]);
  const unscheduledTasks = tasks.filter((task) => !task.start && !task.due);

  const weeks = useMemo(() => {
    const groups = [];
    days.forEach((date, index) => {
      const weekKey = dateKey(startOfWeek(date));
      const current = groups[groups.length - 1];
      if (current?.key === weekKey) current.span += 1;
      else groups.push({ key: weekKey, span: 1, startIndex: index, label: `${shortDate(date)} — ${shortDate(addDays(date, 6))}` });
    });
    return groups;
  }, [days]);

  const dependencyLines = useMemo(() => {
    const rowById = new Map(scheduledTasks.map((task, index) => [task.id, index]));
    return scheduledTasks.flatMap((task, taskIndex) => (task.dependsOn || []).map((parentId) => {
      const parent = taskById.get(parentId);
      const parentRow = rowById.get(parentId);
      if (!parent || parentRow === undefined) return null;
      const parentDates = taskDates(parent);
      const childDates = taskDates(task);
      if (!parentDates.end || !childDates.start) return null;
      const x1 = (differenceInDays(parentDates.end, rangeStart) + 1) * dayWidth;
      const x2 = differenceInDays(childDates.start, rangeStart) * dayWidth;
      if (x1 < 0 || x2 > timelineWidth || x1 > timelineWidth || x2 < 0) return null;
      const y1 = parentRow * ROW_HEIGHT + ROW_HEIGHT / 2;
      const y2 = taskIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
      const bend = Math.max(x1 + 12, x1 + (x2 - x1) / 2);
      return { id: `${parentId}-${task.id}`, path: `M ${x1} ${y1} H ${bend} V ${y2} H ${Math.max(5, x2 - 6)}` };
    }).filter(Boolean));
  }, [dayWidth, rangeStart, scheduledTasks, taskById, timelineWidth]);

  const dependencyRisks = scheduledTasks.filter((task) => {
    const { start } = taskDates(task);
    return start && (task.dependsOn || []).some((parentId) => {
      const parentEnd = taskDates(taskById.get(parentId) || {}).end;
      return parentEnd && parentEnd >= start;
    });
  }).length;
  const todayKey = dateKey(new Date());
  const todayOffset = differenceInDays(parseDate(todayKey), rangeStart);

  return (
    <section className="gantt-panel" aria-label="Диаграмма Ганта">
      <div className="gantt-head">
        <div>
          <span className="section-kicker">План-график</span>
          <h2>Диаграмма Ганта</h2>
          <p>{scheduledTasks.length} {plural(scheduledTasks.length, "задача", "задачи", "задач")} на шкале · {dependencyLines.length} {plural(dependencyLines.length, "видимая связь", "видимые связи", "видимых связей")}</p>
        </div>
        <div className="gantt-actions">
          <label><span>Масштаб</span><select value={rangeDays} onChange={(event) => setRangeDays(Number(event.target.value))}><option value="14">2 недели</option><option value="28">4 недели</option><option value="56">8 недель</option></select></label>
          <div className="gantt-navigation"><button onClick={() => setAnchor(addDays(anchor, -Math.round(rangeDays / 2)))} aria-label="Предыдущий период"><ChevronLeft size={18} /></button><button className="gantt-today" onClick={() => setAnchor(new Date())}>Сегодня</button><button onClick={() => setAnchor(addDays(anchor, Math.round(rangeDays / 2)))} aria-label="Следующий период"><ChevronRight size={18} /></button></div>
        </div>
      </div>

      <div className="gantt-summary">
        <span><CalendarDays size={15} />{shortDate(rangeStart)} — {shortDate(rangeEnd)}</span>
        <span className={dependencyRisks ? "risk" : "calm"}><CircleAlert size={15} />{dependencyRisks ? `${dependencyRisks} конфликтов зависимостей` : "Зависимости без конфликтов"}</span>
        <span><Link2 size={15} />Связь считается после завершения предшественника</span>
      </div>

      {scheduledTasks.length ? (
        <div className="gantt-frame">
          <div className="gantt-task-pane">
            <div className="gantt-pane-head"><strong>Задача</strong><span>Период</span></div>
            {scheduledTasks.map((task) => {
              const dates = taskDates(task);
              return <button className="gantt-task-row" key={task.id} onClick={() => onOpenTask(task)}><span className={`gantt-status ${task.status}`} /><span className="gantt-task-copy"><strong>{task.title}</strong><em>{(task.dependsOn || []).length ? `После: ${(task.dependsOn || []).map((id) => taskById.get(id)?.title).filter(Boolean).join(", ")}` : "Без зависимостей"}</em></span><time>{shortDate(dates.start)}<b>→</b>{shortDate(dates.end)}</time></button>;
            })}
          </div>

          <div className="gantt-timeline-scroll">
            <div className="gantt-timeline" style={{ width: timelineWidth }}>
              <div className="gantt-week-head">{weeks.map((week) => <span key={week.key} style={{ width: week.span * dayWidth }}>{week.label}</span>)}</div>
              <div className="gantt-day-head">{days.map((day) => <span className={`${[0, 6].includes(day.getDay()) ? "weekend" : ""} ${dateKey(day) === todayKey ? "today" : ""}`} key={dateKey(day)} style={{ width: dayWidth }}><b>{new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(day)}</b>{day.getDate()}</span>)}</div>
              <div className="gantt-rows" style={{ height: scheduledTasks.length * ROW_HEIGHT }}>
                <div className="gantt-grid-lines">{days.map((day) => <span className={[0, 6].includes(day.getDay()) ? "weekend" : ""} key={dateKey(day)} style={{ width: dayWidth, height: scheduledTasks.length * ROW_HEIGHT }} />)}</div>
                {todayOffset >= 0 && todayOffset < rangeDays && <span className="gantt-today-line" style={{ left: todayOffset * dayWidth + dayWidth / 2 }}><em>Сегодня</em></span>}
                <svg className="gantt-links" width={timelineWidth} height={scheduledTasks.length * ROW_HEIGHT} aria-hidden="true"><defs><marker id="gantt-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>{dependencyLines.map((line) => <path key={line.id} d={line.path} markerEnd="url(#gantt-arrow)" />)}</svg>
                {scheduledTasks.map((task, index) => {
                  const { start, end } = taskDates(task);
                  const rawStart = differenceInDays(start, rangeStart);
                  const rawEnd = differenceInDays(end, rangeStart) + 1;
                  const visibleStart = Math.max(0, rawStart);
                  const visibleEnd = Math.min(rangeDays, rawEnd);
                  const progress = task.status === "done" ? 100 : Math.max(0, Math.min(100, Number(task.progress) || 0));
                  if (visibleEnd <= 0 || visibleStart >= rangeDays) return <div className="gantt-row-empty" key={task.id} style={{ top: index * ROW_HEIGHT, width: timelineWidth }}><span>Задача вне выбранного периода</span></div>;
                  return <button key={task.id} className={`gantt-bar status-${task.status} priority-${task.priority}`} style={{ top: index * ROW_HEIGHT + 15, left: visibleStart * dayWidth + 4, width: Math.max(dayWidth * .65, (visibleEnd - visibleStart) * dayWidth - 8), "--bar-color": projectColor }} onClick={() => onOpenTask(task)} title={`${task.title}: ${shortDate(start)} — ${shortDate(end)}`}><span style={{ width: `${progress}%` }} /><strong>{progress}%</strong></button>;
                })}
              </div>
            </div>
          </div>
        </div>
      ) : <div className="gantt-empty"><CalendarDays size={28} /><strong>Для диаграммы нужны даты</strong><p>Укажите начало или срок хотя бы у одной задачи.</p>{canEdit && <button onClick={() => onAddDates(tasks[0])}><Plus size={16} /> Открыть задачу</button>}</div>}

      {unscheduledTasks.length > 0 && <div className="gantt-unscheduled"><div><span className="section-kicker">Вне графика</span><strong>{unscheduledTasks.length} {plural(unscheduledTasks.length, "задача без дат", "задачи без дат", "задач без дат")}</strong></div><div>{unscheduledTasks.slice(0, 4).map((task) => <button key={task.id} onClick={() => onOpenTask(task)}>{task.title}<Plus size={14} /></button>)}</div></div>}
    </section>
  );
}
