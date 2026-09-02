"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertOctagon, CalendarClock, CheckCircle2, ChevronRight, CircleAlert, Crosshair, Link2, Plus, Search, ShieldAlert, Trash2, UserRound, X } from "lucide-react";

const statuses = {
  open: { label: "Открыт", className: "open" },
  monitoring: { label: "Под наблюдением", className: "monitoring" },
  mitigated: { label: "Снижен", className: "mitigated" },
  closed: { label: "Закрыт", className: "closed" },
};

const emptyRisk = { type: "risk", title: "", description: "", probability: 3, impact: 3, status: "open", ownerKey: "", due: "", taskId: "", mitigation: "" };

export function riskLevel(probability, impact) {
  const score = Number(probability || 0) * Number(impact || 0);
  if (score >= 15) return { id: "critical", label: "Критический", score };
  if (score >= 10) return { id: "high", label: "Высокий", score };
  if (score >= 5) return { id: "medium", label: "Средний", score };
  return { id: "low", label: "Низкий", score };
}

function formatDate(value) {
  if (!value) return "Без срока";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

export default function RiskPanel({ project, tasks, members, canEdit, onChangeRisks, onOpenTask, initialTaskId = "" }) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [levelFilter, setLevelFilter] = useState("all");
  const [taskFilter, setTaskFilter] = useState(initialTaskId || "all");
  const [matrixFilter, setMatrixFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState(emptyRisk);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const risks = Array.isArray(project?.risks) ? project.risks : [];

  useEffect(() => { setTaskFilter(initialTaskId || "all"); }, [initialTaskId]);

  const memberByKey = useMemo(() => new Map((members || []).map((member) => [member.member_key, member])), [members]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const activeRisks = risks.filter((item) => !["mitigated", "closed"].includes(item.status));
  const criticalCount = activeRisks.filter((item) => riskLevel(item.probability, item.impact).id === "critical").length;
  const issuesCount = activeRisks.filter((item) => item.type === "issue").length;
  const controlledCount = risks.filter((item) => ["mitigated", "closed"].includes(item.status)).length;
  const overdueCount = activeRisks.filter((item) => item.due && item.due < new Date().toISOString().slice(0, 10)).length;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return risks.filter((item) => {
      const level = riskLevel(item.probability, item.impact);
      return (!needle || `${item.title} ${item.description} ${item.mitigation}`.toLowerCase().includes(needle))
        && (typeFilter === "all" || item.type === typeFilter)
        && (statusFilter === "all" || (statusFilter === "active" ? !["mitigated", "closed"].includes(item.status) : item.status === statusFilter))
        && (levelFilter === "all" || level.id === levelFilter)
        && (taskFilter === "all" || (taskFilter === "unlinked" ? !item.taskId : item.taskId === taskFilter))
        && (!matrixFilter || matrixFilter === `${item.probability}-${item.impact}`);
    }).sort((a, b) => riskLevel(b.probability, b.impact).score - riskLevel(a.probability, a.impact).score || String(a.due || "9999").localeCompare(String(b.due || "9999")));
  }, [levelFilter, matrixFilter, query, risks, statusFilter, taskFilter, typeFilter]);

  function openNew(type = "risk") {
    setEditingId("");
    setDraft({ ...emptyRisk, type, probability: type === "issue" ? 5 : 3, taskId: initialTaskId || "" });
    setConfirmDelete(false);
    setModalOpen(true);
  }

  function openEdit(item) {
    setEditingId(item.id);
    setDraft({ ...emptyRisk, ...item });
    setConfirmDelete(false);
    setModalOpen(true);
  }

  function saveRisk(event) {
    event.preventDefault();
    if (!draft.title.trim() || !canEdit) return;
    const now = new Date().toISOString();
    const item = {
      ...draft,
      id: editingId || `risk-${Date.now()}`,
      title: draft.title.trim(),
      description: draft.description.trim(),
      mitigation: draft.mitigation.trim(),
      probability: draft.type === "issue" ? 5 : Number(draft.probability),
      impact: Number(draft.impact),
      createdAt: editingId ? risks.find((entry) => entry.id === editingId)?.createdAt || now : now,
      updatedAt: now,
    };
    onChangeRisks(editingId ? risks.map((entry) => entry.id === editingId ? item : entry) : [item, ...risks]);
    setModalOpen(false);
  }

  function deleteRisk() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    onChangeRisks(risks.filter((item) => item.id !== editingId));
    setModalOpen(false);
  }

  function quickStatus(item, status) {
    onChangeRisks(risks.map((entry) => entry.id === item.id ? { ...entry, status, updatedAt: new Date().toISOString() } : entry));
  }

  return (
    <section className="risk-panel" aria-label="Риски и проблемы">
      <header className="risk-header">
        <div><span className="section-kicker">Управление неопределённостью</span><h2>Риски и проблемы</h2><p>Оценивайте угрозы, фиксируйте возникшие проблемы и контролируйте меры реагирования.</p></div>
        {canEdit && <div><button onClick={() => openNew("issue")}><AlertOctagon size={16} /> Проблема</button><button className="risk-primary" onClick={() => openNew("risk")}><Plus size={17} /> Добавить риск</button></div>}
      </header>

      <div className="risk-kpis">
        <article><span className="risk-kpi-icon orange"><ShieldAlert size={18} /></span><div><strong>{activeRisks.length}</strong><span>Активных рисков</span></div></article>
        <article className={criticalCount ? "has-risk" : ""}><span className="risk-kpi-icon red"><CircleAlert size={18} /></span><div><strong>{criticalCount}</strong><span>Критических</span></div></article>
        <article><span className="risk-kpi-icon purple"><AlertOctagon size={18} /></span><div><strong>{issuesCount}</strong><span>Открытых проблем</span></div></article>
        <article><span className="risk-kpi-icon green"><CheckCircle2 size={18} /></span><div><strong>{controlledCount}</strong><span>Снижено или закрыто</span></div></article>
      </div>

      <div className="risk-overview-grid">
        <section className="risk-matrix-card">
          <div className="risk-card-head"><div><span className="section-kicker">Тепловая карта</span><h3>Матрица рисков</h3></div>{matrixFilter && <button onClick={() => setMatrixFilter("")}><X size={13} /> Сбросить ячейку</button>}</div>
          <div className="risk-matrix-wrap"><span className="risk-axis-y">Вероятность</span><div className="risk-matrix">
            {[5, 4, 3, 2, 1].map((probability) => <div className="risk-matrix-row" key={probability}><b>{probability}</b>{[1, 2, 3, 4, 5].map((impact) => { const count = risks.filter((item) => item.probability === probability && item.impact === impact && !["mitigated", "closed"].includes(item.status)).length; const level = riskLevel(probability, impact); const key = `${probability}-${impact}`; return <button key={impact} className={`level-${level.id} ${matrixFilter === key ? "active" : ""}`} onClick={() => setMatrixFilter(matrixFilter === key ? "" : key)} title={`Вероятность ${probability}, влияние ${impact}`}><span>{count || ""}</span><em>{level.score}</em></button>; })}</div>)}
            <div className="risk-matrix-x"><b />{[1, 2, 3, 4, 5].map((impact) => <span key={impact}>{impact}</span>)}</div>
          </div><span className="risk-axis-x">Влияние</span></div>
          <div className="risk-legend"><span className="level-low">Низкий</span><span className="level-medium">Средний</span><span className="level-high">Высокий</span><span className="level-critical">Критический</span></div>
        </section>

        <aside className={`risk-attention-card ${criticalCount || overdueCount ? "attention" : "calm"}`}><span className="risk-attention-icon">{criticalCount || overdueCount ? <CircleAlert size={25} /> : <CheckCircle2 size={25} />}</span><div><span className="section-kicker">Требует внимания</span><h3>{criticalCount ? `${criticalCount} критических риска` : overdueCount ? `${overdueCount} просроченных мер` : "Критичных угроз нет"}</h3><p>{criticalCount ? "Сначала проработайте риски с оценкой 15–25." : overdueCount ? "Обновите сроки или статус мер реагирования." : "Продолжайте наблюдать за активными рисками."}</p></div><dl><div><dt>Средний балл</dt><dd>{activeRisks.length ? (activeRisks.reduce((sum, item) => sum + riskLevel(item.probability, item.impact).score, 0) / activeRisks.length).toFixed(1) : "0"}</dd></div><div><dt>Просрочено</dt><dd>{overdueCount}</dd></div></dl></aside>
      </div>

      <section className="risk-register">
        <div className="risk-register-head"><div><span className="section-kicker">Реестр проекта</span><h3>План реагирования</h3></div><div className="risk-filters"><label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти риск..." />{query && <button onClick={() => setQuery("")}><X size={13} /></button>}</label><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">Все типы</option><option value="risk">Риски</option><option value="issue">Проблемы</option></select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="active">Активные</option><option value="all">Все статусы</option><option value="open">Открытые</option><option value="monitoring">Под наблюдением</option><option value="mitigated">Сниженные</option><option value="closed">Закрытые</option></select><select value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}><option value="all">Все уровни</option><option value="critical">Критические</option><option value="high">Высокие</option><option value="medium">Средние</option><option value="low">Низкие</option></select><select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}><option value="all">Все задачи</option><option value="unlinked">Без задачи</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></div></div>

        {filtered.length ? <div className="risk-list">{filtered.map((item) => { const level = riskLevel(item.probability, item.impact); const owner = memberByKey.get(item.ownerKey); const task = taskById.get(item.taskId); const overdue = item.due && !["mitigated", "closed"].includes(item.status) && item.due < new Date().toISOString().slice(0, 10); return <article key={item.id} className={`risk-row level-${level.id}`}><button className="risk-row-main" onClick={() => openEdit(item)}><span className={`risk-type ${item.type}`} title={item.type === "issue" ? "Проблема" : "Риск"}>{item.type === "issue" ? <AlertOctagon size={17} /> : <ShieldAlert size={17} />}</span><span className="risk-row-copy"><span><em>{item.type === "issue" ? "Проблема" : "Риск"}</em><strong>{item.title}</strong></span><small>{item.mitigation || item.description || "План реагирования пока не указан"}</small></span></button><div className={`risk-score level-${level.id}`}><strong>{level.score}</strong><span>{level.label}</span></div><div className="risk-owner"><UserRound size={14} /><span>{owner?.display_name || "Не назначен"}</span></div><div className={`risk-due ${overdue ? "overdue" : ""}`}><CalendarClock size={14} /><span>{formatDate(item.due)}</span></div><div className="risk-task-link">{task ? <button onClick={() => onOpenTask(task)}><Link2 size={12} />{task.title}</button> : <span>Без задачи</span>}</div><div className="risk-row-status"><select value={item.status} disabled={!canEdit} onChange={(event) => quickStatus(item, event.target.value)} className={statuses[item.status]?.className}>{Object.entries(statuses).map(([id, status]) => <option key={id} value={id}>{status.label}</option>)}</select><button onClick={() => openEdit(item)} aria-label={`Открыть ${item.title}`}><ChevronRight size={16} /></button></div></article>; })}</div> : <div className="risk-empty"><ShieldAlert size={30} /><strong>{risks.length ? "Ничего не найдено" : "Реестр рисков пуст"}</strong><p>{risks.length ? "Измените фильтры или очистите поиск." : "Добавьте первый риск или зафиксируйте проблему проекта."}</p>{canEdit && !risks.length && <button onClick={() => openNew("risk")}><Plus size={15} /> Добавить риск</button>}</div>}
      </section>

      {modalOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setModalOpen(false)}><div className="modal risk-modal" role="dialog" aria-modal="true"><div className="modal-header"><div><span className="section-kicker">{draft.type === "issue" ? "Возникшая проблема" : "Карточка риска"}</span><h2>{editingId ? "Редактировать запись" : draft.type === "issue" ? "Новая проблема" : "Новый риск"}</h2></div><button className="modal-close" onClick={() => setModalOpen(false)}><X size={20} /></button></div><form onSubmit={saveRisk}><fieldset className="task-edit-fields" disabled={!canEdit}><div className="risk-type-switch"><button type="button" className={draft.type === "risk" ? "active" : ""} onClick={() => setDraft({ ...draft, type: "risk", probability: Math.min(4, draft.probability || 3) })}><ShieldAlert size={16} /> Риск</button><button type="button" className={draft.type === "issue" ? "active issue" : ""} onClick={() => setDraft({ ...draft, type: "issue", probability: 5 })}><AlertOctagon size={16} /> Проблема</button></div><label className="field full"><span>Название</span><input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={draft.type === "issue" ? "Что произошло?" : "Что может произойти?"} required /></label><label className="field full"><span>Описание</span><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Причины, последствия и контекст" rows="3" /></label><div className="risk-assessment-grid"><label className="field"><span>Вероятность · {draft.type === "issue" ? "100%" : `${draft.probability}/5`}</span><input type="range" min="1" max="5" step="1" value={draft.type === "issue" ? 5 : draft.probability} disabled={draft.type === "issue"} onChange={(event) => setDraft({ ...draft, probability: Number(event.target.value) })} /></label><label className="field"><span>Влияние · {draft.impact}/5</span><input type="range" min="1" max="5" step="1" value={draft.impact} onChange={(event) => setDraft({ ...draft, impact: Number(event.target.value) })} /></label><div className={`risk-score-preview level-${riskLevel(draft.type === "issue" ? 5 : draft.probability, draft.impact).id}`}><span>Оценка</span><strong>{riskLevel(draft.type === "issue" ? 5 : draft.probability, draft.impact).score}</strong><em>{riskLevel(draft.type === "issue" ? 5 : draft.probability, draft.impact).label}</em></div></div><div className="form-grid"><label className="field"><span>Статус</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>{Object.entries(statuses).map(([id, status]) => <option key={id} value={id}>{status.label}</option>)}</select></label><label className="field"><span>Ответственный</span><select value={draft.ownerKey} onChange={(event) => setDraft({ ...draft, ownerKey: event.target.value })}><option value="">Не назначен</option>{(members || []).map((member) => <option key={member.member_key} value={member.member_key}>{member.display_name}</option>)}</select></label><label className="field"><span>Срок реакции</span><input type="date" value={draft.due} onChange={(event) => setDraft({ ...draft, due: event.target.value })} /></label><label className="field"><span>Связанная задача</span><select value={draft.taskId} onChange={(event) => setDraft({ ...draft, taskId: event.target.value })}><option value="">Без привязки</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label></div><label className="field full risk-mitigation-field"><span>План реагирования</span><textarea value={draft.mitigation} onChange={(event) => setDraft({ ...draft, mitigation: event.target.value })} placeholder="Какие действия снизят вероятность или влияние?" rows="3" /></label></fieldset><div className="modal-actions">{editingId && canEdit ? <button type="button" className={`delete-button ${confirmDelete ? "confirm" : ""}`} onClick={deleteRisk}><Trash2 size={15} />{confirmDelete ? "Нажмите ещё раз" : "Удалить"}</button> : <span />}<div><button type="button" className="secondary-button" onClick={() => setModalOpen(false)}>Отмена</button>{canEdit && <button type="submit" className="primary-button">{editingId ? "Сохранить" : "Добавить"}</button>}</div></div></form></div></div>}
    </section>
  );
}
