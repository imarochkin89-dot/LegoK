"use client";

import { Banknote, CheckCircle2, CircleAlert, Download, ReceiptRussianRuble, Settings2, TrendingUp, WalletCards } from "lucide-react";

export const costCategories = {
  equipment: { label: "Оборудование", color: "#ea6a34" },
  services: { label: "Работы и услуги", color: "#2a8a68" },
  software: { label: "ПО и лицензии", color: "#5c6bc0" },
  logistics: { label: "Доставка", color: "#b45175" },
  other: { label: "Прочее", color: "#8b6c42" },
};

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function money(value, compact = false) {
  return new Intl.NumberFormat("ru-RU", compact && Math.abs(value) >= 100000
    ? { style: "currency", currency: "RUB", notation: "compact", maximumFractionDigits: 1 }
    : { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value || 0);
}

function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (symbol) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[symbol]);
}

export default function BudgetPanel({ project, tasks, projectColor, canEdit, onOpenTask, onOpenProjectSettings }) {
  const budget = number(project?.budget);
  const planned = tasks.reduce((sum, task) => sum + number(task.plannedCost), 0);
  const actual = tasks.reduce((sum, task) => sum + number(task.actualCost), 0);
  const forecast = tasks.reduce((sum, task) => sum + (task.status === "done" ? number(task.actualCost) : Math.max(number(task.plannedCost), number(task.actualCost))), 0);
  const remaining = budget - actual;
  const forecastRemaining = budget - forecast;
  const usage = budget ? Math.min(100, Math.round(actual / budget * 100)) : 0;
  const plannedCoverage = budget ? Math.round(planned / budget * 100) : 0;
  const overrunTasks = tasks.filter((task) => number(task.actualCost) > number(task.plannedCost) && number(task.actualCost) > 0);
  const unplannedActual = tasks.filter((task) => !number(task.plannedCost) && number(task.actualCost)).reduce((sum, task) => sum + number(task.actualCost), 0);

  const categories = Object.entries(costCategories).map(([id, category]) => {
    const categoryTasks = tasks.filter((task) => (task.costCategory || "other") === id);
    return {
      id,
      ...category,
      planned: categoryTasks.reduce((sum, task) => sum + number(task.plannedCost), 0),
      actual: categoryTasks.reduce((sum, task) => sum + number(task.actualCost), 0),
      count: categoryTasks.length,
    };
  }).filter((category) => category.count || category.planned || category.actual);
  const categoryMax = Math.max(1, ...categories.flatMap((category) => [category.planned, category.actual]));
  const taskRows = tasks.slice().sort((left, right) => Math.max(number(right.plannedCost), number(right.actualCost)) - Math.max(number(left.plannedCost), number(left.actualCost)));

  function exportBudget() {
    const rows = taskRows.map((task) => {
      const plan = number(task.plannedCost);
      const fact = number(task.actualCost);
      return `<tr><td>${htmlEscape(task.title)}</td><td>${htmlEscape(costCategories[task.costCategory || "other"]?.label || "Прочее")}</td><td>${plan}</td><td>${fact}</td><td>${plan - fact}</td><td>${task.status === "done" ? "Готово" : task.status === "progress" ? "В работе" : "К выполнению"}</td></tr>`;
    }).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><table border="1"><tr><th colspan="6">Бюджет проекта: ${htmlEscape(project?.name)}</th></tr><tr><td>Лимит</td><td>${budget}</td><td>План</td><td>${planned}</td><td>Факт</td><td>${actual}</td></tr><tr><th>Задача</th><th>Категория</th><th>План</th><th>Факт</th><th>Отклонение</th><th>Статус</th></tr>${rows}</table></body></html>`;
    const url = URL.createObjectURL(new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `budget-${new Date().toISOString().slice(0, 10)}.xls`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const status = !budget ? "setup" : forecastRemaining < 0 ? "risk" : forecastRemaining < budget * .1 ? "attention" : "calm";

  return (
    <section className="budget-panel" aria-label="Бюджет проекта">
      <header className="budget-header">
        <div><span className="section-kicker">Финансовый контроль</span><h2>Бюджет проекта</h2><p>План, фактические расходы и прогноз по всем задачам.</p></div>
        <div className="budget-controls"><button onClick={exportBudget}><Download size={15} /> Экспорт</button>{canEdit && <button className="budget-settings" onClick={onOpenProjectSettings}><Settings2 size={15} /> Лимит бюджета</button>}</div>
      </header>

      <div className="budget-kpis">
        <article><span className="budget-kpi-icon ink"><WalletCards size={18} /></span><div><strong>{money(budget, true)}</strong><span>Общий лимит</span></div><em>{budget ? "Установлен в проекте" : "Нужно установить"}</em></article>
        <article><span className="budget-kpi-icon orange"><ReceiptRussianRuble size={18} /></span><div><strong>{money(planned, true)}</strong><span>Запланировано</span></div><em>{plannedCoverage}% от лимита</em></article>
        <article><span className="budget-kpi-icon green"><Banknote size={18} /></span><div><strong>{money(actual, true)}</strong><span>Потрачено</span></div><em>{usage}% бюджета</em></article>
        <article className={forecastRemaining < 0 ? "is-risk" : ""}><span className={`budget-kpi-icon ${forecastRemaining < 0 ? "red" : "blue"}`}><TrendingUp size={18} /></span><div><strong>{money(forecast, true)}</strong><span>Прогноз итога</span></div><em>{forecastRemaining < 0 ? `Перерасход ${money(Math.abs(forecastRemaining), true)}` : `Резерв ${money(forecastRemaining, true)}`}</em></article>
      </div>

      <div className={`budget-health budget-${status}`}>
        <div className="budget-donut" style={{ "--budget-progress": `${usage * 3.6}deg`, "--budget-color": projectColor }}><div><strong>{usage}%</strong><span>освоено</span></div></div>
        <div className="budget-health-copy"><span className="section-kicker">Состояние бюджета</span><h3>{status === "setup" ? "Установите лимит проекта" : status === "risk" ? "Прогноз выше бюджета" : status === "attention" ? "Резерв почти исчерпан" : "Расходы под контролем"}</h3><p>{status === "setup" ? "После установки лимита появятся остаток и контроль прогноза." : `Остаток по факту ${money(remaining)} · прогнозный остаток ${money(forecastRemaining)}`}</p><div className="budget-track"><span style={{ width: `${usage}%`, background: projectColor }} /></div></div>
        <div className="budget-health-risk">{status === "risk" ? <CircleAlert size={20} /> : <CheckCircle2 size={20} />}<div><strong>{overrunTasks.length} задач с перерасходом</strong><span>{unplannedActual ? `${money(unplannedActual)} вне плана` : "Незапланированных расходов нет"}</span></div></div>
      </div>

      <div className="budget-grid">
        <section className="budget-card budget-categories"><div className="budget-card-head"><div><span className="section-kicker">Структура затрат</span><h3>По категориям</h3></div><span>План / факт</span></div>{categories.length ? <div className="budget-category-list">{categories.map((category) => <div key={category.id}><div className="budget-category-row"><i style={{ background: category.color }} /><strong>{category.label}</strong><span>{money(category.actual)} / {money(category.planned)}</span></div><div className="budget-category-bars"><span className="planned" style={{ width: `${category.planned / categoryMax * 100}%`, "--category-color": category.color }} /><span className="actual" style={{ width: `${category.actual / categoryMax * 100}%`, "--category-color": category.color }} /></div></div>)}</div> : <div className="budget-empty">Добавьте расходы в карточки задач.</div>}</section>

        <section className="budget-card budget-insights"><div className="budget-card-head"><div><span className="section-kicker">Контроль</span><h3>Финансовые сигналы</h3></div></div><div className="budget-signal-list"><div className={forecastRemaining < 0 ? "risk" : "ok"}>{forecastRemaining < 0 ? <CircleAlert size={17} /> : <CheckCircle2 size={17} />}<span><strong>Прогноз</strong><em>{forecastRemaining < 0 ? `Выше лимита на ${money(Math.abs(forecastRemaining))}` : `В пределах лимита, резерв ${money(forecastRemaining)}`}</em></span></div><div className={overrunTasks.length ? "warn" : "ok"}>{overrunTasks.length ? <CircleAlert size={17} /> : <CheckCircle2 size={17} />}<span><strong>Отклонения по задачам</strong><em>{overrunTasks.length ? `${overrunTasks.length} требуют проверки` : "Перерасхода не обнаружено"}</em></span></div><div className={unplannedActual ? "warn" : "ok"}>{unplannedActual ? <CircleAlert size={17} /> : <CheckCircle2 size={17} />}<span><strong>Расходы без плана</strong><em>{unplannedActual ? money(unplannedActual) : "Все траты имеют план"}</em></span></div></div></section>
      </div>

      <section className="budget-card budget-table-card">
        <div className="budget-card-head"><div><span className="section-kicker">Детализация</span><h3>Бюджет по задачам</h3></div><span>{taskRows.length} задач</span></div>
        <div className="budget-table-wrap"><table><thead><tr><th>Задача</th><th>Категория</th><th>План</th><th>Факт</th><th>Отклонение</th><th>Исполнение</th></tr></thead><tbody>{taskRows.map((task) => { const plan = number(task.plannedCost); const fact = number(task.actualCost); const variance = plan - fact; const ratio = plan ? Math.min(100, Math.round(fact / plan * 100)) : fact ? 100 : 0; return <tr key={task.id} onClick={() => onOpenTask(task)} tabIndex="0" onKeyDown={(event) => { if (event.key === "Enter") onOpenTask(task); }}><td><span className={`budget-task-dot ${task.status}`} /><strong>{task.title}</strong></td><td><span className="budget-category-chip"><i style={{ background: costCategories[task.costCategory || "other"]?.color }} />{costCategories[task.costCategory || "other"]?.label || "Прочее"}</span></td><td>{money(plan)}</td><td className={fact > plan && fact ? "budget-over" : ""}>{money(fact)}</td><td className={variance < 0 ? "budget-over" : "budget-under"}>{variance < 0 ? "−" : "+"}{money(Math.abs(variance))}</td><td><div className="budget-task-progress"><span style={{ width: `${ratio}%`, background: fact > plan && fact ? "var(--red)" : projectColor }} /></div><em>{ratio}%</em></td></tr>; })}</tbody></table></div>
      </section>
    </section>
  );
}
