"use client";

import { useMemo, useState } from "react";
import {
  BarChart3, CalendarRange, CheckCircle2, CircleAlert, Clock3, FileSpreadsheet,
  History, Printer, RefreshCw, TrendingUp,
} from "lucide-react";

const periods = {
  7: "7 дней",
  30: "30 дней",
  90: "90 дней",
  all: "Всё время",
};

function localISO(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function progressOf(task) {
  if (!task.subtasks?.length) return Math.min(100, Math.max(0, Number(task.progress) || 0));
  return Math.round((task.subtasks.filter((item) => item.done).length / task.subtasks.length) * 100);
}

function dateState(due, done = false) {
  if (!due) return "noDue";
  if (done) return "done";
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((new Date(`${due}T12:00:00`) - today) / 86400000);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 3) return "soon";
  return "planned";
}

function periodStart(period) {
  if (period === "all") return null;
  const start = new Date();
  start.setDate(start.getDate() - Number(period));
  return start;
}

function formatMoment(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDay(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (symbol) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[symbol]);
}

function downloadBlob(contents, type, filename) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ProgressTrend({ points }) {
  const width = 680;
  const height = 210;
  const left = 42;
  const right = 18;
  const top = 20;
  const bottom = 34;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const safePoints = points.length ? points : [{ day: localISO(), progress: 0, overdue: 0 }];
  const coordinates = safePoints.map((point, index) => ({
    ...point,
    x: left + (safePoints.length === 1 ? innerWidth / 2 : (index / (safePoints.length - 1)) * innerWidth),
    y: top + innerHeight - (point.progress / 100) * innerHeight,
  }));
  const path = coordinates.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  return (
    <div className="trend-chart" role="img" aria-label="Динамика среднего прогресса">
      <svg viewBox={`0 0 ${width} ${height}`}>
        {[0, 25, 50, 75, 100].map((value) => {
          const y = top + innerHeight - (value / 100) * innerHeight;
          return <g key={value}><line x1={left} y1={y} x2={width - right} y2={y} /><text x={left - 10} y={y + 4} textAnchor="end">{value}%</text></g>;
        })}
        <path className="trend-area" d={`${path} L${coordinates.at(-1).x},${top + innerHeight} L${coordinates[0].x},${top + innerHeight} Z`} />
        <path className="trend-line" d={path} />
        {coordinates.map((point) => <circle key={`${point.day}-${point.x}`} cx={point.x} cy={point.y} r="4"><title>{formatDay(point.day)}: {point.progress}%</title></circle>)}
        <text className="trend-date" x={left} y={height - 8}>{formatDay(safePoints[0].day)}</text>
        <text className="trend-date" x={width - right} y={height - 8} textAnchor="end">{formatDay(safePoints.at(-1).day)}</text>
      </svg>
    </div>
  );
}

function DistributionBars({ rows, total }) {
  const safeTotal = Math.max(1, total);
  return <div className="distribution-bars">{rows.map((row) => <div key={row.key}><div><span><i className={`bar-dot ${row.key}`} />{row.label}</span><strong>{row.value}</strong></div><span className="bar-track"><span className={`bar-fill ${row.key}`} style={{ width: `${Math.max(row.value ? 4 : 0, (row.value / safeTotal) * 100)}%` }} /></span></div>)}</div>;
}

export default function ReportsPanel({ projects, reportData, reportStatus, onReload }) {
  const [scope, setScope] = useState("all");
  const [period, setPeriod] = useState("30");
  const scopedProjects = useMemo(() => scope === "all" ? projects : projects.filter((project) => project.id === scope), [projects, scope]);
  const scopedTasks = useMemo(() => scopedProjects.flatMap((project) => (project.tasks || []).map((task) => ({ ...task, projectId: project.id, projectName: project.name }))), [scopedProjects]);
  const cutoff = periodStart(period);

  const summary = useMemo(() => {
    const total = scopedTasks.length;
    const done = scopedTasks.filter((task) => task.status === "done").length;
    const progress = scopedTasks.filter((task) => task.status === "progress").length;
    const todo = total - done - progress;
    const overdue = scopedTasks.filter((task) => dateState(task.due, task.status === "done") === "overdue").length;
    const today = scopedTasks.filter((task) => dateState(task.due, task.status === "done") === "today").length;
    const soon = scopedTasks.filter((task) => dateState(task.due, task.status === "done") === "soon").length;
    const planned = scopedTasks.filter((task) => dateState(task.due, task.status === "done") === "planned").length;
    const noDue = scopedTasks.filter((task) => !task.due && task.status !== "done").length;
    const average = total ? Math.round(scopedTasks.reduce((sum, task) => sum + progressOf(task), 0) / total) : 0;
    const measured = scopedTasks.filter((task) => task.status === "done" && task.due && task.completedAt);
    const onTime = measured.filter((task) => task.completedAt.slice(0, 10) <= task.due).length;
    const compliance = measured.length ? Math.round((onTime / measured.length) * 100) : null;
    return { total, done, progress, todo, overdue, today, soon, planned, noDue, average, measured: measured.length, onTime, compliance };
  }, [scopedTasks]);

  const projectRows = useMemo(() => scopedProjects.map((project) => {
    const tasks = project.tasks || [];
    const done = tasks.filter((task) => task.status === "done").length;
    const overdue = tasks.filter((task) => dateState(task.due, task.status === "done") === "overdue").length;
    const average = tasks.length ? Math.round(tasks.reduce((sum, task) => sum + progressOf(task), 0) / tasks.length) : 0;
    const nextDue = tasks.filter((task) => task.status !== "done" && task.due).map((task) => task.due).sort()[0] || null;
    return { id: project.id, name: project.name, color: project.color, total: tasks.length, done, overdue, average, nextDue };
  }), [scopedProjects]);

  const events = useMemo(() => (reportData.events || []).filter((item) => {
    if (scope !== "all" && item.project_id !== scope) return false;
    return !cutoff || new Date(item.created_at) >= cutoff;
  }), [reportData.events, scope, period]);

  const trend = useMemo(() => {
    const snapshots = (reportData.snapshots || []).filter((item) => {
      if (scope !== "all" && item.project_id !== scope) return false;
      return !cutoff || new Date(item.captured_at) >= cutoff;
    });
    const latestByDayProject = new Map();
    for (const item of snapshots) latestByDayProject.set(`${item.captured_at.slice(0, 10)}:${item.project_id}`, item);
    const grouped = new Map();
    for (const item of latestByDayProject.values()) {
      const day = item.captured_at.slice(0, 10);
      if (!grouped.has(day)) grouped.set(day, []);
      grouped.get(day).push(item);
    }
    const points = [...grouped.entries()].map(([day, rows]) => {
      const total = rows.reduce((sum, row) => sum + Number(row.total_tasks), 0);
      const weighted = rows.reduce((sum, row) => sum + Number(row.average_progress) * Math.max(1, Number(row.total_tasks)), 0);
      return { day, progress: Math.round(weighted / Math.max(1, total || rows.length)), overdue: rows.reduce((sum, row) => sum + Number(row.overdue_tasks), 0) };
    }).sort((a, b) => a.day.localeCompare(b.day));
    return points.length ? points.slice(-30) : [{ day: localISO(), progress: summary.average, overdue: summary.overdue }];
  }, [reportData.snapshots, scope, period, summary.average, summary.overdue]);

  const statusRows = [
    { key: "done", label: "Завершено", value: summary.done },
    { key: "progress", label: "В работе", value: summary.progress },
    { key: "todo", label: "К выполнению", value: summary.todo },
  ];
  const deadlineRows = [
    { key: "overdue", label: "Просрочено", value: summary.overdue },
    { key: "today", label: "Сегодня", value: summary.today },
    { key: "soon", label: "Ближайшие 3 дня", value: summary.soon },
    { key: "planned", label: "Запланировано", value: summary.planned },
    { key: "noDue", label: "Без срока", value: summary.noDue },
  ];

  function exportExcel() {
    const generated = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" }).format(new Date());
    const taskRows = scopedTasks.map((task) => `<tr><td>${escapeHtml(task.projectName)}</td><td>${escapeHtml(task.title)}</td><td>${escapeHtml(task.status)}</td><td>${escapeHtml(task.priority)}</td><td>${escapeHtml(task.due || "Без срока")}</td><td>${progressOf(task)}%</td></tr>`).join("");
    const projectTable = projectRows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.total}</td><td>${row.done}</td><td>${row.overdue}</td><td>${row.average}%</td><td>${escapeHtml(row.nextDue || "—")}</td></tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial}h1{font-size:22px}table{border-collapse:collapse;margin:12px 0 28px;width:100%}th,td{border:1px solid #bbb;padding:7px;text-align:left}th{background:#eee}</style></head><body><h1>Отчёт по проектам</h1><p>Сформирован: ${escapeHtml(generated)}</p><h2>Сводка</h2><table><tr><th>Задач</th><th>Завершено</th><th>Средний прогресс</th><th>Просрочено</th><th>Соблюдение сроков</th></tr><tr><td>${summary.total}</td><td>${summary.done}</td><td>${summary.average}%</td><td>${summary.overdue}</td><td>${summary.compliance === null ? "Недостаточно данных" : `${summary.compliance}%`}</td></tr></table><h2>Проекты</h2><table><tr><th>Проект</th><th>Задач</th><th>Завершено</th><th>Просрочено</th><th>Прогресс</th><th>Ближайший срок</th></tr>${projectTable}</table><h2>Задачи</h2><table><tr><th>Проект</th><th>Задача</th><th>Статус</th><th>Приоритет</th><th>Срок</th><th>Прогресс</th></tr>${taskRows}</table></body></html>`;
    downloadBlob(`\ufeff${html}`, "application/vnd.ms-excel;charset=utf-8", `kontur-report-${localISO()}.xls`);
  }

  return (
    <section className="reports-panel">
      <div className="report-header">
        <div><span className="section-kicker">Управленческая сводка</span><h2>Отчётность по проектам</h2><p>Текущее состояние, соблюдение сроков и история изменений из D1.</p></div>
        <div className="report-controls">
          <label><span>Проект</span><select value={scope} onChange={(event) => setScope(event.target.value)}><option value="all">Все проекты</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label><span>Период истории</span><select value={period} onChange={(event) => setPeriod(event.target.value)}>{Object.entries(periods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <button onClick={exportExcel}><FileSpreadsheet size={16} /> Excel</button>
          <button onClick={() => window.print()}><Printer size={16} /> PDF</button>
        </div>
      </div>

      <div className="report-kpis">
        <article><span className="report-kpi-icon green"><CheckCircle2 size={18} /></span><div><strong>{summary.done}/{summary.total}</strong><span>задач завершено</span></div><em>{summary.total ? Math.round((summary.done / summary.total) * 100) : 0}%</em></article>
        <article><span className="report-kpi-icon orange"><TrendingUp size={18} /></span><div><strong>{summary.average}%</strong><span>средний прогресс</span></div><em>сейчас</em></article>
        <article className={summary.overdue ? "risk" : ""}><span className="report-kpi-icon red"><CircleAlert size={18} /></span><div><strong>{summary.overdue}</strong><span>просрочено</span></div><em>{summary.today} сегодня</em></article>
        <article><span className="report-kpi-icon blue"><CalendarRange size={18} /></span><div><strong>{summary.compliance === null ? "—" : `${summary.compliance}%`}</strong><span>выполнено в срок</span></div><em>{summary.measured ? `${summary.onTime} из ${summary.measured}` : "с новых задач"}</em></article>
      </div>

      <div className="report-grid">
        <article className="report-card report-trend-card">
          <div className="report-card-head"><div><span className="section-kicker">Динамика</span><h3>Средний прогресс</h3></div><span><TrendingUp size={16} /> {trend.at(-1)?.progress || 0}%</span></div>
          <ProgressTrend points={trend} />
          <p className="report-note">История формируется по снимкам D1 после каждого изменения задач.</p>
        </article>

        <article className="report-card">
          <div className="report-card-head"><div><span className="section-kicker">Статусы</span><h3>Распределение задач</h3></div><BarChart3 size={18} /></div>
          <DistributionBars rows={statusRows} total={summary.total} />
        </article>

        <article className="report-card">
          <div className="report-card-head"><div><span className="section-kicker">Сроки</span><h3>Контроль дедлайнов</h3></div><Clock3 size={18} /></div>
          <DistributionBars rows={deadlineRows} total={Math.max(1, summary.total - summary.done)} />
        </article>

        <article className="report-card report-projects-card">
          <div className="report-card-head"><div><span className="section-kicker">Сравнение</span><h3>Проекты</h3></div><span>{projectRows.length}</span></div>
          <div className="report-table-wrap"><table><thead><tr><th>Проект</th><th>Задачи</th><th>Готово</th><th>Прогресс</th><th>Просрочено</th><th>Ближайший срок</th></tr></thead><tbody>{projectRows.map((row) => <tr key={row.id}><td><span className="project-cell"><i style={{ background: row.color }} />{row.name}</span></td><td>{row.total}</td><td>{row.done}</td><td><span className="table-progress"><span style={{ width: `${row.average}%`, background: row.color }} /></span><strong>{row.average}%</strong></td><td className={row.overdue ? "table-risk" : ""}>{row.overdue}</td><td>{formatDay(row.nextDue)}</td></tr>)}</tbody></table></div>
        </article>

        <article className="report-card report-activity-card">
          <div className="report-card-head"><div><span className="section-kicker">D1 журнал</span><h3>Последние изменения</h3></div><button className="report-refresh" onClick={onReload} disabled={reportStatus === "loading"}><RefreshCw className={reportStatus === "loading" ? "spin" : ""} size={15} /></button></div>
          {reportStatus === "error" ? <div className="report-empty"><CircleAlert size={20} /><span>История временно недоступна</span><button onClick={onReload}>Повторить</button></div> : events.length ? <div className="activity-list">{events.slice(0, 12).map((item) => <div key={item.id}><span className={`activity-icon ${item.event_type}`}><History size={13} /></span><div><strong>{item.label}</strong><span>{item.actor_name ? `${item.actor_name} · ` : ""}{formatMoment(item.created_at)}</span></div></div>)}</div> : <div className="report-empty"><History size={22} /><span>История начнёт заполняться после следующего изменения задачи.</span></div>}
        </article>
      </div>
    </section>
  );
}
