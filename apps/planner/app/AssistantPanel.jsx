"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, BotMessageSquare, BrainCircuit, CalendarClock,
  CheckCircle2, Clock3, Coins, Lightbulb, ListChecks, LockKeyhole, Send,
  ShieldAlert, Sparkles, Trash2, TrendingUp, Users, WalletCards,
} from "lucide-react";

const promptOptions = [
  { id: "summary", label: "Сводка проекта", prompt: "Дай краткую сводку по проекту" },
  { id: "deadlines", label: "Что горит?", prompt: "Какие сроки сейчас требуют внимания?" },
  { id: "plan", label: "План на неделю", prompt: "Составь план действий на ближайшую неделю" },
  { id: "risks", label: "Разбор рисков", prompt: "Какие риски наиболее критичны?" },
  { id: "budget", label: "Бюджет", prompt: "Оцени состояние бюджета проекта" },
  { id: "resources", label: "Оборудование", prompt: "Что происходит с оборудованием и ресурсами?" },
  { id: "team", label: "Загрузка команды", prompt: "Где есть перегрузка или неназначенные задачи?" },
];

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysFromToday(value) {
  if (!value) return null;
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return Math.round((new Date(`${value}T12:00:00`) - now) / 86400000);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatHours(minutes) {
  const hours = Math.round((Number(minutes) || 0) / 6) / 10;
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(hours)} ч`;
}

function pluralize(value, one, few, many) {
  const number = Math.abs(Number(value) || 0);
  const lastTwo = number % 100;
  const last = number % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function formatMessageTime(value) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function analyzeProject(project, members) {
  const tasks = project?.tasks || [];
  const openTasks = tasks.filter((task) => task.status !== "done");
  const doneTasks = tasks.filter((task) => task.status === "done");
  const overdue = openTasks.filter((task) => daysFromToday(task.due) != null && daysFromToday(task.due) < 0).sort((a, b) => (a.due || "").localeCompare(b.due || ""));
  const dueSoon = openTasks.filter((task) => { const days = daysFromToday(task.due); return days != null && days >= 0 && days <= 3; }).sort((a, b) => a.due.localeCompare(b.due));
  const risks = (project?.risks || []).filter((risk) => !["closed", "mitigated"].includes(risk.status));
  const criticalRisks = [...risks].filter((risk) => Number(risk.probability) * Number(risk.impact) >= 12).sort((a, b) => Number(b.probability) * Number(b.impact) - Number(a.probability) * Number(a.impact));
  const plannedCost = tasks.reduce((sum, task) => sum + (Number(task.plannedCost) || 0), 0);
  const actualCost = tasks.reduce((sum, task) => sum + (Number(task.actualCost) || 0), 0);
  const budget = Number(project?.budget) || plannedCost;
  const plannedHours = tasks.reduce((sum, task) => sum + (Number(task.effortHours) || 0), 0);
  const loggedMinutes = (project?.timeEntries || []).reduce((sum, entry) => sum + (Number(entry.minutes) || 0), 0);
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartIso = isoDate(weekStart);
  const weekMinutes = (project?.timeEntries || []).filter((entry) => entry.date >= weekStartIso).reduce((sum, entry) => sum + (Number(entry.minutes) || 0), 0);
  const unassigned = openTasks.filter((task) => !task.assigneeKey);
  const incompleteIds = new Set(openTasks.map((task) => task.id));
  const blocked = openTasks.filter((task) => (task.dependsOn || []).some((id) => incompleteIds.has(id)));
  const priorityRank = { high: 0, medium: 1, low: 2 };
  const focusTasks = [...openTasks].sort((a, b) => {
    const aUrgency = daysFromToday(a.due) ?? 999;
    const bUrgency = daysFromToday(b.due) ?? 999;
    return Math.min(aUrgency, 10) - Math.min(bUrgency, 10) || priorityRank[a.priority] - priorityRank[b.priority];
  }).slice(0, 4);
  const memberNames = new Map((members || []).map((member) => [member.member_key, member.display_name]));
  const loadRows = [...memberNames.entries()].map(([key, name]) => ({ key, name, hours: openTasks.filter((task) => task.assigneeKey === key).reduce((sum, task) => sum + (Number(task.effortHours) || 0), 0) })).sort((a, b) => b.hours - a.hours);
  const completion = tasks.length ? Math.round((doneTasks.length / tasks.length) * 100) : 0;
  const resources = project?.resources || [];
  const resourceUnits = resources.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const installedResources = resources.filter((item) => item.status === "installed").reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const pendingResources = resources.filter((item) => ["planned", "ordered"].includes(item.status));
  const availableResources = resources.filter((item) => item.status === "in_stock").reduce((sum, item) => sum + Math.max(0, (Number(item.quantity) || 0) - (Number(item.reserved) || 0)), 0);
  const resourceValue = resources.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitCost) || 0), 0);
  return { tasks, openTasks, doneTasks, overdue, dueSoon, risks, criticalRisks, plannedCost, actualCost, budget, plannedHours, loggedMinutes, weekMinutes, unassigned, blocked, focusTasks, loadRows, completion, resources, resourceUnits, installedResources, pendingResources, availableResources, resourceValue };
}

function answerFor(question, project, members) {
  const data = analyzeProject(project, members);
  const text = question.toLowerCase();
  const createdAt = new Date().toISOString();
  const base = { id: `assistant-${Date.now()}`, role: "assistant", createdAt, taskIds: [], navigation: "" };
  if (/срок|горит|просроч|дедлайн/.test(text)) {
    const bullets = [
      data.overdue.length ? `${data.overdue.length} просроченных задач — начать с «${data.overdue[0].title}».` : "Просроченных задач нет.",
      data.dueSoon.length ? `${data.dueSoon.length} задач со сроком в ближайшие 3 дня.` : "На ближайшие 3 дня критичных сроков нет.",
      data.blocked.length ? `${data.blocked.length} задач зависят от незавершённых предшественников.` : "Блокирующих зависимостей не обнаружено.",
    ];
    return { ...base, title: "Контроль сроков", body: data.overdue.length ? "Есть задачи, которым нужно внимание сегодня." : "Сроки проекта выглядят управляемо.", bullets, taskIds: [...data.overdue, ...data.dueSoon].slice(0, 3).map((task) => task.id), navigation: "gantt" };
  }
  if (/риск|проблем/.test(text)) {
    const top = data.criticalRisks[0];
    return { ...base, title: "Оценка рисков", body: top ? `Главный фокус — «${top.title}» с оценкой ${Number(top.probability) * Number(top.impact)} из 25.` : "Критических открытых рисков сейчас нет.", bullets: top ? [top.mitigation || "Добавьте план снижения риска.", `${data.risks.length} открытых рисков и проблем в реестре.`, `${data.criticalRisks.length} записей с высокой оценкой.`] : ["Продолжайте еженедельный пересмотр реестра.", "Проверяйте риски перед изменением сроков и бюджета."], taskIds: top?.taskId ? [top.taskId] : [], navigation: "risks" };
  }
  if (/бюдж|стоим|расход|деньг/.test(text)) {
    const remaining = data.budget - data.actualCost;
    const percent = data.budget ? Math.round((data.actualCost / data.budget) * 100) : 0;
    return { ...base, title: "Состояние бюджета", body: `Освоено ${percent}% лимита: ${formatCurrency(data.actualCost)} из ${formatCurrency(data.budget)}.`, bullets: [remaining >= 0 ? `Остаток резерва — ${formatCurrency(remaining)}.` : `Перерасход — ${formatCurrency(Math.abs(remaining))}.`, `План по задачам — ${formatCurrency(data.plannedCost)}.`, data.actualCost > data.plannedCost ? "Факт выше плановой стоимости задач — требуется сверка." : "Фактические расходы не превышают план по задачам."], navigation: "budget" };
  }
  if (/оборуд|ресурс|лиценз|гарант|склад|поставк/.test(text)) {
    return { ...base, title: "Оборудование и ресурсы", body: `В реестре ${data.resources.length} ${pluralize(data.resources.length, "позиция", "позиции", "позиций")} — всего ${data.resourceUnits} ${pluralize(data.resourceUnits, "единица", "единицы", "единиц")}.`, bullets: [`Установлено и введено в работу: ${data.installedResources} ${pluralize(data.installedResources, "единица", "единицы", "единиц")}.`, `Ожидают закупки или поставки: ${data.pendingResources.length} ${pluralize(data.pendingResources.length, "позиция", "позиции", "позиций")}.`, `Свободно на складе: ${data.availableResources} ${pluralize(data.availableResources, "единица", "единицы", "единиц")}.`, `Учётная стоимость реестра — ${formatCurrency(data.resourceValue)}.`], taskIds: data.pendingResources.filter((item) => item.taskId).slice(0, 3).map((item) => item.taskId), navigation: "resources" };
  }
  if (/команд|загруз|исполн|назнач/.test(text)) {
    const top = data.loadRows[0];
    return { ...base, title: "Загрузка команды", body: data.unassigned.length ? `${data.unassigned.length} открытых задач пока без исполнителя.` : "Все открытые задачи распределены между участниками.", bullets: [top ? `Максимальная плановая загрузка: ${top.name} — ${top.hours} ч.` : "Для оценки загрузки назначьте исполнителей.", data.blocked.length ? `${data.blocked.length} задач ожидают завершения предшественников.` : "Блокирующих зависимостей нет.", "Сначала назначьте владельцев высокоприоритетным задачам."], taskIds: data.unassigned.slice(0, 3).map((task) => task.id), navigation: "workload" };
  }
  if (/врем|час|трудозат|таймер/.test(text)) {
    const percent = data.plannedHours ? Math.round((data.loggedMinutes / 60 / data.plannedHours) * 100) : 0;
    return { ...base, title: "Трудозатраты", body: `Зафиксировано ${formatHours(data.loggedMinutes)} из ${data.plannedHours} плановых часов (${percent}%).`, bullets: [`За последние 7 дней внесено ${formatHours(data.weekMinutes)}.`, `${Object.keys(project?.activeTimers || {}).length} активных таймеров прямо сейчас.`, "Сверьте задачи без записей времени перед еженедельным отчётом."], navigation: "time" };
  }
  if (/план|недел|что делать|следующ|приоритет/.test(text)) {
    const focus = data.focusTasks;
    return { ...base, title: "План на ближайшую неделю", body: focus.length ? "Предлагаю сосредоточиться на четырёх действиях." : "Открытых задач нет — можно перейти к закрытию проекта.", bullets: focus.length ? focus.map((task, index) => `${index + 1}. ${task.title}${task.due ? ` · срок ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(`${task.due}T12:00:00`))}` : ""}`) : ["Подготовьте итоговый отчёт.", "Зафиксируйте результаты и выводы."], taskIds: focus.map((task) => task.id), navigation: "board" };
  }
  const attention = data.overdue.length + data.dueSoon.length + data.criticalRisks.length;
  return { ...base, title: "Сводка проекта", body: `Готовность по задачам — ${data.completion}%. В работе остаётся ${data.openTasks.length}, завершено ${data.doneTasks.length}.`, bullets: [attention ? `${attention} пунктов требуют внимания по срокам и рискам.` : "Критичных отклонений по срокам и рискам нет.", `Бюджет освоен на ${data.budget ? Math.round((data.actualCost / data.budget) * 100) : 0}%.`, `Учтено ${formatHours(data.loggedMinutes)} фактических трудозатрат.`, data.unassigned.length ? `${data.unassigned.length} задач без исполнителя.` : "Все открытые задачи распределены."], taskIds: data.focusTasks.slice(0, 2).map((task) => task.id), navigation: "reports" };
}

export default function AssistantPanel({ project, members, actor, canEdit, onChangeMessages, onOpenTask, onNavigate }) {
  const messages = Array.isArray(project?.assistantMessages) ? project.assistantMessages : [];
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const analysis = useMemo(() => analyzeProject(project, members), [project, members]);
  const taskById = useMemo(() => new Map((project?.tasks || []).map((task) => [task.id, task])), [project?.tasks]);
  const firstName = (actor?.name || "Иван").split(" ")[0];
  const attentionItems = [
    ...analysis.overdue.map((task) => ({ task, tone: "danger", label: "Просрочено" })),
    ...analysis.dueSoon.map((task) => ({ task, tone: "warning", label: "Скоро срок" })),
    ...analysis.criticalRisks.map((risk) => ({ task: taskById.get(risk.taskId), tone: "danger", label: "Связан критичный риск" })),
    ...analysis.unassigned.map((task) => ({ task, tone: "muted", label: "Без исполнителя" })),
  ].filter((item) => item.task).filter((item, index, all) => all.findIndex((entry) => entry.task.id === item.task.id) === index).slice(0, 5);

  function ask(value) {
    const question = String(value || input).trim().slice(0, 500);
    if (!question || thinking || !canEdit) return;
    const userMessage = { id: `user-${Date.now()}`, role: "user", body: question, createdAt: new Date().toISOString() };
    const baseMessages = [...messages, userMessage].slice(-49);
    onChangeMessages(baseMessages, "Вопрос добавлен в историю помощника");
    setInput("");
    setThinking(true);
    setTimeout(() => {
      const response = answerFor(question, project, members);
      onChangeMessages([...baseMessages, response].slice(-50), "AI-помощник подготовил ответ");
      setThinking(false);
    }, 480);
  }

  function submit(event) {
    event.preventDefault();
    ask(input);
  }

  function clearHistory() {
    if (!confirmClear) { setConfirmClear(true); return; }
    onChangeMessages([], "История AI-помощника очищена");
    setConfirmClear(false);
  }

  return (
    <section className="assistant-panel" aria-label="AI-помощник проекта">
      <header className="assistant-header">
        <div className="assistant-title-icon"><BrainCircuit size={25} /></div>
        <div><span className="section-kicker">Контекстный анализ проекта</span><h2>AI‑помощник</h2><p>Задавайте вопросы о сроках, рисках, бюджете, ресурсах, загрузке команды и трудозатратах.</p></div>
        <div className="assistant-private"><LockKeyhole size={15} /><span><strong>Приватный контекст</strong><em>данные остаются в рабочем пространстве</em></span></div>
      </header>

      <div className="assistant-snapshot">
        <article><ListChecks size={17} /><div><strong>{analysis.openTasks.length}</strong><span>Открытых задач</span></div></article>
        <article className={analysis.overdue.length ? "danger" : ""}><CalendarClock size={17} /><div><strong>{analysis.overdue.length}</strong><span>Просрочено</span></div></article>
        <article className={analysis.criticalRisks.length ? "warning" : ""}><ShieldAlert size={17} /><div><strong>{analysis.criticalRisks.length}</strong><span>Критичных рисков</span></div></article>
        <article><TrendingUp size={17} /><div><strong>{analysis.completion}%</strong><span>Готовность</span></div></article>
      </div>

      <div className="assistant-layout">
        <section className="assistant-chat-card">
          <div className="assistant-chat-head"><div><span className="assistant-live"><i /> Анализ обновляется с проектом</span><strong>{project?.name}</strong></div>{messages.length > 0 && canEdit && <button className={confirmClear ? "confirm" : ""} onClick={clearHistory} onBlur={() => setTimeout(() => setConfirmClear(false), 150)}><Trash2 size={14} />{confirmClear ? "Нажмите ещё раз" : "Очистить"}</button>}</div>
          <div className="assistant-messages" aria-live="polite">
            {!messages.length && <div className="assistant-welcome">
              <span className="assistant-orb"><BotMessageSquare size={27} /></span>
              <span className="section-kicker">Добрый день, {firstName}</span>
              <h3>С чего начнём?</h3>
              <p>Я уже проанализировал текущий проект. Выберите готовый вопрос или напишите свой.</p>
              <div className="assistant-prompt-grid">{promptOptions.slice(0, 4).map((item) => <button onClick={() => ask(item.prompt)} disabled={!canEdit} key={item.id}><Sparkles size={14} /><span><strong>{item.label}</strong><em>{item.prompt}</em></span><ArrowRight size={14} /></button>)}</div>
            </div>}
            {messages.map((message) => message.role === "user" ? <article className="assistant-message user" key={message.id}><div><strong>Вы</strong><time>{formatMessageTime(message.createdAt)}</time></div><p>{message.body}</p></article> : <article className="assistant-message ai" key={message.id}><span className="assistant-avatar"><BrainCircuit size={17} /></span><div className="assistant-answer"><div><strong>Контур AI</strong><time>{formatMessageTime(message.createdAt)}</time></div><h4>{message.title}</h4><p>{message.body}</p>{message.bullets?.length > 0 && <ul>{message.bullets.map((item, index) => <li key={`${message.id}-${index}`}>{item}</li>)}</ul>}<div className="assistant-answer-actions">{(message.taskIds || []).map((id) => { const task = taskById.get(id); return task ? <button onClick={() => onOpenTask(task)} key={id}><ListChecks size={13} />{task.title}</button> : null; })}{message.navigation && <button className="assistant-open-module" onClick={() => onNavigate(message.navigation)}>Открыть раздел <ArrowRight size={13} /></button>}</div></div></article>)}
            {thinking && <article className="assistant-message ai thinking"><span className="assistant-avatar"><BrainCircuit size={17} /></span><div className="assistant-answer"><div><strong>Контур AI</strong><span className="assistant-thinking-dots"><i /><i /><i /></span></div><p>Сопоставляю задачи, сроки и показатели проекта…</p></div></article>}
          </div>
          <div className="assistant-quick-prompts">{promptOptions.map((item) => <button onClick={() => ask(item.prompt)} disabled={thinking || !canEdit} key={item.id}>{item.label}</button>)}</div>
          <form className="assistant-composer" onSubmit={submit}><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(input); } }} placeholder={canEdit ? "Спросите о проекте…" : "Режим наблюдателя"} rows="2" maxLength="500" disabled={!canEdit} /><button type="submit" disabled={!input.trim() || thinking || !canEdit}><Send size={17} /><span>Отправить</span></button></form>
        </section>

        <aside className="assistant-sidebar">
          <section className="assistant-focus-card"><div><span className="section-kicker">Фокус</span><h3>Требует внимания</h3></div>{attentionItems.length ? <div className="assistant-focus-list">{attentionItems.map((item) => <button onClick={() => onOpenTask(item.task)} key={item.task.id}><span className={item.tone}>{item.tone === "danger" ? <AlertTriangle size={14} /> : item.tone === "warning" ? <Clock3 size={14} /> : <Users size={14} />}</span><div><strong>{item.task.title}</strong><em>{item.label}</em></div><ArrowRight size={14} /></button>)}</div> : <div className="assistant-all-clear"><CheckCircle2 size={24} /><strong>Критичных пунктов нет</strong><p>Проект не требует срочного вмешательства.</p></div>}</section>
          <section className="assistant-insight-card"><div className="assistant-insight-icon"><Lightbulb size={20} /></div><span className="section-kicker">Рекомендация</span><h3>{analysis.unassigned.length ? "Назначьте исполнителей" : analysis.overdue.length ? "Сначала закройте просрочки" : "Зафиксируйте недельный план"}</h3><p>{analysis.unassigned.length ? `${analysis.unassigned.length} задач пока остаются без ответственного.` : analysis.overdue.length ? `${analysis.overdue.length} задач уже вышли за плановый срок.` : "Сроки стабильны — удобно согласовать следующие контрольные точки."}</p><button onClick={() => ask(analysis.unassigned.length ? "Где есть неназначенные задачи?" : analysis.overdue.length ? "Какие сроки сейчас требуют внимания?" : "Составь план действий на ближайшую неделю")} disabled={!canEdit}>Разобрать с помощником <ArrowRight size={14} /></button></section>
          <section className="assistant-data-card"><div><WalletCards size={16} /><span><strong>{formatCurrency(analysis.actualCost)}</strong><em>фактический бюджет</em></span></div><div><Coins size={16} /><span><strong>{formatHours(analysis.loggedMinutes)}</strong><em>учтено времени</em></span></div></section>
        </aside>
      </div>
    </section>
  );
}
