"use client";

import { useMemo, useState } from "react";
import {
  Archive, BatteryCharging, Boxes, CalendarClock, CircleAlert, Database, Download, Edit3, ExternalLink,
  HardDrive, KeyRound, MapPin, Network, PackageCheck, PackageOpen, Plus, Search, Server, ShieldCheck,
  Trash2, UserRound, Wrench, X,
} from "lucide-react";

export const resourceCategories = {
  compute: { label: "Серверы", icon: Server, color: "#587467" },
  storage: { label: "Хранилище", icon: Database, color: "#6d5c83" },
  network: { label: "Сеть", icon: Network, color: "#4f7180" },
  power: { label: "Питание", icon: BatteryCharging, color: "#aa6727" },
  rack: { label: "Шкаф и СКС", icon: Archive, color: "#756b5c" },
  software: { label: "ПО и лицензии", icon: KeyRound, color: "#89614e" },
  accessory: { label: "Комплектующие", icon: HardDrive, color: "#6a716d" },
};

export const resourceStatuses = {
  planned: { label: "Запланировано", tone: "muted" },
  ordered: { label: "Заказано", tone: "warm" },
  in_stock: { label: "На складе", tone: "blue" },
  installed: { label: "Установлено", tone: "green" },
  maintenance: { label: "Обслуживание", tone: "red" },
  retired: { label: "Списано", tone: "muted" },
};

const resourceTypes = {
  equipment: "Оборудование",
  license: "Лицензия",
  consumable: "Расходный материал",
};

const emptyResource = {
  name: "", type: "equipment", category: "compute", manufacturer: "", model: "", serial: "", inventoryNumber: "",
  status: "planned", quantity: 1, reserved: 0, unitCost: 0, location: "", ownerKey: "", taskId: "", supplier: "",
  warrantyUntil: "", note: "", createdAt: null, updatedAt: null,
};

function formatMoney(value) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return "Не указана";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function daysUntil(value) {
  if (!value) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((new Date(`${value}T12:00:00`) - today) / 86400000);
}

function normalizeResource(item) {
  const quantity = Math.min(9999, Math.max(1, Number(item.quantity) || 1));
  return {
    ...emptyResource,
    ...item,
    type: resourceTypes[item.type] ? item.type : "equipment",
    category: resourceCategories[item.category] ? item.category : "accessory",
    status: resourceStatuses[item.status] ? item.status : "planned",
    quantity,
    reserved: Math.min(quantity, Math.max(0, Number(item.reserved) || 0)),
    unitCost: Math.max(0, Number(item.unitCost) || 0),
  };
}

export default function ResourcesPanel({ project, tasks, members, canEdit, onChangeResources, onOpenTask }) {
  const resources = useMemo(() => (project.resources || []).map(normalizeResource), [project.resources]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState(emptyResource);
  const [confirmDeleteId, setConfirmDeleteId] = useState("");

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const memberByKey = useMemo(() => new Map(members.map((member) => [member.member_key, member])), [members]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return resources.filter((item) => {
      const haystack = `${item.name} ${item.manufacturer} ${item.model} ${item.serial} ${item.inventoryNumber} ${item.location} ${item.supplier}`.toLowerCase();
      return haystack.includes(needle)
        && (categoryFilter === "all" || item.category === categoryFilter)
        && (statusFilter === "all" || item.status === statusFilter);
    }).sort((a, b) => (a.status === "maintenance" ? -1 : 0) - (b.status === "maintenance" ? -1 : 0) || a.name.localeCompare(b.name, "ru"));
  }, [resources, query, categoryFilter, statusFilter]);

  const stats = useMemo(() => {
    const units = resources.reduce((sum, item) => sum + item.quantity, 0);
    const installed = resources.filter((item) => item.status === "installed").reduce((sum, item) => sum + item.quantity, 0);
    const available = resources.filter((item) => item.status === "in_stock").reduce((sum, item) => sum + Math.max(0, item.quantity - item.reserved), 0);
    const value = resources.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
    const warranty = resources.filter((item) => { const days = daysUntil(item.warrantyUntil); return days !== null && days >= 0 && days <= 90; }).length;
    const maintenance = resources.filter((item) => item.status === "maintenance").length;
    return { units, installed, available, value, warranty, maintenance };
  }, [resources]);

  const statusPipeline = useMemo(() => Object.entries(resourceStatuses).map(([key, meta]) => ({
    key, ...meta, units: resources.filter((item) => item.status === key).reduce((sum, item) => sum + item.quantity, 0),
  })), [resources]);

  const categorySummary = useMemo(() => Object.entries(resourceCategories).map(([key, meta]) => ({
    key, ...meta, units: resources.filter((item) => item.category === key).reduce((sum, item) => sum + item.quantity, 0),
  })).filter((item) => item.units > 0).sort((a, b) => b.units - a.units), [resources]);

  const attention = useMemo(() => resources.map((item) => {
    const warrantyDays = daysUntil(item.warrantyUntil);
    if (item.status === "maintenance") return { item, label: "На обслуживании", tone: "red" };
    if (warrantyDays !== null && warrantyDays < 0) return { item, label: "Гарантия истекла", tone: "red" };
    if (warrantyDays !== null && warrantyDays <= 90) return { item, label: `Гарантия: ${warrantyDays} дн.`, tone: "warm" };
    if (item.status === "installed" && !item.ownerKey) return { item, label: "Нет ответственного", tone: "warm" };
    if (item.reserved > item.quantity) return { item, label: "Ошибка резерва", tone: "red" };
    return null;
  }).filter(Boolean).slice(0, 4), [resources]);

  function openNew() {
    setEditingId("");
    setDraft({ ...emptyResource, createdAt: new Date().toISOString() });
    setModalOpen(true);
  }

  function openEdit(item) {
    setEditingId(item.id);
    setDraft(normalizeResource(item));
    setModalOpen(true);
  }

  function saveResource(event) {
    event.preventDefault();
    if (!draft.name.trim()) return;
    const now = new Date().toISOString();
    const normalized = normalizeResource({ ...draft, name: draft.name.trim(), manufacturer: draft.manufacturer.trim(), model: draft.model.trim(), serial: draft.serial.trim(), inventoryNumber: draft.inventoryNumber.trim(), location: draft.location.trim(), supplier: draft.supplier.trim(), note: draft.note.trim(), createdAt: draft.createdAt || now, updatedAt: now });
    const next = editingId
      ? resources.map((item) => item.id === editingId ? { ...item, ...normalized, id: editingId } : item)
      : [{ ...normalized, id: `resource-${Date.now()}` }, ...resources];
    onChangeResources(next, editingId ? "Ресурс обновлён" : "Ресурс добавлен");
    setModalOpen(false);
  }

  function changeStatus(id, status) {
    onChangeResources(resources.map((item) => item.id === id ? { ...item, status, updatedAt: new Date().toISOString() } : item), "Статус ресурса обновлён");
  }

  function deleteResource(id) {
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return; }
    onChangeResources(resources.filter((item) => item.id !== id), "Ресурс удалён");
    setConfirmDeleteId("");
  }

  function exportRegistry() {
    const rows = [
      ["Наименование", "Тип", "Категория", "Производитель", "Модель", "Серийный номер", "Статус", "Количество", "Резерв", "Стоимость за единицу", "Местоположение", "Поставщик", "Гарантия"],
      ...filtered.map((item) => [item.name, resourceTypes[item.type], resourceCategories[item.category].label, item.manufacturer, item.model, item.serial || item.inventoryNumber, resourceStatuses[item.status].label, item.quantity, item.reserved, item.unitCost, item.location, item.supplier, item.warrantyUntil]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `resources-${project.id}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="resources-panel" aria-label="Оборудование и ресурсы">
      <header className="resources-header">
        <div><span className="section-kicker">Материальная база проекта</span><h2>Оборудование и ресурсы</h2><p>Единый реестр техники, комплектующих, лицензий, гарантий и распределения по задачам.</p></div>
        <div className="resources-header-actions"><button onClick={exportRegistry}><Download size={16} />Экспорт</button>{canEdit && <button className="resources-primary" onClick={openNew}><Plus size={17} />Добавить ресурс</button>}</div>
      </header>

      <div className="resources-kpis">
        <article><span className="resource-kpi-icon green"><Boxes size={18} /></span><div><strong>{stats.units}</strong><span>Единиц учтено</span><em>{resources.length} позиций</em></div></article>
        <article><span className="resource-kpi-icon blue"><PackageCheck size={18} /></span><div><strong>{stats.installed}</strong><span>Установлено</span><em>Готово к работе</em></div></article>
        <article><span className="resource-kpi-icon warm"><PackageOpen size={18} /></span><div><strong>{stats.available}</strong><span>Свободно на складе</span><em>Без учёта резерва</em></div></article>
        <article className={stats.maintenance || stats.warranty ? "attention" : ""}><span className="resource-kpi-icon red"><CalendarClock size={18} /></span><div><strong>{stats.maintenance + stats.warranty}</strong><span>Требует внимания</span><em>Сервис и гарантия</em></div></article>
      </div>

      <div className="resources-overview">
        <article className="resource-pipeline-card">
          <div className="resource-card-head"><div><span className="section-kicker">Жизненный цикл</span><h3>Состояние ресурсов</h3></div><strong>{formatMoney(stats.value)}<em>учётная стоимость</em></strong></div>
          <div className="resource-pipeline">{statusPipeline.map((item) => <div key={item.key} className={item.tone}><span><i />{item.label}</span><strong>{item.units}</strong><div><b style={{ width: `${stats.units ? Math.max(3, item.units / stats.units * 100) : 0}%` }} /></div></div>)}</div>
        </article>
        <article className={`resource-attention-card ${attention.length ? "attention" : ""}`}>
          <div className="resource-attention-title"><span><ShieldCheck size={20} /></span><div><small>Контроль</small><h3>{attention.length ? "Есть сигналы" : "Всё под контролем"}</h3></div></div>
          {attention.length ? <div className="resource-attention-list">{attention.map(({ item, label, tone }) => <button key={item.id} onClick={() => openEdit(item)}><CircleAlert size={14} className={tone} /><span><strong>{item.name}</strong><em>{label}</em></span></button>)}</div> : <p>Критичных сервисных событий и просроченных гарантий нет.</p>}
        </article>
        <article className="resource-category-card">
          <div className="resource-card-head"><div><span className="section-kicker">Структура</span><h3>По категориям</h3></div></div>
          <div className="resource-category-list">{categorySummary.map((item) => { const Icon = item.icon; return <div key={item.key}><span style={{ color: item.color, background: `${item.color}18` }}><Icon size={15} /></span><strong>{item.label}</strong><em>{item.units} ед.</em></div>; })}</div>
        </article>
      </div>

      <article className="resource-register">
        <div className="resource-register-head">
          <div><span className="section-kicker">Реестр</span><h3>Все позиции</h3></div>
          <div className="resource-filters">
            <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, модель, серийный номер…" />{query && <button onClick={() => setQuery("")} aria-label="Очистить"><X size={13} /></button>}</label>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">Все категории</option>{Object.entries(resourceCategories).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Все статусы</option>{Object.entries(resourceStatuses).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select>
          </div>
        </div>
        <div className="resource-list-head"><span>Ресурс</span><span>Статус</span><span>Наличие</span><span>Размещение</span><span>Ответственный</span><span>Гарантия</span><span /></div>
        <div className="resource-list">
          {filtered.map((item) => {
            const category = resourceCategories[item.category];
            const Icon = category.icon;
            const task = taskById.get(item.taskId);
            const owner = memberByKey.get(item.ownerKey);
            const warrantyDays = daysUntil(item.warrantyUntil);
            return <article className="resource-row" key={item.id}>
              <div className="resource-main"><button className="resource-main-open" onClick={() => openEdit(item)}><span style={{ color: category.color, background: `${category.color}18` }}><Icon size={17} /></span><div><strong>{item.name}</strong><em>{[item.manufacturer, item.model].filter(Boolean).join(" · ") || resourceTypes[item.type]}{item.serial ? ` · S/N ${item.serial}` : ""}</em></div></button>{task && <button className="resource-task-link" onClick={() => onOpenTask(task)}><ExternalLink size={11} />{task.title}</button>}</div>
              <select className={`resource-status ${resourceStatuses[item.status].tone}`} value={item.status} disabled={!canEdit} onChange={(event) => changeStatus(item.id, event.target.value)}>{Object.entries(resourceStatuses).map(([key, meta]) => <option value={key} key={key}>{meta.label}</option>)}</select>
              <div className="resource-stock"><strong>{Math.max(0, item.quantity - item.reserved)} / {item.quantity}</strong><span>{item.reserved ? `В резерве: ${item.reserved}` : "Без резерва"}</span></div>
              <div className="resource-location"><MapPin size={13} /><span>{item.location || "Не указано"}</span></div>
              <div className="resource-owner"><UserRound size={13} /><span>{owner?.display_name || "Не назначен"}</span></div>
              <div className={`resource-warranty ${warrantyDays !== null && warrantyDays <= 90 ? "attention" : ""}`}><CalendarClock size={13} /><span>{formatDate(item.warrantyUntil)}</span></div>
              <div className="resource-row-actions"><button onClick={() => openEdit(item)} aria-label="Редактировать"><Edit3 size={14} /></button>{canEdit && <button className={confirmDeleteId === item.id ? "confirm" : ""} onClick={() => deleteResource(item.id)} aria-label={confirmDeleteId === item.id ? "Подтвердить удаление" : "Удалить"}><Trash2 size={14} /></button>}</div>
            </article>;
          })}
          {!filtered.length && <div className="resource-empty"><Boxes size={31} /><strong>Ресурсы не найдены</strong><p>Измените фильтры или добавьте новую позицию.</p>{canEdit && <button onClick={openNew}><Plus size={15} />Добавить ресурс</button>}</div>}
        </div>
      </article>

      {modalOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setModalOpen(false)}><div className="modal resource-modal" role="dialog" aria-modal="true" aria-labelledby="resource-modal-title">
        <div className="modal-header"><div><span className="section-kicker">Карточка ресурса</span><h2 id="resource-modal-title">{editingId ? "Редактировать ресурс" : "Новый ресурс"}</h2></div><button className="modal-close" onClick={() => setModalOpen(false)} aria-label="Закрыть"><X size={20} /></button></div>
        <form onSubmit={saveResource}>
          <fieldset disabled={!canEdit}>
            <label className="field full"><span>Название</span><input autoFocus required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Например, дисковая полка JBOD" /></label>
            <div className="form-grid"><label className="field"><span>Тип</span><select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}>{Object.entries(resourceTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="field"><span>Категория</span><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{Object.entries(resourceCategories).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></label></div>
            <div className="form-grid"><label className="field"><span>Производитель</span><input value={draft.manufacturer} onChange={(event) => setDraft({ ...draft, manufacturer: event.target.value })} placeholder="Например, Acme Networks" /></label><label className="field"><span>Модель</span><input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="Модель или редакция" /></label></div>
            <div className="form-grid"><label className="field"><span>Серийный номер</span><input value={draft.serial} onChange={(event) => setDraft({ ...draft, serial: event.target.value })} placeholder="S/N" /></label><label className="field"><span>Инвентарный номер</span><input value={draft.inventoryNumber} onChange={(event) => setDraft({ ...draft, inventoryNumber: event.target.value })} placeholder="Инв. №" /></label></div>
            <div className="form-grid resource-quantity-grid"><label className="field"><span>Статус</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>{Object.entries(resourceStatuses).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></label><label className="field"><span>Количество</span><input type="number" min="1" max="9999" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value, reserved: Math.min(Number(event.target.value) || 1, Number(draft.reserved) || 0) })} /></label><label className="field"><span>В резерве</span><input type="number" min="0" max={Math.max(1, Number(draft.quantity) || 1)} value={draft.reserved} onChange={(event) => setDraft({ ...draft, reserved: event.target.value })} /></label></div>
            <div className="form-grid"><label className="field"><span>Стоимость за единицу, ₽</span><input type="number" min="0" step="100" value={draft.unitCost} onChange={(event) => setDraft({ ...draft, unitCost: event.target.value })} /></label><label className="field"><span>Гарантия до</span><input type="date" value={draft.warrantyUntil} onChange={(event) => setDraft({ ...draft, warrantyUntil: event.target.value })} /></label></div>
            <div className="form-grid"><label className="field"><span>Местоположение</span><input value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} placeholder="Серверный шкаф · 8U" /></label><label className="field"><span>Поставщик</span><input value={draft.supplier} onChange={(event) => setDraft({ ...draft, supplier: event.target.value })} placeholder="Компания-поставщик" /></label></div>
            <div className="form-grid"><label className="field"><span>Ответственный</span><select value={draft.ownerKey} onChange={(event) => setDraft({ ...draft, ownerKey: event.target.value })}><option value="">Не назначен</option>{members.map((member) => <option value={member.member_key} key={member.member_key}>{member.display_name}</option>)}</select></label><label className="field"><span>Связанная задача</span><select value={draft.taskId} onChange={(event) => setDraft({ ...draft, taskId: event.target.value })}><option value="">Без связи</option>{tasks.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}</select></label></div>
            <label className="field full"><span>Примечание</span><textarea rows="3" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="Комплектация, условия поставки, особенности эксплуатации…" /></label>
          </fieldset>
          <div className="resource-modal-summary"><Wrench size={16} /><span><strong>{Math.max(0, Number(draft.quantity) - Number(draft.reserved) || 0)} доступно</strong><em>{formatMoney((Number(draft.quantity) || 0) * (Number(draft.unitCost) || 0))} · общая стоимость позиции</em></span></div>
          <div className="modal-actions"><span /> <div><button type="button" className="secondary-button" onClick={() => setModalOpen(false)}>Закрыть</button>{canEdit && <button className="primary-button" type="submit">Сохранить</button>}</div></div>
        </form>
      </div></div>}
    </section>
  );
}
