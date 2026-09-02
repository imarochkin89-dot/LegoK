"use client";

import { useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Blocks, CalendarSync, CheckCircle2, Clock3, ExternalLink,
  Mail, MessageSquareText, Plus, Power, RefreshCw, Search, Settings2, Trash2,
  Webhook, Workflow, X, Zap,
} from "lucide-react";

const connectorCatalog = [
  { id: "webhook", name: "Webhook / API", category: "Разработка", description: "Передавайте события проекта в CRM, Service Desk или собственный сервис.", Icon: Webhook, tone: "ink", availability: "Доступно сейчас", native: true, destinationLabel: "HTTPS-адрес получателя", placeholder: "https://example.ru/hooks/project" },
  { id: "telegram", name: "Telegram", category: "Коммуникации", description: "Отправляйте сроки, изменения задач и риски в рабочий чат.", Icon: MessageSquareText, tone: "blue", availability: "Требуется бот", destinationLabel: "Название чата", placeholder: "Например, Инфраструктура" },
  { id: "slack", name: "Slack", category: "Коммуникации", description: "Публикуйте обновления проекта в выбранном канале команды.", Icon: Blocks, tone: "violet", availability: "Требуется OAuth", destinationLabel: "Канал", placeholder: "Например, #project-infra" },
  { id: "google-calendar", name: "Google Calendar", category: "Календари", description: "Создавайте события по срокам задач и контрольным точкам.", Icon: CalendarSync, tone: "green", availability: "Требуется OAuth", destinationLabel: "Календарь", placeholder: "Например, Сроки проекта" },
  { id: "outlook", name: "Outlook Calendar", category: "Календари", description: "Синхронизируйте сроки проекта с календарями Microsoft 365.", Icon: CalendarSync, tone: "blue", availability: "Требуется OAuth", destinationLabel: "Календарь", placeholder: "Например, Команда ИТ" },
  { id: "email", name: "Email-отчёты", category: "Отчётность", description: "Получайте сводки по прогрессу, просрочкам, бюджету и времени.", Icon: Mail, tone: "warm", availability: "Требуется SMTP", destinationLabel: "Группа получателей", placeholder: "Например, Руководители проекта" },
];

const eventOptions = [
  { id: "task_changes", label: "Изменения задач", hint: "создание, статус и исполнитель" },
  { id: "deadlines", label: "Контроль сроков", hint: "сегодня, скоро и просрочено" },
  { id: "risks", label: "Риски и проблемы", hint: "новые записи и изменение оценки" },
  { id: "comments", label: "Комментарии", hint: "обсуждения в карточках задач" },
  { id: "files", label: "Файлы", hint: "загрузка и удаление документов" },
  { id: "time", label: "Учёт времени", hint: "таймеры и записи трудозатрат" },
];

const defaultEvents = Object.fromEntries(eventOptions.map((item) => [item.id, item.id === "comments" || item.id === "files" ? false : true]));

function formatMoment(value) {
  if (!value) return "Ещё не проверялось";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function destinationSummary(config) {
  if (!config?.destination) return "Получатель не указан";
  if (config.connectorId !== "webhook") return config.destination;
  try { return new URL(config.destination).hostname; } catch { return "Адрес требует проверки"; }
}

function statusMeta(config) {
  if (!config) return { label: "Не настроено", className: "idle" };
  if (!config.enabled) return { label: "Выключено", className: "muted" };
  if (config.status === "connected") return { label: "Подключено", className: "success" };
  if (config.status === "error") return { label: "Ошибка проверки", className: "danger" };
  if (config.status === "authorization_required") return { label: "Нужна авторизация", className: "warning" };
  return { label: "Готово к проверке", className: "ready" };
}

export default function IntegrationsPanel({ project, canEdit, onChangeData }) {
  const configs = Array.isArray(project?.integrations) ? project.integrations : [];
  const logs = Array.isArray(project?.integrationLog) ? project.integrationLog : [];
  const [catalogFilter, setCatalogFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [modalConnector, setModalConnector] = useState(null);
  const [draft, setDraft] = useState(null);
  const [formError, setFormError] = useState("");
  const [testingId, setTestingId] = useState("");
  const [confirmRemoveId, setConfirmRemoveId] = useState("");

  const configByConnector = useMemo(() => new Map(configs.map((item) => [item.connectorId, item])), [configs]);
  const visibleConnectors = connectorCatalog.filter((connector) => {
    const config = configByConnector.get(connector.id);
    const needle = query.trim().toLowerCase();
    return (catalogFilter === "all" || (catalogFilter === "configured" ? Boolean(config) : !config))
      && `${connector.name} ${connector.category} ${connector.description}`.toLowerCase().includes(needle);
  });
  const connectedCount = configs.filter((item) => item.enabled && item.status === "connected").length;
  const enabledCount = configs.filter((item) => item.enabled).length;
  const activeRules = configs.filter((item) => item.enabled).reduce((sum, item) => sum + Object.values(item.events || {}).filter(Boolean).length, 0);
  const successfulChecks = logs.filter((item) => item.status === "success").length;

  function openSettings(connector) {
    const existing = configByConnector.get(connector.id);
    setModalConnector(connector);
    setDraft(existing ? { ...existing, events: { ...defaultEvents, ...(existing.events || {}) } } : {
      id: `integration-${connector.id}-${Date.now()}`,
      connectorId: connector.id,
      name: connector.name,
      destination: "",
      enabled: true,
      events: { ...defaultEvents },
      status: connector.native ? "ready" : "authorization_required",
      updatedAt: null,
      lastCheckedAt: null,
    });
    setFormError("");
  }

  function saveSettings(event) {
    event.preventDefault();
    if (!draft || !modalConnector) return;
    const destination = draft.destination.trim();
    if (!destination) { setFormError("Укажите получателя или адрес подключения"); return; }
    if (modalConnector.native) {
      try {
        const url = new URL(destination);
        if (url.protocol !== "https:") throw new Error("https");
      } catch { setFormError("Для webhook нужен корректный HTTPS-адрес"); return; }
    }
    if (!Object.values(draft.events || {}).some(Boolean)) { setFormError("Выберите хотя бы одно событие"); return; }
    const now = new Date().toISOString();
    const nextConfig = {
      ...draft,
      destination,
      status: draft.status === "connected" ? "connected" : modalConnector.native ? "ready" : "authorization_required",
      updatedAt: now,
    };
    const exists = configs.some((item) => item.connectorId === modalConnector.id);
    const next = exists ? configs.map((item) => item.connectorId === modalConnector.id ? nextConfig : item) : [...configs, nextConfig];
    onChangeData({ integrations: next, integrationLog: logs }, `${modalConnector.name}: сценарий сохранён`);
    setModalConnector(null);
  }

  function toggleEnabled(config) {
    const enabled = !config.enabled;
    const next = configs.map((item) => item.id === config.id ? { ...item, enabled, updatedAt: new Date().toISOString() } : item);
    onChangeData({ integrations: next, integrationLog: logs }, enabled ? "Интеграция включена" : "Интеграция приостановлена");
  }

  function removeConfig(config) {
    if (confirmRemoveId !== config.id) { setConfirmRemoveId(config.id); return; }
    onChangeData({ integrations: configs.filter((item) => item.id !== config.id), integrationLog: logs }, "Настройка интеграции удалена");
    setConfirmRemoveId("");
  }

  async function testWebhook(config) {
    setTestingId(config.id);
    const now = new Date().toISOString();
    try {
      const response = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", projectId: project.id, projectName: project.name, connectorId: config.connectorId, endpoint: config.destination }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось доставить тестовое событие");
      const nextConfigs = configs.map((item) => item.id === config.id ? { ...item, status: "connected", lastCheckedAt: now, updatedAt: now } : item);
      const nextLogs = [{ id: `integration-log-${Date.now()}`, connectorId: config.connectorId, connectorName: config.name, status: "success", message: `Тестовое событие доставлено · ${result.deliveredTo}`, createdAt: now }, ...logs].slice(0, 80);
      onChangeData({ integrations: nextConfigs, integrationLog: nextLogs }, "Webhook проверен и подключён");
    } catch (error) {
      const nextConfigs = configs.map((item) => item.id === config.id ? { ...item, status: "error", lastCheckedAt: now, updatedAt: now } : item);
      const nextLogs = [{ id: `integration-log-${Date.now()}`, connectorId: config.connectorId, connectorName: config.name, status: "error", message: error.message || "Ошибка доставки тестового события", createdAt: now }, ...logs].slice(0, 80);
      onChangeData({ integrations: nextConfigs, integrationLog: nextLogs }, "Webhook не ответил — проверьте адрес");
    } finally { setTestingId(""); }
  }

  return (
    <section className="integrations-panel" aria-label="Интеграции проекта">
      <header className="integrations-header">
        <div><span className="section-kicker">Связь с внешними сервисами</span><h2>Интеграции</h2><p>Настройте каналы уведомлений, календари и передачу событий проекта во внешние системы.</p></div>
        {canEdit && <button className="integration-primary" onClick={() => openSettings(connectorCatalog[0])}><Plus size={16} /> Добавить webhook</button>}
      </header>

      <section className="integration-flow" aria-label="Схема доставки событий">
        <div><span className="integration-flow-icon"><Workflow size={20} /></span><div><strong>События проекта</strong><em>задачи, сроки, файлы, риски</em></div></div><i /><div><span className="integration-flow-icon"><Zap size={20} /></span><div><strong>{activeRules} активных правил</strong><em>фильтрация и маршрутизация</em></div></div><i /><div><span className="integration-flow-icon"><ExternalLink size={20} /></span><div><strong>{enabledCount || "Нет"} {enabledCount === 1 ? "канал" : "каналов"}</strong><em>получатели обновлений</em></div></div>
      </section>

      <div className="integration-kpis">
        <article><span className="integration-kpi-icon green"><CheckCircle2 size={18} /></span><div><strong>{connectedCount}</strong><span>Подключено</span></div><em>проверенные каналы</em></article>
        <article><span className="integration-kpi-icon blue"><Settings2 size={18} /></span><div><strong>{configs.length}</strong><span>Настроено</span></div><em>сохранённые сценарии</em></article>
        <article><span className="integration-kpi-icon warm"><Zap size={18} /></span><div><strong>{activeRules}</strong><span>Правил доставки</span></div><em>по событиям проекта</em></article>
        <article><span className="integration-kpi-icon ink"><Activity size={18} /></span><div><strong>{successfulChecks}</strong><span>Успешных проверок</span></div><em>в журнале интеграций</em></article>
      </div>

      <section className="integration-catalog-card">
        <div className="integration-catalog-head">
          <div><span className="section-kicker">Каталог</span><h3>Каналы и сервисы</h3></div>
          <div className="integration-catalog-controls"><label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти интеграцию..." />{query && <button onClick={() => setQuery("")}><X size={13} /></button>}</label><div>{[["all", "Все"], ["configured", "Настроенные"], ["available", "Доступные"]].map(([id, label]) => <button className={catalogFilter === id ? "active" : ""} onClick={() => setCatalogFilter(id)} key={id}>{label}</button>)}</div></div>
        </div>
        <div className="integration-catalog-grid">
          {visibleConnectors.map((connector) => {
            const config = configByConnector.get(connector.id);
            const status = statusMeta(config);
            return <article className={`integration-card ${config ? "configured" : ""}`} key={connector.id}>
              <div className="integration-card-top"><span className={`connector-icon ${connector.tone}`}><connector.Icon size={21} /></span><span className={`integration-status ${status.className}`}>{status.className === "success" && <CheckCircle2 size={12} />}{status.className === "danger" && <AlertTriangle size={12} />}{status.label}</span></div>
              <div className="integration-card-copy"><span>{connector.category}</span><h4>{connector.name}</h4><p>{connector.description}</p></div>
              {config ? <div className="integration-config-summary"><strong>{destinationSummary(config)}</strong><span>{Object.values(config.events || {}).filter(Boolean).length} событий · {formatMoment(config.lastCheckedAt)}</span></div> : <div className="integration-availability"><Clock3 size={13} /> {connector.availability}</div>}
              <div className="integration-card-actions">
                {config && connector.native && <button className="integration-test" disabled={!canEdit || !config.enabled || testingId === config.id} onClick={() => testWebhook(config)}>{testingId === config.id ? <RefreshCw className="spin" size={14} /> : <Activity size={14} />} Проверить</button>}
                <button className={config ? "integration-settings" : "integration-connect"} disabled={!canEdit} onClick={() => openSettings(connector)}>{config ? <Settings2 size={14} /> : <Plus size={14} />}{config ? "Настроить" : "Подключить"}</button>
                {config && canEdit && <button className={`integration-power ${config.enabled ? "on" : ""}`} onClick={() => toggleEnabled(config)} title={config.enabled ? "Приостановить" : "Включить"}><Power size={14} /></button>}
                {config && canEdit && <button className={`integration-remove ${confirmRemoveId === config.id ? "confirm" : ""}`} onClick={() => removeConfig(config)} onBlur={() => setTimeout(() => setConfirmRemoveId(""), 150)} title={confirmRemoveId === config.id ? "Нажмите ещё раз" : "Удалить настройку"}><Trash2 size={14} /></button>}
              </div>
            </article>;
          })}
          {!visibleConnectors.length && <div className="integration-empty"><Search size={25} /><strong>Ничего не найдено</strong><p>Измените поиск или фильтр каталога.</p></div>}
        </div>
      </section>

      <section className="integration-log-card">
        <div><span className="section-kicker">Диагностика</span><h3>Журнал интеграций</h3></div>
        {logs.length ? <div className="integration-log-list">{logs.slice(0, 12).map((item) => <article key={item.id}><span className={`integration-log-icon ${item.status}`}>{item.status === "success" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}</span><div><strong>{item.connectorName}</strong><span>{item.message}</span></div><time>{formatMoment(item.createdAt)}</time></article>)}</div> : <div className="integration-log-empty"><Activity size={26} /><strong>Журнал пока пуст</strong><p>Результаты проверок и доставки появятся здесь.</p></div>}
      </section>

      {modalConnector && draft && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setModalConnector(null)}><div className="modal integration-modal" role="dialog" aria-modal="true"><div className="modal-header"><div><span className="section-kicker">Настройка канала</span><h2>{modalConnector.name}</h2></div><button className="modal-close" onClick={() => setModalConnector(null)}><X size={20} /></button></div><form onSubmit={saveSettings}>
        <div className={`integration-security-note ${modalConnector.native ? "native" : "oauth"}`}><span>{modalConnector.native ? <Webhook size={18} /> : <ExternalLink size={18} />}</span><p>{modalConnector.native ? "Тест отправит название проекта и служебное событие. После успешной проверки выбранные обновления будут передаваться автоматически. Не добавляйте токены и пароли в URL." : "Сценарий и события будут сохранены. Для реальной доставки потребуется OAuth или серверный ключ; секреты в проекте не хранятся."}</p></div>
        <label className="field full"><span>{modalConnector.destinationLabel}</span><input autoFocus value={draft.destination} onChange={(event) => setDraft({ ...draft, destination: event.target.value })} placeholder={modalConnector.placeholder} required /></label>
        <div className="integration-event-title"><div><strong>Какие события передавать</strong><span>Выберите обновления для этого канала</span></div><label className="integration-enabled-switch"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /><span /><em>{draft.enabled ? "Включено" : "Выключено"}</em></label></div>
        <div className="integration-event-grid">{eventOptions.map((item) => <label key={item.id} className={draft.events[item.id] ? "checked" : ""}><input type="checkbox" checked={Boolean(draft.events[item.id])} onChange={(event) => setDraft({ ...draft, events: { ...draft.events, [item.id]: event.target.checked } })} /><span>{draft.events[item.id] && <CheckCircle2 size={15} />}</span><div><strong>{item.label}</strong><em>{item.hint}</em></div></label>)}</div>
        {formError && <div className="integration-form-error"><AlertTriangle size={15} />{formError}</div>}
        <div className="modal-actions"><span /><div><button type="button" className="secondary-button" onClick={() => setModalConnector(null)}>Отмена</button><button type="submit" className="primary-button">Сохранить сценарий</button></div></div>
      </form></div></div>}
    </section>
  );
}
