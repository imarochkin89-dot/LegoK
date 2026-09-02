"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, CalendarClock, Check, CheckCircle2, CircleAlert, Clock3, Download,
  FileText, FolderOpen, LoaderCircle, MessageCircleQuestion, RefreshCw, Send,
  ShieldCheck, Sparkles, UserRound, X,
} from "lucide-react";
import PublicShareManager from "./PublicShareManager";

const statusLabels = { todo: "Запланировано", progress: "В работе", done: "Готово" };
const requestStatuses = { open: "Ожидает ответа", approved: "Согласовано", changes: "Нужны изменения", closed: "Закрыто" };

function progressOf(task) {
  if (task.subtasks?.length) return Math.round((task.subtasks.filter((item) => item.done).length / task.subtasks.length) * 100);
  return Math.min(100, Math.max(0, Number(task.progress) || 0));
}

function formatDate(value, long = false) {
  if (!value) return "Дата уточняется";
  return new Intl.DateTimeFormat("ru-RU", long ? { day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`));
}

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  return `${(value / 1024 / 1024).toFixed(1)} МБ`;
}

export default function ClientPortalPanel({ project, projects, tasks, actor, canManage, onChangeConfig }) {
  const config = project?.clientPortal || {};
  const [data, setData] = useState({ requests: [], documents: [], availableFiles: [], canManage });
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [question, setQuestion] = useState({ title: "", body: "" });
  const [approval, setApproval] = useState({ title: "", body: "" });
  const [responseDrafts, setResponseDrafts] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => { loadPortal(); }, [project?.id]);

  async function loadPortal(silent = false) {
    if (!project?.id) return;
    if (!silent) setStatus("loading");
    setError("");
    try {
      const response = await fetch(`/api/client-portal?projectId=${encodeURIComponent(project.id)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Портал недоступен");
      setData(result);
      setStatus("ready");
    } catch (loadError) {
      setStatus("error");
      setError(loadError.message || "Не удалось загрузить портал");
    }
  }

  async function action(payload) {
    setError("");
    try {
      const response = await fetch("/api/client-portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.id, ...payload }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось сохранить изменения");
      setData(result);
      return true;
    } catch (actionError) {
      setError(actionError.message || "Не удалось сохранить изменения");
      return false;
    }
  }

  async function submitRequest(event, kind) {
    event.preventDefault();
    const draft = kind === "approval" ? approval : question;
    if (!draft.title.trim() || !draft.body.trim()) return;
    if (await action({ action: "create_request", kind, title: draft.title, body: draft.body })) {
      if (kind === "approval") setApproval({ title: "", body: "" });
      else setQuestion({ title: "", body: "" });
    }
  }

  async function updateRequest(item, nextStatus) {
    if (await action({ action: "update_request", requestId: item.id, status: nextStatus, response: responseDrafts[item.id] || item.response || "" })) setResponseDrafts((current) => ({ ...current, [item.id]: "" }));
  }

  const publishedIds = useMemo(() => new Set(data.documents.map((item) => item.id)), [data.documents]);
  const approvals = data.requests.filter((item) => item.kind === "approval");
  const questions = data.requests.filter((item) => item.kind === "question");
  const average = tasks.length ? Math.round(tasks.reduce((sum, task) => sum + progressOf(task), 0) / tasks.length) : 0;
  const completed = tasks.filter((task) => task.status === "done").length;
  const nextTask = [...tasks].filter((task) => task.status !== "done" && task.due).sort((a, b) => a.due.localeCompare(b.due))[0];
  const openApprovals = approvals.filter((item) => item.status === "open").length;

  return (
    <section className="client-portal" aria-label="Клиентский портал">
      <header className="client-portal-hero">
        <div className="client-portal-hero-copy"><span className="client-portal-mark"><Sparkles size={18} /></span><div><span className="section-kicker">Защищённое пространство заказчика</span><h2>{config.clientName || "Клиентский портал"}</h2><p>{config.greeting || "Актуальный статус проекта, документы и согласования — в одном окне."}</p></div></div>
        <div className="client-portal-actions"><span className="client-safe-badge"><ShieldCheck size={16} /> Только опубликованные данные</span><button onClick={() => loadPortal()} title="Обновить"><RefreshCw size={16} className={status === "loading" ? "spin" : ""} /></button>{canManage && <button className="client-settings-button" onClick={() => setSettingsOpen((value) => !value)}>{settingsOpen ? <X size={16} /> : <UserRound size={16} />}{settingsOpen ? "Закрыть настройки" : "Настроить портал"}</button>}</div>
      </header>

      {error && <div className="client-portal-error"><CircleAlert size={16} /><span>{error}</span><button onClick={() => setError("")}><X size={14} /></button></div>}

      {canManage && settingsOpen && <section className="client-portal-settings"><div className="client-settings-copy"><span className="section-kicker">Публикация</span><h3>Что увидит клиент</h3><p>Изменения сохраняются в D1 вместе с проектом. Не отмеченные задачи остаются во внутреннем контуре.</p></div><div className="client-settings-fields"><label><span>Название клиента</span><input value={config.clientName || ""} onChange={(event) => onChangeConfig({ ...config, clientName: event.target.value })} placeholder="Компания-заказчик" /></label><label><span>Следующее обновление</span><input type="date" value={config.nextUpdate || ""} onChange={(event) => onChangeConfig({ ...config, nextUpdate: event.target.value })} /></label><label className="wide"><span>Приветствие</span><input value={config.greeting || ""} onChange={(event) => onChangeConfig({ ...config, greeting: event.target.value })} placeholder="Краткое сообщение для клиента" /></label><label><span>Контактное лицо</span><input value={config.contactName || ""} onChange={(event) => onChangeConfig({ ...config, contactName: event.target.value })} /></label><label><span>Email для связи</span><input type="email" value={config.contactEmail || ""} onChange={(event) => onChangeConfig({ ...config, contactEmail: event.target.value })} /></label></div><div className="client-publish-tasks"><strong>Опубликованные этапы</strong><div>{(project?.tasks || []).map((task) => { const checked = (config.publishedTaskIds || []).includes(task.id); return <label key={task.id}><input type="checkbox" checked={checked} onChange={() => onChangeConfig({ ...config, publishedTaskIds: checked ? (config.publishedTaskIds || []).filter((id) => id !== task.id) : [...(config.publishedTaskIds || []), task.id] })} /><span>{task.title}</span><em>{statusLabels[task.status]}</em></label>; })}</div></div></section>}

      {canManage && <PublicShareManager projectId={project?.id} projects={projects || []} />}

      <div className="client-portal-kpis"><article><span className="client-kpi-icon progress"><CheckCircle2 size={19} /></span><div><strong>{average}%</strong><span>Готовность проекта</span></div></article><article><span className="client-kpi-icon stages"><ArrowRight size={19} /></span><div><strong>{completed} из {tasks.length}</strong><span>Этапов завершено</span></div></article><article><span className="client-kpi-icon date"><CalendarClock size={19} /></span><div><strong>{nextTask ? formatDate(nextTask.due) : "—"}</strong><span>Ближайший срок</span></div></article><article><span className={`client-kpi-icon approvals ${openApprovals ? "attention" : ""}`}><Clock3 size={19} /></span><div><strong>{openApprovals}</strong><span>Ожидают согласования</span></div></article></div>

      <div className="client-portal-grid">
        <section className="client-card client-stages"><div className="client-card-head"><div><span className="section-kicker">План проекта</span><h3>Этапы и прогресс</h3></div><span>{tasks.length}</span></div>{tasks.length ? <div className="client-stage-list">{tasks.map((task) => { const progress = progressOf(task); return <article key={task.id}><div className={`client-stage-status ${task.status}`}>{task.status === "done" ? <Check size={15} /> : <span />}</div><div className="client-stage-main"><div><strong>{task.title}</strong><span className={`client-status-pill ${task.status}`}>{statusLabels[task.status]}</span></div><p>{task.description || "Описание этапа уточняется."}</p><div className="client-stage-progress"><span><i style={{ width: `${progress}%` }} /></span><strong>{progress}%</strong></div></div><time>{formatDate(task.due)}</time></article>; })}</div> : <div className="client-empty"><ArrowRight size={25} /><strong>Этапы ещё не опубликованы</strong><p>Руководитель проекта добавит их после согласования плана.</p></div>}</section>

        <aside className="client-card client-contact"><span className="client-contact-icon"><UserRound size={22} /></span><span className="section-kicker">Связь по проекту</span><h3>{config.contactName || "Руководитель проекта"}</h3><p>По вопросам сроков, документов и согласований используйте форму ниже.</p>{config.contactEmail && <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>}<div><CalendarClock size={16} /><span><strong>Следующее обновление</strong>{formatDate(config.nextUpdate, true)}</span></div></aside>
      </div>

      <div className="client-portal-grid lower">
        <section className="client-card client-approvals"><div className="client-card-head"><div><span className="section-kicker">Решения</span><h3>Согласования</h3></div><span>{approvals.length}</span></div>{canManage && <form className="client-request-form compact" onSubmit={(event) => submitRequest(event, "approval")}><input value={approval.title} onChange={(event) => setApproval({ ...approval, title: event.target.value })} placeholder="Что нужно согласовать" /><textarea value={approval.body} onChange={(event) => setApproval({ ...approval, body: event.target.value })} placeholder="Описание решения и ожидаемый ответ" /><button type="submit"><Send size={15} /> Отправить клиенту</button></form>}<div className="client-request-list">{approvals.map((item) => <article key={item.id}><div className="client-request-title"><strong>{item.title}</strong><span className={`request-status ${item.status}`}>{requestStatuses[item.status]}</span></div><p>{item.body}</p><small>{item.createdBy} · {formatDate(item.createdAt?.slice(0, 10))}</small>{item.response && <blockquote>{item.response}</blockquote>}{item.status === "open" && <div className="client-response"><input value={responseDrafts[item.id] || ""} onChange={(event) => setResponseDrafts({ ...responseDrafts, [item.id]: event.target.value })} placeholder="Комментарий к решению" />{actor?.role === "client" ? <><button className="approve" onClick={() => updateRequest(item, "approved")}><Check size={14} /> Согласовать</button><button onClick={() => updateRequest(item, "changes")}><X size={14} /> Нужны изменения</button></> : <button onClick={() => updateRequest(item, "closed")}>Закрыть</button>}</div>}</article>)}{!approvals.length && <div className="client-empty small"><CheckCircle2 size={23} /><strong>Нет ожидающих решений</strong></div>}</div></section>

        <section className="client-card client-documents"><div className="client-card-head"><div><span className="section-kicker">Материалы</span><h3>Документы клиента</h3></div><span>{data.documents.length}</span></div>{canManage && data.availableFiles.length > 0 && <div className="client-file-publisher"><strong>Публикация из хранилища</strong>{data.availableFiles.map((file) => <label key={file.id}><input type="checkbox" checked={publishedIds.has(file.id)} onChange={(event) => action({ action: "toggle_document", fileId: file.id, published: event.target.checked })} /><FileText size={15} /><span>{file.name}</span></label>)}</div>}<div className="client-document-list">{data.documents.map((file) => <article key={file.id}><span><FileText size={18} /></span><div><strong>{file.name}</strong><small>{formatSize(file.size)} · {file.uploadedBy}</small></div><a href={`/api/files?id=${encodeURIComponent(file.id)}`} title="Скачать"><Download size={16} /></a></article>)}{status === "loading" && !data.documents.length ? <div className="client-empty small"><LoaderCircle className="spin" size={23} /><strong>Загружаю документы…</strong></div> : !data.documents.length && <div className="client-empty small"><FolderOpen size={23} /><strong>Документы ещё не опубликованы</strong></div>}</div></section>
      </div>

      <section className="client-card client-questions"><div className="client-card-head"><div><span className="section-kicker">Обратная связь</span><h3>Вопросы и обращения</h3></div><span>{questions.length}</span></div><div className="client-questions-layout"><form className="client-request-form" onSubmit={(event) => submitRequest(event, "question")}><label><span>Тема</span><input value={question.title} onChange={(event) => setQuestion({ ...question, title: event.target.value })} placeholder="Например, уточнение по срокам" /></label><label><span>Сообщение</span><textarea value={question.body} onChange={(event) => setQuestion({ ...question, body: event.target.value })} placeholder="Опишите вопрос или пожелание" /></label><button type="submit"><MessageCircleQuestion size={16} /> Отправить обращение</button></form><div className="client-request-list">{questions.map((item) => <article key={item.id}><div className="client-request-title"><strong>{item.title}</strong><span className={`request-status ${item.status}`}>{requestStatuses[item.status]}</span></div><p>{item.body}</p><small>{item.createdBy} · {formatDate(item.createdAt?.slice(0, 10))}</small>{item.response && <blockquote>{item.response}</blockquote>}{canManage && item.status === "open" && <div className="client-response"><input value={responseDrafts[item.id] || ""} onChange={(event) => setResponseDrafts({ ...responseDrafts, [item.id]: event.target.value })} placeholder="Ответ клиенту" /><button className="approve" onClick={() => updateRequest(item, "closed")}><Send size={14} /> Ответить и закрыть</button></div>}</article>)}{!questions.length && <div className="client-empty small"><MessageCircleQuestion size={23} /><strong>Обращений пока нет</strong></div>}</div></div></section>
    </section>
  );
}
