"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown, BarChart3, BotMessageSquare, BriefcaseBusiness, CalendarDays, ChartGantt, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  Boxes, Circle, CircleAlert, Clock3, Cloud, CloudOff, Download, FolderKanban, LayoutGrid, Link2, ListChecks,
  LoaderCircle, MessageSquare, MoreHorizontal, Paperclip, PlugZap, Plus, Search, Send, Settings2, ShieldAlert, ShieldCheck, SlidersHorizontal,
  Sparkles, Timer, Trash2, Upload, UserPlus, UserRound, Users, UserX, WalletCards, X,
} from "lucide-react";
import ReportsPanel from "./ReportsPanel";
import GanttView from "./GanttView";
import BudgetPanel, { costCategories } from "./BudgetPanel";
import FilesPanel from "./FilesPanel";
import NotificationCenter from "./NotificationCenter";
import RiskPanel from "./RiskPanel";
import TeamWorkloadPanel from "./TeamWorkloadPanel";
import TimeTrackingPanel from "./TimeTrackingPanel";
import IntegrationsPanel from "./IntegrationsPanel";
import AssistantPanel from "./AssistantPanel";
import PwaInstall from "./PwaInstall";
import ResourcesPanel from "./ResourcesPanel";
import ClientPortalPanel from "./ClientPortalPanel";

const STORAGE_KEY = "kontur-planner-v2";
const OLD_STORAGE_KEY = "kontur-planner-v1";

const columns = [
  { id: "todo", label: "К выполнению", tone: "slate" },
  { id: "progress", label: "В работе", tone: "orange" },
  { id: "done", label: "Готово", tone: "green" },
];

const priorities = {
  high: { label: "Высокий", className: "priority-high", rank: 0 },
  medium: { label: "Средний", className: "priority-medium", rank: 1 },
  low: { label: "Низкий", className: "priority-low", rank: 2 },
};

const deadlineFilters = {
  all: "Все сроки",
  overdue: "Просрочено",
  today: "На сегодня",
  soon: "Ближайшие 3 дня",
  noDue: "Без срока",
};

const baseTasks = [
  {
    id: "task-1", title: "Согласовать схему размещения оборудования",
    description: "Проверить компоновку, электропитание, коммутацию и резерв для расширения.",
    status: "progress", priority: "high", start: "2026-08-19", due: "2026-08-21", dependsOn: [], progress: 67, effortHours: 24, costCategory: "services", plannedCost: 60000, actualCost: 40000,
    subtasks: [
      { id: "sub-1", text: "Проверить высоту оборудования в юнитах", done: true },
      { id: "sub-2", text: "Оставить резерв под вентиляцию", done: true },
      { id: "sub-3", text: "Утвердить схему резервного питания", done: false },
    ],
  },
  {
    id: "task-2", title: "Согласовать спецификацию оборудования",
    description: "Сверить модели, количество, гарантию и сроки поставки.",
    status: "todo", priority: "high", start: "2026-08-22", due: "2026-08-24", dependsOn: ["task-1"], progress: 25, effortHours: 32, costCategory: "equipment", plannedCost: 975000, actualCost: 720000,
    subtasks: [
      { id: "sub-4", text: "Получить цены поставщиков", done: true },
      { id: "sub-5", text: "Проверить совместимость дисков", done: false },
      { id: "sub-6", text: "Согласовать гарантию", done: false },
      { id: "sub-7", text: "Зафиксировать срок поставки", done: false },
    ],
  },
  {
    id: "task-3", title: "Настроить маршрутизацию и резервный канал",
    description: "Основной и резервный каналы, сегментация сети и контроль переключения.",
    status: "todo", priority: "medium", start: "2026-08-25", due: "2026-08-27", dependsOn: ["task-2"], progress: 0, effortHours: 24, costCategory: "services", plannedCost: 90000, actualCost: 25000, subtasks: [],
  },
  {
    id: "task-4", title: "Рассчитать нагрузку и охлаждение",
    description: "Зафиксировать тепловыделение, резерв мощности и параметры кондиционера.",
    status: "progress", priority: "medium", start: "2026-08-19", due: "2026-08-23", dependsOn: [], progress: 40, effortHours: 20, costCategory: "equipment", plannedCost: 85000, actualCost: 65000, subtasks: [],
  },
  {
    id: "task-5", title: "Сформировать коммерческое предложение",
    description: "Сводная стоимость, НДС, сроки поставки, гарантия и резерв расходов.",
    status: "done", priority: "high", start: "2026-08-14", due: "2026-08-18", dependsOn: [], progress: 100, effortHours: 16, costCategory: "services", plannedCost: 20000, actualCost: 20000,
    subtasks: [
      { id: "sub-8", text: "Собрать цены", done: true },
      { id: "sub-9", text: "Добавить условия поставки", done: true },
    ],
  },
  {
    id: "task-6", title: "Описать цели и критерии приёмки",
    description: "Зафиксировать ожидаемые результаты, показатели качества и порядок передачи в эксплуатацию.",
    status: "done", priority: "low", start: "2026-08-12", due: "2026-08-17", dependsOn: [], progress: 100, effortHours: 8, costCategory: "services", plannedCost: 10000, actualCost: 10000, subtasks: [],
  },
];

const serverRisks = [
  { id: "risk-1", type: "risk", title: "Задержка поставки оборудования", description: "Срок поставки может измениться и повлиять на монтажные работы.", probability: 4, impact: 5, status: "open", ownerKey: "", due: "2026-08-22", taskId: "task-2", mitigation: "Подтвердить остатки и подготовить резервный вариант поставки.", createdAt: "2026-08-17T09:00:00.000Z", updatedAt: "2026-08-17T09:00:00.000Z" },
  { id: "risk-2", type: "issue", title: "Недостаточный воздушный поток", description: "На тестовой нагрузке температура вышла за целевой диапазон.", probability: 5, impact: 4, status: "monitoring", ownerKey: "", due: "2026-08-20", taskId: "task-4", mitigation: "Пересчитать воздушный поток и скорректировать размещение оборудования.", createdAt: "2026-08-18T13:20:00.000Z", updatedAt: "2026-08-18T13:20:00.000Z" },
  { id: "risk-3", type: "risk", title: "Недостаточный запас резервного питания", description: "После расширения время автономной работы может оказаться ниже целевого.", probability: 3, impact: 4, status: "monitoring", ownerKey: "", due: "2026-08-25", taskId: "task-1", mitigation: "Проверить профиль нагрузки и предусмотреть дополнительный батарейный модуль.", createdAt: "2026-08-16T11:00:00.000Z", updatedAt: "2026-08-16T11:00:00.000Z" },
];

const monitoringRisks = [
  { id: "risk-m1", type: "risk", title: "Неполный перечень сетевых устройств", description: "Часть оборудования может остаться без мониторинга после запуска.", probability: 3, impact: 3, status: "open", ownerKey: "", due: "2026-08-24", taskId: "task-m1", mitigation: "Сверить инвентаризацию с таблицами DHCP и коммутаторов.", createdAt: "2026-08-18T10:10:00.000Z", updatedAt: "2026-08-18T10:10:00.000Z" },
];

const serverTimeEntries = [
  { id: "time-seed-1", taskId: "task-1", memberKey: "", memberName: "Руководитель проекта", date: "2026-08-19", minutes: 120, note: "Проверка схемы размещения оборудования", createdAt: "2026-08-19T08:20:00.000Z" },
  { id: "time-seed-2", taskId: "task-4", memberKey: "", memberName: "Руководитель проекта", date: "2026-08-19", minutes: 90, note: "Расчёт тепловыделения и запаса охлаждения", createdAt: "2026-08-19T11:10:00.000Z" },
  { id: "time-seed-3", taskId: "task-2", memberKey: "", memberName: "Руководитель проекта", date: "2026-08-18", minutes: 60, note: "Сверка спецификации с предложением поставщика", createdAt: "2026-08-18T14:30:00.000Z" },
];

const monitoringTimeEntries = [
  { id: "time-seed-m1", taskId: "task-m1", memberKey: "", memberName: "Руководитель проекта", date: "2026-08-19", minutes: 75, note: "Сбор адресов и группировка сетевых устройств", createdAt: "2026-08-19T09:40:00.000Z" },
];

const serverResources = [
  { id: "resource-server", name: "Вычислительный узел", type: "equipment", category: "compute", manufacturer: "", model: "2U", serial: "", inventoryNumber: "", status: "planned", quantity: 1, reserved: 0, unitCost: 300000, location: "Техническая зона", ownerKey: "", taskId: "task-1", supplier: "Поставщик оборудования", warrantyUntil: "2029-08-31", note: "Демонстрационная позиция для учёта вычислительных ресурсов.", createdAt: "2026-08-19T07:30:00.000Z", updatedAt: "2026-08-19T07:30:00.000Z" },
  { id: "resource-jbod", name: "Система хранения", type: "equipment", category: "storage", manufacturer: "", model: "12 отсеков", serial: "", inventoryNumber: "", status: "ordered", quantity: 1, reserved: 1, unitCost: 300000, location: "Техническая зона", ownerKey: "", taskId: "task-2", supplier: "Поставщик оборудования", warrantyUntil: "2029-08-31", note: "Демонстрационная позиция для хранения проектных данных.", createdAt: "2026-08-19T07:35:00.000Z", updatedAt: "2026-08-19T07:35:00.000Z" },
  { id: "resource-router", name: "Маршрутизатор", type: "equipment", category: "network", manufacturer: "", model: "Два WAN", serial: "", inventoryNumber: "", status: "planned", quantity: 1, reserved: 0, unitCost: 100000, location: "Техническая зона", ownerKey: "", taskId: "task-3", supplier: "Поставщик оборудования", warrantyUntil: "2029-08-31", note: "Основной и резервный каналы связи с сегментацией сети.", createdAt: "2026-08-19T07:40:00.000Z", updatedAt: "2026-08-19T07:40:00.000Z" },
  { id: "resource-switch", name: "Управляемый коммутатор", type: "equipment", category: "network", manufacturer: "", model: "24 порта", serial: "", inventoryNumber: "", status: "planned", quantity: 1, reserved: 0, unitCost: 85000, location: "Серверный шкаф · 15U", ownerKey: "", taskId: "task-2", supplier: "На согласовании", warrantyUntil: "2029-08-31", note: "Агрегация серверов, систем хранения и рабочих сегментов.", createdAt: "2026-08-19T07:45:00.000Z", updatedAt: "2026-08-19T07:45:00.000Z" },
  { id: "resource-ups", name: "Стоечный ИБП", type: "equipment", category: "power", manufacturer: "", model: "3 кВА", serial: "", inventoryNumber: "", status: "planned", quantity: 1, reserved: 0, unitCost: 180000, location: "Серверный шкаф · 1–3U", ownerKey: "", taskId: "task-1", supplier: "На согласовании", warrantyUntil: "2029-08-31", note: "Требуется проверка запаса мощности и времени автономии.", createdAt: "2026-08-19T07:50:00.000Z", updatedAt: "2026-08-19T07:50:00.000Z" },
  { id: "resource-rack", name: "Серверный шкаф", type: "equipment", category: "rack", manufacturer: "", model: "24U", serial: "", inventoryNumber: "", status: "ordered", quantity: 1, reserved: 1, unitCost: 95000, location: "Серверная", ownerKey: "", taskId: "task-1", supplier: "На согласовании", warrantyUntil: "2028-08-31", note: "С запасом по глубине, вентиляции и размещению кабелей.", createdAt: "2026-08-19T07:55:00.000Z", updatedAt: "2026-08-19T07:55:00.000Z" },
  { id: "resource-patch", name: "Патч-панель и патч-корды", type: "consumable", category: "rack", manufacturer: "", model: "24 порта · Cat.6", serial: "", inventoryNumber: "", status: "in_stock", quantity: 2, reserved: 1, unitCost: 22000, location: "Склад ИТ", ownerKey: "", taskId: "task-1", supplier: "Локальный поставщик", warrantyUntil: "", note: "Одна панель и комплект коммутации в резерве проекта.", createdAt: "2026-08-19T08:00:00.000Z", updatedAt: "2026-08-19T08:00:00.000Z" },
  { id: "resource-windows", name: "Лицензия серверной ОС", type: "license", category: "software", manufacturer: "", model: "Standard", serial: "", inventoryNumber: "LIC-DEMO-01", status: "planned", quantity: 1, reserved: 0, unitCost: 100000, location: "Лицензионный реестр", ownerKey: "", taskId: "task-2", supplier: "Поставщик лицензий", warrantyUntil: "", note: "Демонстрационная лицензия программного обеспечения.", createdAt: "2026-08-19T08:05:00.000Z", updatedAt: "2026-08-19T08:05:00.000Z" },
];

const monitoringResources = [
  { id: "resource-monitor-vm", name: "Виртуальная машина мониторинга", type: "equipment", category: "compute", manufacturer: "", model: "8 vCPU · 16 ГБ RAM", serial: "", inventoryNumber: "VM-MON-01", status: "installed", quantity: 1, reserved: 1, unitCost: 0, location: "Кластер виртуализации", ownerKey: "", taskId: "task-m1", supplier: "Внутренний ресурс", warrantyUntil: "", note: "Среда для системы мониторинга сетевого оборудования.", createdAt: "2026-08-19T08:10:00.000Z", updatedAt: "2026-08-19T08:10:00.000Z" },
  { id: "resource-snmp", name: "Учётные записи SNMP", type: "license", category: "software", manufacturer: "", model: "SNMPv3", serial: "", inventoryNumber: "", status: "in_stock", quantity: 24, reserved: 8, unitCost: 0, location: "Защищённое хранилище", ownerKey: "", taskId: "task-m1", supplier: "Внутренний ресурс", warrantyUntil: "", note: "Набор профилей доступа для контролируемых устройств.", createdAt: "2026-08-19T08:15:00.000Z", updatedAt: "2026-08-19T08:15:00.000Z" },
];

const serverClientPortal = {
  clientName: "Демонстрационный заказчик",
  greeting: "Здесь собраны опубликованные этапы, актуальные сроки и разрешённые документы проекта.",
  contactName: "Руководитель проекта",
  contactEmail: "",
  nextUpdate: "2026-08-24",
  publishedTaskIds: ["task-1", "task-2", "task-3", "task-5"],
};

const monitoringClientPortal = {
  clientName: "Демонстрационный заказчик",
  greeting: "Следите за ходом внедрения и согласовывайте ключевые решения проекта.",
  contactName: "Руководитель проекта",
  contactEmail: "",
  nextUpdate: "2026-08-25",
  publishedTaskIds: ["task-m1", "task-m2"],
};

const initialProjects = [
  {
    id: "project-server", name: "Модернизация ИТ-инфраструктуры",
    description: "Демонстрационный проект обновления вычислительных и сетевых ресурсов.",
    color: "#ea6a34", budget: 1350000, teamCapacity: {}, tasks: baseTasks, risks: serverRisks, timeEntries: serverTimeEntries, activeTimers: {}, integrations: [], integrationLog: [], assistantMessages: [], resources: serverResources, clientPortal: serverClientPortal,
  },
  {
    id: "project-monitoring", name: "Мониторинг сервисов",
    description: "Демонстрационный проект контроля доступности и состояния ИТ-сервисов.",
    color: "#2a8a68", budget: 500000, teamCapacity: {},
    risks: monitoringRisks, timeEntries: monitoringTimeEntries, activeTimers: {}, integrations: [], integrationLog: [], assistantMessages: [], resources: monitoringResources, clientPortal: monitoringClientPortal,
    tasks: [
      {
        id: "task-m1", title: "Составить перечень контролируемых устройств",
        description: "Маршрутизаторы, коммутаторы, серверы и источники бесперебойного питания.",
        status: "progress", priority: "high", start: "2026-08-20", due: "2026-08-25", dependsOn: [], progress: 50, effortHours: 16, costCategory: "services", plannedCost: 70000, actualCost: 30000,
        subtasks: [
          { id: "sub-m1", text: "Собрать IP-адреса", done: true },
          { id: "sub-m2", text: "Назначить группы устройств", done: false },
        ],
      },
      {
        id: "task-m2", title: "Настроить базовые проверки",
        description: "Доступность, загрузка интерфейсов, температура и свободное место.",
        status: "todo", priority: "medium", start: "2026-08-26", due: "2026-08-29", dependsOn: ["task-m1"], progress: 0, effortHours: 28, costCategory: "software", plannedCost: 260000, actualCost: 0, subtasks: [],
      },
    ],
  },
];

const emptyTask = { title: "", description: "", status: "todo", priority: "medium", start: "", due: "", dependsOn: [], progress: 0, effortHours: 8, costCategory: "other", plannedCost: 0, actualCost: 0, assigneeKey: "", completedAt: null, createdAt: null, updatedAt: null, subtasks: [] };
const emptyProject = { name: "", description: "", color: "#ea6a34", budget: 0 };

const seededDependencies = {
  "task-1": [], "task-2": ["task-1"], "task-3": ["task-2"], "task-4": [], "task-5": [], "task-6": [],
  "task-m1": [], "task-m2": ["task-m1"],
};
const seededCosts = {
  "task-1": { costCategory: "services", plannedCost: 60000, actualCost: 40000 },
  "task-2": { costCategory: "equipment", plannedCost: 975000, actualCost: 720000 },
  "task-3": { costCategory: "services", plannedCost: 90000, actualCost: 25000 },
  "task-4": { costCategory: "equipment", plannedCost: 85000, actualCost: 65000 },
  "task-5": { costCategory: "services", plannedCost: 20000, actualCost: 20000 },
  "task-6": { costCategory: "services", plannedCost: 10000, actualCost: 10000 },
  "task-m1": { costCategory: "services", plannedCost: 70000, actualCost: 30000 },
  "task-m2": { costCategory: "software", plannedCost: 260000, actualCost: 0 },
};
const seededProjectBudgets = { "project-server": 1350000, "project-monitoring": 500000 };
const seededProjectRisks = { "project-server": serverRisks, "project-monitoring": monitoringRisks };
const seededEffortHours = { "task-1": 24, "task-2": 32, "task-3": 24, "task-4": 20, "task-5": 16, "task-6": 8, "task-m1": 16, "task-m2": 28 };
const seededProjectTimeEntries = { "project-server": serverTimeEntries, "project-monitoring": monitoringTimeEntries };
const seededProjectResources = { "project-server": serverResources, "project-monitoring": monitoringResources };
const seededClientPortals = { "project-server": serverClientPortal, "project-monitoring": monitoringClientPortal };

function clampProgress(value) { return Math.min(100, Math.max(0, Number(value) || 0)); }
function normalizeSubtask(item) { return { id: item.id, text: item.text || "", done: Boolean(item.done), due: item.due || "", completedAt: item.completedAt || null, createdAt: item.createdAt || null }; }
function inferStartDate(due) {
  if (!due) return "";
  const date = new Date(`${due}T12:00:00`);
  date.setDate(date.getDate() - 3);
  return localISO(date);
}
function normalizeTask(task) {
  const seededCost = seededCosts[task.id] || {};
  return {
    ...emptyTask,
    ...task,
    start: task.start || inferStartDate(task.due),
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : (seededDependencies[task.id] || []),
    costCategory: task.costCategory || seededCost.costCategory || "other",
    plannedCost: Math.max(0, Number(task.plannedCost ?? seededCost.plannedCost) || 0),
    actualCost: Math.max(0, Number(task.actualCost ?? seededCost.actualCost) || 0),
    effortHours: Math.min(500, Math.max(1, Number(task.effortHours ?? seededEffortHours[task.id]) || 8)),
    subtasks: Array.isArray(task.subtasks) ? task.subtasks.map(normalizeSubtask) : [],
  };
}
function formatDate(value) {
  if (!value) return "Без срока";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`));
}
function localISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function daysUntil(value) {
  if (!value) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((new Date(`${value}T12:00:00`) - today) / 86400000);
}
function deadlineMeta(item, completed = item.status === "done") {
  if (!item.due) return { state: "noDue", className: "no-due", label: "Без срока" };
  if (completed) return { state: "done", className: "done", label: `Завершено · ${formatDate(item.due)}` };
  const days = daysUntil(item.due);
  if (days < 0) return { state: "overdue", className: "overdue", label: `${Math.abs(days)} дн. просрочено · ${formatDate(item.due)}` };
  if (days === 0) return { state: "today", className: "today", label: `Сегодня · ${formatDate(item.due)}` };
  if (days <= 3) return { state: "soon", className: "soon", label: `Через ${days} дн. · ${formatDate(item.due)}` };
  return { state: "planned", className: "planned", label: formatDate(item.due) };
}
function taskDeadlineStates(task) {
  return [deadlineMeta(task).state, ...(task.subtasks || []).map((item) => deadlineMeta(item, item.done).state)];
}
function taskUrgency(task) {
  const states = taskDeadlineStates(task);
  return ["overdue", "today", "soon"].find((state) => states.includes(state)) || deadlineMeta(task).className;
}
function earliestPendingDue(task) {
  return [
    ...(task.status !== "done" && task.due ? [task.due] : []),
    ...(task.subtasks || []).filter((item) => !item.done && item.due).map((item) => item.due),
  ].sort()[0] || "9999";
}
function taskMatchesDeadline(task, filter) {
  if (filter === "all") return true;
  const states = taskDeadlineStates(task);
  if (filter === "noDue") return !task.due && (task.subtasks || []).every((item) => !item.due);
  return states.includes(filter);
}
function calculatedProgress(task) {
  if (!task.subtasks?.length) return clampProgress(task.progress);
  return Math.round((task.subtasks.filter((item) => item.done).length / task.subtasks.length) * 100);
}

function normalizeRisk(item) {
  return {
    type: "risk", title: "", description: "", probability: 3, impact: 3, status: "open", ownerKey: "", due: "", taskId: "", mitigation: "", createdAt: null, updatedAt: null,
    ...item,
    probability: item.type === "issue" ? 5 : Math.min(5, Math.max(1, Number(item.probability) || 3)),
    impact: Math.min(5, Math.max(1, Number(item.impact) || 3)),
  };
}

function normalizeTimeEntry(item) {
  return {
    id: item.id || `time-${item.taskId || "entry"}-${item.createdAt || item.date || Date.now()}`,
    taskId: item.taskId || "",
    memberKey: item.memberKey || "",
    memberName: item.memberName || "Участник",
    date: item.date || localISO(new Date()),
    minutes: Math.min(1440, Math.max(1, Number(item.minutes) || 1)),
    note: item.note || "",
    createdAt: item.createdAt || null,
  };
}

function normalizeState(value, preferredActiveId = null, clientMode = false) {
  if (!value || !Array.isArray(value.projects) || !value.projects.length) return null;
  const normalizedProjects = value.projects.map((project) => ({
    ...project,
    budget: clientMode ? 0 : Math.max(0, Number(project.budget ?? seededProjectBudgets[project.id]) || 0),
    teamCapacity: project.teamCapacity && typeof project.teamCapacity === "object" ? project.teamCapacity : {},
    tasks: (project.tasks || []).map((task) => clientMode ? { ...normalizeTask(task), priority: "medium", dependsOn: [], effortHours: 0, costCategory: "other", plannedCost: 0, actualCost: 0, assigneeKey: "" } : normalizeTask(task)),
    risks: clientMode ? [] : (Array.isArray(project.risks) ? project.risks : (seededProjectRisks[project.id] || [])).map(normalizeRisk),
    timeEntries: clientMode ? [] : (Array.isArray(project.timeEntries) ? project.timeEntries : (seededProjectTimeEntries[project.id] || [])).map(normalizeTimeEntry),
    activeTimers: project.activeTimers && typeof project.activeTimers === "object" ? project.activeTimers : {},
    integrations: clientMode ? [] : Array.isArray(project.integrations) ? project.integrations : [],
    integrationLog: clientMode ? [] : Array.isArray(project.integrationLog) ? project.integrationLog : [],
    assistantMessages: clientMode ? [] : Array.isArray(project.assistantMessages) ? project.assistantMessages.slice(-50) : [],
    resources: clientMode ? [] : Array.isArray(project.resources) ? project.resources : (seededProjectResources[project.id] || []),
    clientPortal: { ...(seededClientPortals[project.id] || { clientName: "Клиентский портал", greeting: "Актуальный статус проекта и согласованные материалы.", contactName: "Руководитель проекта", contactEmail: "", nextUpdate: "", publishedTaskIds: [] }), ...(project.clientPortal && typeof project.clientPortal === "object" ? project.clientPortal : {}), publishedTaskIds: Array.isArray(project.clientPortal?.publishedTaskIds) ? project.clientPortal.publishedTaskIds : (seededClientPortals[project.id]?.publishedTaskIds || []) },
  }));
  const activeProjectId = normalizedProjects.some((project) => project.id === preferredActiveId)
    ? preferredActiveId
    : normalizedProjects.some((project) => project.id === value.activeProjectId) ? value.activeProjectId : normalizedProjects[0].id;
  return { projects: normalizedProjects, activeProjectId };
}

export default function App() {
  const [projects, setProjects] = useState(initialProjects);
  const [activeProjectId, setActiveProjectId] = useState(initialProjects[0].id);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [deadlineFilter, setDeadlineFilter] = useState("all");
  const [sort, setSort] = useState("priority");
  const [view, setView] = useState("board");
  const [month, setMonth] = useState(() => new Date(2026, 7, 1));
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [taskDraft, setTaskDraft] = useState(emptyTask);
  const [projectDraft, setProjectDraft] = useState(emptyProject);
  const [subtaskInput, setSubtaskInput] = useState("");
  const [menuId, setMenuId] = useState(null);
  const [draggedId, setDraggedId] = useState(null);
  const [toast, setToast] = useState("");
  const [syncStatus, setSyncStatus] = useState("connecting");
  const [accessDenied, setAccessDenied] = useState("");
  const [reportData, setReportData] = useState({ events: [], snapshots: [] });
  const [reportStatus, setReportStatus] = useState("idle");
  const [collaboration, setCollaboration] = useState({ actor: null, members: [], comments: [] });
  const [collaborationStatus, setCollaborationStatus] = useState("idle");
  const [collaborationModalOpen, setCollaborationModalOpen] = useState(false);
  const [inviteDraft, setInviteDraft] = useState({ name: "", email: "", role: "editor" });
  const [commentInput, setCommentInput] = useState("");
  const [confirmProjectDelete, setConfirmProjectDelete] = useState(false);
  const [fileFocusTaskId, setFileFocusTaskId] = useState("");
  const [riskFocusTaskId, setRiskFocusTaskId] = useState("");
  const [timeFocusTaskId, setTimeFocusTaskId] = useState("");
  const importRef = useRef(null);
  const cloudReadyRef = useRef(false);
  const saveTimerRef = useRef(null);
  const revisionRef = useRef(0);
  const skipCloudSaveRef = useRef(false);
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    async function initialize() {
      let clientMode = false;
      try {
        const collaborationResponse = await fetch("/api/collaboration", { cache: "no-store" });
        if (collaborationResponse.ok) {
          const collaborationData = await collaborationResponse.json();
          clientMode = collaborationData.actor?.role === "client";
          if (mounted) {
            setCollaboration({ actor: collaborationData.actor || null, members: collaborationData.members || [], comments: collaborationData.comments || [] });
            setCollaborationStatus("ready");
          }
        }
      } catch { /* основной запрос состояния определит доступ повторно */ }

      let localState = { projects: initialProjects, activeProjectId: initialProjects[0].id };
      try { if (!clientMode) {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          localState = normalizeState(JSON.parse(saved)) || localState;
        } else {
          const oldTasks = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY) || "null");
          if (Array.isArray(oldTasks) && oldTasks.length) {
            const migrated = [{ ...initialProjects[0], tasks: oldTasks.map(normalizeTask) }, initialProjects[1]];
            localState = { projects: migrated, activeProjectId: migrated[0].id };
          }
        }
      } } catch {
        localState = { projects: initialProjects, activeProjectId: initialProjects[0].id };
      }
      if (!mounted) return;
      if (!clientMode) {
        setProjects(localState.projects);
        setActiveProjectId(localState.activeProjectId);
      }

      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (response.status === 401 || response.status === 403) {
          if (mounted) {
            setAccessDenied(response.status === 401 ? "signin" : "forbidden");
            setHydrated(true);
          }
          return;
        }
        if (!response.ok) throw new Error("cloud unavailable");
        const result = await response.json();
        revisionRef.current = Number(result.revision || 0);
        if (result.actor) setCollaboration((current) => ({ ...current, actor: result.actor }));
        const resultClientMode = result.actor?.role === "client";
        const cloudState = normalizeState(result.data, localState.activeProjectId, resultClientMode);
        if (cloudState) {
          if (!mounted) return;
          skipCloudSaveRef.current = true;
          setProjects(cloudState.projects);
          setActiveProjectId(cloudState.activeProjectId);
        } else if (!resultClientMode) {
          const seedResponse = await fetch("/api/state", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: { projects: localState.projects }, baseRevision: revisionRef.current }),
          });
          if (!seedResponse.ok) throw new Error("cloud seed failed");
          const seeded = await seedResponse.json();
          revisionRef.current = Number(seeded.revision || 1);
        }
        if (resultClientMode) {
          cloudReadyRef.current = false;
          setView("client");
        } else cloudReadyRef.current = true;
        if (mounted) {
          setSyncStatus("synced");
          setHydrated(true);
        }
      } catch {
        cloudReadyRef.current = false;
        if (mounted) {
          setSyncStatus("local");
          if (clientMode) {
            setProjects([{ id: "client-portal", name: "Клиентский портал", description: "Данные временно недоступны.", color: "#2a8a68", tasks: [], clientPortal: {} }]);
            setActiveProjectId("client-portal");
            setView("client");
          }
          setHydrated(true);
        }
      }
    }
    initialize();
    return () => {
      mounted = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (hydrated && collaboration.actor?.role !== "client") localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects, activeProjectId }));
  }, [projects, activeProjectId, hydrated, collaboration.actor?.role]);

  useEffect(() => {
    if (!hydrated || !cloudReadyRef.current) return undefined;
    if (skipCloudSaveRef.current) { skipCloudSaveRef.current = false; return undefined; }
    setSyncStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      saveInFlightRef.current = true;
      try {
        const response = await fetch("/api/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: { projects }, baseRevision: revisionRef.current }),
        });
        if (response.status === 409) {
          const conflict = await response.json();
          const serverState = normalizeState(conflict.data, activeProjectId);
          revisionRef.current = Number(conflict.revision || revisionRef.current);
          if (serverState) {
            skipCloudSaveRef.current = true;
            setProjects(serverState.projects);
            setActiveProjectId(serverState.activeProjectId);
          }
          setSyncStatus("synced");
          announce(`Получены более новые изменения${conflict.updatedBy ? ` от ${conflict.updatedBy}` : ""}`);
          return;
        }
        if (!response.ok) throw new Error("save failed");
        const saved = await response.json();
        revisionRef.current = Number(saved.revision || revisionRef.current + 1);
        setSyncStatus("synced");
      } catch {
        cloudReadyRef.current = false;
        setSyncStatus("local");
      } finally {
        saveInFlightRef.current = false;
      }
    }, 700);
    return () => clearTimeout(saveTimerRef.current);
  }, [projects, hydrated]);

  useEffect(() => {
    if (!hydrated) return undefined;
    const interval = setInterval(async () => {
      if (!cloudReadyRef.current || saveInFlightRef.current) return;
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json();
        if (Number(result.revision || 0) <= revisionRef.current) return;
        const incoming = normalizeState(result.data, activeProjectId);
        revisionRef.current = Number(result.revision);
        if (incoming) {
          skipCloudSaveRef.current = true;
          setProjects(incoming.projects);
          setActiveProjectId(incoming.activeProjectId);
          announce(`Обновлено${result.updatedBy ? ` · ${result.updatedBy}` : " другим участником"}`);
        }
      } catch { /* следующий опрос повторит попытку */ }
    }, 8000);
    return () => clearInterval(interval);
  }, [hydrated, activeProjectId]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = setTimeout(() => setToast(""), 2300);
    return () => clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (view === "reports") loadReports();
  }, [view]);

  useEffect(() => {
    if (!taskModalOpen && !collaborationModalOpen) return undefined;
    const interval = setInterval(() => loadCollaboration(true), 10000);
    return () => clearInterval(interval);
  }, [taskModalOpen, collaborationModalOpen]);

  const activeProject = projects.find((project) => project.id === activeProjectId) || projects[0];
  const tasks = activeProject?.tasks || [];
  const activeMembers = collaboration.members.filter((member) => member.role !== "client" && (member.status === "active" || member.status === "invited"));
  const workloadMembers = activeMembers.length ? activeMembers : [{ member_key: "local-preview", display_name: collaboration.actor?.name || "Руководитель проекта", role: "owner", status: "active", synthetic: true }];
  const memberByKey = useMemo(() => new Map(activeMembers.map((member) => [member.member_key, member])), [collaboration.members]);
  const isClient = collaboration.actor?.role === "client";
  const canEdit = !collaboration.actor || collaboration.actor.role === "owner" || collaboration.actor.role === "editor";
  const filteredTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter((task) => {
      const subtaskText = (task.subtasks || []).map((item) => item.text).join(" ");
      return `${task.title} ${task.description} ${subtaskText}`.toLowerCase().includes(needle)
        && (priorityFilter === "all" || task.priority === priorityFilter)
        && (assigneeFilter === "all" || (assigneeFilter === "unassigned" ? !task.assigneeKey : task.assigneeKey === assigneeFilter))
        && taskMatchesDeadline(task, deadlineFilter);
    }).sort((a, b) => {
      if (sort === "due") return earliestPendingDue(a).localeCompare(earliestPendingDue(b));
      if (sort === "progress") return calculatedProgress(b) - calculatedProgress(a);
      return priorities[a.priority].rank - priorities[b.priority].rank;
    });
  }, [tasks, query, priorityFilter, assigneeFilter, deadlineFilter, sort]);

  const stats = useMemo(() => {
    const done = tasks.filter((task) => task.status === "done").length;
    const inProgress = tasks.filter((task) => task.status === "progress").length;
    const deadlineItems = tasks.flatMap((task) => [
      { ...task, completed: task.status === "done" },
      ...(task.subtasks || []).map((item) => ({ ...item, completed: item.done })),
    ]);
    const overdue = deadlineItems.filter((item) => deadlineMeta(item, item.completed).state === "overdue").length;
    const today = deadlineItems.filter((item) => deadlineMeta(item, item.completed).state === "today").length;
    const soon = deadlineItems.filter((item) => deadlineMeta(item, item.completed).state === "soon").length;
    const avg = tasks.length ? Math.round(tasks.reduce((sum, task) => sum + calculatedProgress(task), 0) / tasks.length) : 0;
    return { done, inProgress, overdue, today, soon, avg };
  }, [tasks]);

  const calendarEntries = useMemo(() => filteredTasks.flatMap((task) => [
    ...(task.due ? [{ id: task.id, task, title: task.title, due: task.due, kind: "task", done: task.status === "done" }] : []),
    ...(task.subtasks || []).filter((item) => item.due).map((item) => ({
      id: `${task.id}-${item.id}`, task, title: item.text, due: item.due, kind: "subtask", done: item.done,
    })),
  ]), [filteredTasks]);

  const calendarDays = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, index) => new Date(month.getFullYear(), month.getMonth(), 1 - mondayOffset + index));
  }, [month]);

  function announce(message) { setToast(message); }
  async function loadReports() {
    setReportStatus("loading");
    try {
      const response = await fetch("/api/reports", { cache: "no-store" });
      if (!response.ok) throw new Error("reports unavailable");
      const data = await response.json();
      setReportData({ events: Array.isArray(data.events) ? data.events : [], snapshots: Array.isArray(data.snapshots) ? data.snapshots : [] });
      setReportStatus("ready");
    } catch {
      setReportStatus("error");
    }
  }
  function applyCollaborationPayload(data) {
    setCollaboration({
      actor: data.actor || collaboration.actor,
      members: Array.isArray(data.members) ? data.members : [],
      comments: Array.isArray(data.comments) ? data.comments : [],
    });
  }
  async function loadCollaboration(silent = false) {
    if (!silent) setCollaborationStatus("loading");
    try {
      const response = await fetch("/api/collaboration", { cache: "no-store" });
      if (!response.ok) throw new Error("collaboration unavailable");
      applyCollaborationPayload(await response.json());
      if (!silent) setCollaborationStatus("ready");
    } catch {
      if (!silent) setCollaborationStatus("error");
    }
  }
  async function collaborationAction(payload, successMessage) {
    setCollaborationStatus("loading");
    try {
      const response = await fetch("/api/collaboration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "action failed");
      applyCollaborationPayload(data);
      setCollaborationStatus("ready");
      if (successMessage) announce(successMessage);
      return true;
    } catch (error) {
      setCollaborationStatus("error");
      announce(error.message === "action failed" ? "Не удалось выполнить действие" : error.message);
      return false;
    }
  }
  async function inviteMember(event) {
    event.preventDefault();
    const added = await collaborationAction({ action: "invite", ...inviteDraft }, "Участник добавлен в рабочее пространство");
    if (added) setInviteDraft({ name: "", email: "", role: "editor" });
  }
  async function addComment(event) {
    event.preventDefault();
    if (!commentInput.trim() || !editingTaskId) return;
    const added = await collaborationAction({ action: "add_comment", projectId: activeProjectId, taskId: editingTaskId, text: commentInput }, "Комментарий добавлен");
    if (added) setCommentInput("");
  }
  async function retryCloudSync() {
    setSyncStatus("connecting");
    const localState = { projects };
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok) throw new Error("cloud unavailable");
      const result = await response.json();
      revisionRef.current = Number(result.revision || 0);
      const cloudState = normalizeState(result.data, activeProjectId);
      if (cloudState) {
        skipCloudSaveRef.current = true;
        setProjects(cloudState.projects);
        setActiveProjectId(cloudState.activeProjectId);
      } else {
        const seedResponse = await fetch("/api/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: localState, baseRevision: revisionRef.current }),
        });
        if (!seedResponse.ok) throw new Error("cloud seed failed");
        const seeded = await seedResponse.json();
        revisionRef.current = Number(seeded.revision || 1);
      }
      cloudReadyRef.current = true;
      setSyncStatus("synced");
      loadCollaboration();
      announce("Облачная синхронизация подключена");
    } catch {
      cloudReadyRef.current = false;
      setSyncStatus("local");
      announce("Облако временно недоступно");
    }
  }
  function updateTasks(updater) {
    if (!canEdit) { announce("У вас режим наблюдателя"); return; }
    setProjects((current) => current.map((project) => project.id === activeProjectId
      ? { ...project, tasks: typeof updater === "function" ? updater(project.tasks || []) : updater }
      : project));
  }
  function updateRisks(risks) {
    if (!canEdit) { announce("У вас режим наблюдателя"); return; }
    setProjects((current) => current.map((project) => project.id === activeProjectId ? { ...project, risks } : project));
    announce("Реестр рисков обновлён");
  }
  function updateTeamTasks(nextTasks, message) {
    updateTasks(nextTasks);
    announce(message || "Загрузка команды обновлена");
  }
  function updateTeamCapacity(memberKey, value) {
    if (!canEdit) { announce("У вас режим наблюдателя"); return; }
    const capacity = Math.min(80, Math.max(4, Number(value) || 40));
    setProjects((current) => current.map((project) => project.id === activeProjectId
      ? { ...project, teamCapacity: { ...(project.teamCapacity || {}), [memberKey]: capacity } }
      : project));
    announce("Недельная норма обновлена");
  }
  function updateTimeData(next, message) {
    if (!canEdit) { announce("У вас режим наблюдателя"); return; }
    setProjects((current) => current.map((project) => project.id === activeProjectId ? {
      ...project,
      timeEntries: Array.isArray(next.timeEntries) ? next.timeEntries : (project.timeEntries || []),
      activeTimers: next.activeTimers && typeof next.activeTimers === "object" ? next.activeTimers : (project.activeTimers || {}),
    } : project));
    announce(message || "Учёт времени обновлён");
  }
  function updateIntegrationData(next, message) {
    if (!canEdit) { announce("У вас режим наблюдателя"); return; }
    setProjects((current) => current.map((project) => project.id === activeProjectId ? {
      ...project,
      integrations: Array.isArray(next.integrations) ? next.integrations : (project.integrations || []),
      integrationLog: Array.isArray(next.integrationLog) ? next.integrationLog : (project.integrationLog || []),
    } : project));
    announce(message || "Интеграции обновлены");
  }
  function updateAssistantMessages(messages, message) {
    if (!canEdit) { announce("У вас режим наблюдателя"); return; }
    setProjects((current) => current.map((project) => project.id === activeProjectId ? { ...project, assistantMessages: Array.isArray(messages) ? messages.slice(-50) : [] } : project));
    if (message) announce(message);
  }
  function updateResources(resources, message) {
    if (!canEdit) { announce("У вас режим наблюдателя"); return; }
    setProjects((current) => current.map((project) => project.id === activeProjectId ? { ...project, resources: Array.isArray(resources) ? resources : [] } : project));
    announce(message || "Реестр ресурсов обновлён");
  }
  function updateClientPortal(clientPortal) {
    if (!canEdit) return;
    setProjects((current) => current.map((project) => project.id === activeProjectId ? { ...project, clientPortal } : project));
  }
  function openNewTask(status = "todo", due = "") {
    setEditingTaskId(null);
    setTaskDraft({ ...emptyTask, status, start: due ? inferStartDate(due) : "", due, dependsOn: [], progress: status === "done" ? 100 : 0, subtasks: [] });
    setSubtaskInput("");
    setTaskModalOpen(true);
  }
  function openEditTask(task) {
    setEditingTaskId(task.id);
    setTaskDraft({ ...normalizeTask(task), subtasks: task.subtasks.map((item) => ({ ...item })) });
    setSubtaskInput("");
    setMenuId(null);
    setTaskModalOpen(true);
    if (collaborationStatus === "idle" || collaborationStatus === "error") loadCollaboration();
  }
  function openNotificationItem(item) {
    const project = projects.find((entry) => entry.id === item.projectId);
    if (project) setActiveProjectId(project.id);
    if (item.type?.startsWith("risk_") || item.type?.startsWith("issue_")) {
      setRiskFocusTaskId(item.taskId || "");
      setView("risks");
      return;
    }
    if (item.type?.startsWith("time_") || item.type?.startsWith("timer_")) {
      setTimeFocusTaskId(item.taskId || "");
      setView("time");
      return;
    }
    if (item.type?.startsWith("integration_")) {
      setView("integrations");
      return;
    }
    if (item.type?.startsWith("assistant_")) {
      setView("assistant");
      return;
    }
    if (item.type?.startsWith("resource_")) {
      setView("resources");
      return;
    }
    if (item.type?.startsWith("client_")) {
      setView("client");
      return;
    }
    if (item.category === "files") {
      setFileFocusTaskId(item.taskId || "");
      setView("files");
      return;
    }
    const task = project?.tasks?.find((entry) => entry.id === item.taskId);
    if (task) openEditTask(task);
    else if (project) setView("board");
  }
  function saveTask(event) {
    event.preventDefault();
    if (!canEdit) { announce("У вас режим наблюдателя"); return; }
    if (!taskDraft.title.trim()) return;
    if (taskDraft.start && taskDraft.due && taskDraft.start > taskDraft.due) { announce("Дата начала не может быть позже срока"); return; }
    const now = new Date().toISOString();
    const previousTask = editingTaskId ? tasks.find((task) => task.id === editingTaskId) : null;
    const subtaskProgress = taskDraft.subtasks.length
      ? Math.round((taskDraft.subtasks.filter((item) => item.done).length / taskDraft.subtasks.length) * 100)
      : clampProgress(taskDraft.progress);
    const normalized = {
      ...taskDraft,
      title: taskDraft.title.trim(),
      description: taskDraft.description.trim(),
      start: taskDraft.start || "",
      due: taskDraft.due || "",
      dependsOn: (taskDraft.dependsOn || []).filter((id) => id !== editingTaskId && tasks.some((task) => task.id === id)),
      costCategory: costCategories[taskDraft.costCategory] ? taskDraft.costCategory : "other",
      plannedCost: Math.max(0, Number(taskDraft.plannedCost) || 0),
      actualCost: Math.max(0, Number(taskDraft.actualCost) || 0),
      effortHours: Math.min(500, Math.max(1, Number(taskDraft.effortHours) || 8)),
      progress: taskDraft.status === "done" ? 100 : subtaskProgress,
      completedAt: taskDraft.status === "done" ? (taskDraft.completedAt || (previousTask?.status !== "done" ? now : null)) : null,
      createdAt: taskDraft.createdAt || now,
      updatedAt: now,
      subtasks: taskDraft.subtasks.filter((item) => item.text.trim()).map((item) => ({ ...item, text: item.text.trim(), createdAt: item.createdAt || now, completedAt: item.done ? item.completedAt || null : null })),
    };
    if (editingTaskId) {
      updateTasks((current) => current.map((task) => task.id === editingTaskId ? { ...task, ...normalized } : task));
      announce("Задача обновлена");
    } else {
      updateTasks((current) => [{ ...normalized, id: `task-${Date.now()}` }, ...current]);
      announce("Задача добавлена");
    }
    setTaskModalOpen(false);
  }
  function deleteTask(id) {
    updateTasks((current) => current.filter((task) => task.id !== id).map((task) => ({ ...task, dependsOn: (task.dependsOn || []).filter((parentId) => parentId !== id) })));
    setMenuId(null);
    setTaskModalOpen(false);
    announce("Задача удалена");
  }
  function moveTask(id, status) {
    const now = new Date().toISOString();
    updateTasks((current) => current.map((task) => task.id === id
      ? { ...task, status, progress: status === "done" ? 100 : task.status === "done" ? Math.min(80, calculatedProgress(task)) : calculatedProgress(task), completedAt: status === "done" ? task.completedAt || now : null, updatedAt: now }
      : task));
    announce(status === "done" ? "Задача завершена" : "Статус обновлён");
  }
  function updateProgress(id, progress) {
    const value = clampProgress(progress);
    const now = new Date().toISOString();
    updateTasks((current) => current.map((task) => task.id === id
      ? { ...task, progress: value, status: value === 100 ? "done" : task.status === "done" ? "progress" : task.status, completedAt: value === 100 ? task.completedAt || now : null, updatedAt: now }
      : task));
  }
  function toggleTaskSubtask(taskId, subtaskId) {
    const now = new Date().toISOString();
    updateTasks((current) => current.map((task) => {
      if (task.id !== taskId) return task;
      const subtasks = task.subtasks.map((item) => item.id === subtaskId ? { ...item, done: !item.done, completedAt: !item.done ? now : null } : item);
      const progress = Math.round((subtasks.filter((item) => item.done).length / subtasks.length) * 100);
      return { ...task, subtasks, progress, status: progress === 100 ? "done" : task.status === "done" ? "progress" : task.status, completedAt: progress === 100 ? task.completedAt || now : null, updatedAt: now };
    }));
  }
  function addDraftSubtask() {
    const text = subtaskInput.trim();
    if (!text) return;
    setTaskDraft((current) => ({ ...current, subtasks: [...current.subtasks, { id: `sub-${Date.now()}`, text, done: false, due: "", completedAt: null, createdAt: new Date().toISOString() }] }));
    setSubtaskInput("");
  }
  function dependencyWouldCycle(candidateId) {
    if (!editingTaskId) return false;
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const visited = new Set();
    const stack = [candidateId];
    while (stack.length) {
      const current = stack.pop();
      if (current === editingTaskId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      stack.push(...(byId.get(current)?.dependsOn || []));
    }
    return false;
  }
  function openNewProject() {
    if (!canEdit) { announce("У вас режим наблюдателя"); return; }
    setEditingProjectId(null);
    setProjectDraft(emptyProject);
    setConfirmProjectDelete(false);
    setProjectModalOpen(true);
  }
  function openProjectSettings() {
    setEditingProjectId(activeProject.id);
    setProjectDraft({ name: activeProject.name, description: activeProject.description || "", color: activeProject.color || "#ea6a34", budget: Math.max(0, Number(activeProject.budget) || 0) });
    setConfirmProjectDelete(false);
    setProjectModalOpen(true);
  }
  function saveProject(event) {
    event.preventDefault();
    if (!canEdit) { announce("У вас режим наблюдателя"); return; }
    if (!projectDraft.name.trim()) return;
    if (editingProjectId) {
      setProjects((current) => current.map((project) => project.id === editingProjectId ? { ...project, ...projectDraft, name: projectDraft.name.trim(), budget: Math.max(0, Number(projectDraft.budget) || 0) } : project));
      announce("Проект обновлён");
    } else {
      const id = `project-${Date.now()}`;
      setProjects((current) => [...current, { ...projectDraft, name: projectDraft.name.trim(), budget: Math.max(0, Number(projectDraft.budget) || 0), id, tasks: [], risks: [], teamCapacity: {}, timeEntries: [], activeTimers: {}, integrations: [], integrationLog: [], assistantMessages: [], resources: [], clientPortal: { clientName: "Клиентский портал", greeting: "Актуальный статус проекта и согласованные материалы.", contactName: collaboration.actor?.name || "Руководитель проекта", contactEmail: collaboration.actor?.email || "", nextUpdate: "", publishedTaskIds: [] } }]);
      setActiveProjectId(id);
      announce("Проект создан");
    }
    setProjectModalOpen(false);
  }
  function deleteProject() {
    if (!canEdit) { announce("У вас режим наблюдателя"); return; }
    if (!confirmProjectDelete) { setConfirmProjectDelete(true); return; }
    const remaining = projects.filter((project) => project.id !== editingProjectId);
    setProjects(remaining);
    setActiveProjectId(remaining[0].id);
    setProjectModalOpen(false);
    announce("Проект удалён");
  }
  function exportBackup() {
    const payload = JSON.stringify({ version: 5, exportedAt: new Date().toISOString(), activeProjectId, projects }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kontur-backup-${localISO(new Date())}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    announce("Резервная копия скачана");
  }
  async function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.projects) || !parsed.projects.length) throw new Error("invalid");
      const restored = normalizeState({ projects: parsed.projects, activeProjectId: parsed.activeProjectId });
      if (!restored) throw new Error("invalid");
      setProjects(restored.projects);
      setActiveProjectId(restored.activeProjectId);
      announce("Резервная копия восстановлена");
    } catch { announce("Не удалось прочитать файл"); }
  }

  if (!hydrated) return <main className="app-loading"><span className="brand-mark"><span /></span><LoaderCircle className="spin" size={24} /><strong>Открываю рабочее пространство…</strong></main>;
  if (accessDenied) return <main className="private-access-gate"><div className="public-share-brand"><span className="brand-mark"><span /></span><strong>КОНТУР</strong><em>РАБОЧЕЕ ПРОСТРАНСТВО</em></div><section><span><ShieldCheck size={27} /></span><span className="section-kicker">Закрытый раздел</span><h1>{accessDenied === "signin" ? "Войдите, чтобы открыть планер" : "Доступ не предоставлен"}</h1><p>{accessDenied === "signin" ? "Внутренние задачи и данные доступны только участникам рабочего пространства." : "Этот аккаунт не добавлен в команду проекта. Обратитесь к владельцу планера."}</p>{accessDenied === "signin" && <a href="/signin-with-chatgpt?return_to=%2F"><ShieldCheck size={16} /> Войти через ChatGPT</a>}</section></main>;

  return (
    <main>
      <header className="topbar">
        <div className="brand" aria-label="Контур"><span className="brand-mark"><span /></span><span>КОНТУР</span><em>V18 · ПУБЛИКАЦИЯ</em></div>
        <div className="top-actions">
          <button className={`save-state sync-${syncStatus}`} onClick={syncStatus === "local" ? retryCloudSync : undefined} title={syncStatus === "local" ? "Повторить подключение" : "Состояние синхронизации"}>
            {syncStatus === "synced" && <Cloud size={14} />}
            {(syncStatus === "connecting" || syncStatus === "saving") && <LoaderCircle className="spin" size={14} />}
            {syncStatus === "local" && <CloudOff size={14} />}
            {syncStatus === "synced" ? "Сохранено в облаке" : syncStatus === "saving" ? "Сохраняю…" : syncStatus === "connecting" ? "Подключение…" : "Только локально"}
          </button>
          {!isClient && <PwaInstall />}
          {!isClient && <NotificationCenter onOpenItem={openNotificationItem} />}
          {!isClient && <button className="team-button" onClick={() => { setCollaborationModalOpen(true); loadCollaboration(); }} title="Участники рабочего пространства"><Users size={15} /><span>{collaboration.members.length || 1}</span></button>}
          <button className="avatar" title={collaboration.actor?.name || "Личный профиль"} aria-label="Личный профиль">{(collaboration.actor?.name || "ИМ").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</button>
        </div>
      </header>

      <section className="hero shell">
        <div className="project-switcher">
          <FolderKanban size={16} />
          <select value={activeProjectId} onChange={(event) => { setActiveProjectId(event.target.value); setQuery(""); setDeadlineFilter("all"); setFileFocusTaskId(""); setRiskFocusTaskId(""); setTimeFocusTaskId(""); }} aria-label="Выбрать проект">
            {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
          </select>
          {canEdit && <button onClick={openNewProject} title="Новый проект" aria-label="Новый проект"><Plus size={17} /></button>}
          {canEdit && <button onClick={openProjectSettings} title="Настройки проекта" aria-label="Настройки проекта"><Settings2 size={16} /></button>}
        </div>
        <div className="hero-row">
          <div><div className="eyebrow"><Sparkles size={14} /> {isClient ? "Клиентский доступ" : `Рабочее пространство · ${projects.length} ${projects.length === 1 ? "проект" : "проекта"}`}</div><h1>{activeProject?.name}</h1><p>{activeProject?.description || "Задачи, сроки и прогресс проекта в одном месте."}</p></div>
          {canEdit ? <button className="primary-button" onClick={() => openNewTask()}><Plus size={18} strokeWidth={2.4} /> Новая задача</button> : <span className="viewer-badge"><ShieldCheck size={16} /> {isClient ? "Безопасный клиентский режим" : "Режим наблюдателя"}</span>}
        </div>
      </section>

      {!isClient && view !== "reports" && <><section className="dashboard shell" aria-label="Прогресс проекта">
        <div className="progress-card" style={{ "--project-color": activeProject?.color || "#ea6a34" }}><div className="progress-ring" style={{ "--progress": `${stats.avg * 3.6}deg` }}><div><strong>{stats.avg}%</strong><span>готово</span></div></div><div className="progress-copy"><span className="section-kicker">Общий прогресс</span><h2>{stats.avg >= 70 ? "Финиш уже близко" : stats.avg >= 35 ? "Движемся по плану" : "Проект набирает ход"}</h2><p>{stats.done} из {tasks.length} задач завершено</p></div></div>
        <div className="metric-card"><span className="metric-icon warm"><Clock3 size={18} /></span><div><strong>{stats.inProgress}</strong><span>В работе</span></div></div>
        <button className={`metric-card deadline-metric ${deadlineFilter === "today" ? "active" : ""}`} onClick={() => { setDeadlineFilter(deadlineFilter === "today" ? "all" : "today"); setView("board"); }}><span className="metric-icon blue"><CalendarDays size={18} /></span><div><strong>{stats.today}</strong><span>Сегодня</span></div></button>
        <button className={`metric-card deadline-metric ${deadlineFilter === "soon" ? "active" : ""}`} onClick={() => { setDeadlineFilter(deadlineFilter === "soon" ? "all" : "soon"); setView("board"); }}><span className="metric-icon warm"><Clock3 size={18} /></span><div><strong>{stats.soon}</strong><span>Ближайшие 3 дня</span></div></button>
        <button className={`metric-card deadline-metric ${deadlineFilter === "overdue" ? "active" : ""}`} onClick={() => { setDeadlineFilter(deadlineFilter === "overdue" ? "all" : "overdue"); setView("board"); }}><span className={`metric-icon ${stats.overdue ? "red" : "green"}`}><CircleAlert size={18} /></span><div><strong>{stats.overdue}</strong><span>Просрочено</span></div></button>
      </section>

      <section className={`deadline-summary shell ${stats.overdue ? "has-risk" : "is-calm"}`} aria-live="polite">
        <div className="deadline-summary-icon">{stats.overdue ? <CircleAlert size={19} /> : <CheckCircle2 size={19} />}</div>
        <div><strong>{stats.overdue ? "Есть сроки, которые требуют внимания" : stats.today ? "План на сегодня сформирован" : "Критичных просрочек нет"}</strong><span>{stats.overdue} просрочено · {stats.today} на сегодня · {stats.soon} в ближайшие 3 дня</span></div>
        {stats.overdue > 0 && <button onClick={() => { setDeadlineFilter("overdue"); setView("board"); }}>Показать просроченные</button>}
      </section></>}

      <section className="workspace shell">
        <div className="toolbar">
          {isClient ? <div className="client-only-toolbar"><BriefcaseBusiness size={17} /><div><strong>Клиентский портал</strong><span>Показаны только опубликованные данные проекта</span></div></div> : <>
          {view !== "client" && view !== "reports" && view !== "budget" && view !== "files" && view !== "risks" && view !== "workload" && view !== "time" && view !== "integrations" && view !== "assistant" && view !== "resources" && <><div className="search-wrap"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти задачу или подзадачу..." />{query && <button onClick={() => setQuery("")} aria-label="Очистить поиск"><X size={15} /></button>}</div>
          <label className="select-wrap"><SlidersHorizontal size={16} /><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="all">Все приоритеты</option><option value="high">Высокий</option><option value="medium">Средний</option><option value="low">Низкий</option></select><ChevronDown size={14} /></label>
          <label className="select-wrap assignee-filter"><UserRound size={16} /><select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}><option value="all">Все исполнители</option><option value="unassigned">Не назначено</option>{activeMembers.map((member) => <option key={member.member_key} value={member.member_key}>{member.display_name}</option>)}</select><ChevronDown size={14} /></label>
          <label className={`select-wrap deadline-select ${deadlineFilter !== "all" ? "active" : ""}`}><Clock3 size={16} /><select value={deadlineFilter} onChange={(event) => setDeadlineFilter(event.target.value)}>{Object.entries(deadlineFilters).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><ChevronDown size={14} /></label>
          <label className="select-wrap sort-wrap"><ArrowUpDown size={16} /><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="priority">По приоритету</option><option value="due">По сроку</option><option value="progress">По прогрессу</option></select><ChevronDown size={14} /></label></>}
          <div className="view-tabs"><button className={view === "board" ? "active" : ""} onClick={() => setView("board")}><LayoutGrid size={15} /> Доска</button><button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}><CalendarDays size={15} /> Календарь</button><button className={view === "gantt" ? "active" : ""} onClick={() => setView("gantt")}><ChartGantt size={15} /> Гант</button><button className={view === "budget" ? "active" : ""} onClick={() => setView("budget")}><WalletCards size={15} /> Бюджет</button><button className={view === "resources" ? "active" : ""} onClick={() => setView("resources")}><Boxes size={15} /> Ресурсы</button><button className={view === "workload" ? "active" : ""} onClick={() => setView("workload")}><Users size={15} /> Команда</button><button className={view === "time" ? "active" : ""} onClick={() => { setTimeFocusTaskId(""); setView("time"); }}><Timer size={15} /> Время</button><button className={view === "assistant" ? "active" : ""} onClick={() => setView("assistant")}><BotMessageSquare size={15} /> AI</button><button className={view === "integrations" ? "active" : ""} onClick={() => setView("integrations")}><PlugZap size={15} /> Интеграции</button><button className={view === "risks" ? "active" : ""} onClick={() => { setRiskFocusTaskId(""); setView("risks"); }}><ShieldAlert size={15} /> Риски</button><button className={view === "files" ? "active" : ""} onClick={() => { setFileFocusTaskId(""); setView("files"); }}><Paperclip size={15} /> Файлы</button><button className={view === "reports" ? "active" : ""} onClick={() => setView("reports")}><BarChart3 size={15} /> Отчёты</button><button className={view === "client" ? "active" : ""} onClick={() => setView("client")}><BriefcaseBusiness size={15} /> Портал</button></div>
          {view !== "client" && view !== "reports" && view !== "budget" && view !== "files" && view !== "risks" && view !== "workload" && view !== "time" && view !== "integrations" && view !== "assistant" && view !== "resources" && <div className="backup-actions"><button onClick={exportBackup} title="Скачать резервную копию"><Download size={16} /></button><button onClick={() => importRef.current?.click()} title="Восстановить резервную копию"><Upload size={16} /></button><input ref={importRef} type="file" accept="application/json" onChange={importBackup} hidden /></div>}
          </>}
        </div>

        {view === "client" ? (
          <ClientPortalPanel project={activeProject} projects={projects} tasks={tasks} actor={collaboration.actor} canManage={canEdit} onChangeConfig={updateClientPortal} />
        ) : view === "board" ? (
          <div className="board">
            {columns.map((column) => {
              const columnTasks = filteredTasks.filter((task) => task.status === column.id);
              return (
                <div className={`column column-${column.tone}`} key={column.id} onDragOver={(event) => event.preventDefault()} onDrop={() => draggedId && moveTask(draggedId, column.id)}>
                  <div className="column-head"><div><span className="column-dot" /><h3>{column.label}</h3><span className="count">{columnTasks.length}</span></div>{canEdit && <button onClick={() => openNewTask(column.id)}><Plus size={18} /></button>}</div>
                  <div className="column-body">
                    {columnTasks.map((task) => {
                      const progress = calculatedProgress(task);
                      const completedSubtasks = task.subtasks.filter((item) => item.done).length;
                      const deadline = deadlineMeta(task);
                      const urgency = taskUrgency(task);
                      return (
                        <article className={`task-card deadline-${urgency}`} key={task.id} draggable={canEdit} onDragStart={() => canEdit && setDraggedId(task.id)} onDragEnd={() => setDraggedId(null)}>
                          <div className="card-topline"><span className={`priority ${priorities[task.priority].className}`}><span />{priorities[task.priority].label}</span><div className="card-menu-wrap"><button className="icon-button" onClick={() => setMenuId(menuId === task.id ? null : task.id)}><MoreHorizontal size={18} /></button>{menuId === task.id && <div className="card-menu"><button onClick={() => openEditTask(task)}>{canEdit ? "Редактировать" : "Открыть"}</button>{canEdit && task.status !== "done" && <button onClick={() => moveTask(task.id, "done")}>Завершить</button>}{canEdit && <button className="danger" onClick={() => deleteTask(task.id)}>Удалить</button>}</div>}</div></div>
                          <button className="task-main" onClick={() => openEditTask(task)}><h4>{task.title}</h4><p>{task.description || "Без описания"}</p></button>
                          {task.assigneeKey && memberByKey.get(task.assigneeKey) && <div className="assignee-chip"><span>{memberByKey.get(task.assigneeKey).display_name.slice(0, 1).toUpperCase()}</span><strong>{memberByKey.get(task.assigneeKey).display_name}</strong></div>}
                          {task.subtasks.length > 0 && <div className="card-subtasks"><div className="subtask-summary"><ListChecks size={14} /><span>{completedSubtasks} из {task.subtasks.length} подзадач</span></div>{task.subtasks.slice(0, 2).map((subtask) => { const subDeadline = deadlineMeta(subtask, subtask.done); return <button key={subtask.id} disabled={!canEdit} className={`${subtask.done ? "done" : ""} subtask-${subDeadline.className}`} onClick={() => toggleTaskSubtask(task.id, subtask.id)}>{subtask.done ? <CheckCircle2 size={14} /> : <Circle size={14} />}<span className="subtask-card-text">{subtask.text}</span>{subtask.due && <span className="subtask-card-due">{formatDate(subtask.due)}</span>}</button>; })}</div>}
                          <div className="card-progress"><div><span>Прогресс</span><strong>{progress}%</strong></div><input type="range" min="0" max="100" step="5" value={progress} disabled={!canEdit || task.subtasks.length > 0} onChange={(event) => updateProgress(task.id, event.target.value)} style={{ "--value": `${progress}%` }} /></div>
                          <div className={`due ${deadline.className}`}><CalendarDays size={15} />{deadline.label}</div>
                          <label className="mobile-status"><select value={task.status} disabled={!canEdit} onChange={(event) => moveTask(task.id, event.target.value)}>{columns.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
                        </article>
                      );
                    })}
                    {columnTasks.length === 0 && canEdit && <button className="empty-state" onClick={() => openNewTask(column.id)}><Plus size={18} /> Добавить первую задачу</button>}
                    {canEdit && <button className="add-inline" onClick={() => openNewTask(column.id)}><Plus size={16} /> Добавить задачу</button>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : view === "calendar" ? (
          <div className="calendar-panel">
            <div className="calendar-head"><div><span className="section-kicker">План по срокам</span><h2>{new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(month)}</h2></div><div><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={19} /></button><button className="today-button" onClick={() => setMonth(new Date())}>Сегодня</button><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={19} /></button></div></div>
            <div className="calendar-weekdays">{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="calendar-grid">
              {calendarDays.map((date) => {
                const iso = localISO(date);
                const dayTasks = calendarEntries.filter((item) => item.due === iso);
                const outside = date.getMonth() !== month.getMonth();
                const today = iso === localISO(new Date());
                return <div className={`calendar-day ${outside ? "outside" : ""} ${today ? "today" : ""}`} key={iso}><div className="day-number"><span>{date.getDate()}</span>{canEdit && <button onClick={() => openNewTask("todo", iso)}><Plus size={14} /></button>}</div><div className="day-tasks">{dayTasks.slice(0, 3).map((item) => <button key={item.id} className={`calendar-task ${priorities[item.task.priority].className} ${item.kind === "subtask" ? "is-subtask" : ""} ${item.done ? "is-done" : ""}`} onClick={() => openEditTask(item.task)} title={item.kind === "subtask" ? `Подзадача: ${item.title}` : item.title}><span />{item.kind === "subtask" ? "↳ " : ""}{item.title}</button>)}{dayTasks.length > 3 && <em>+ ещё {dayTasks.length - 3}</em>}</div></div>;
              })}
            </div>
          </div>
        ) : view === "gantt" ? (
          <GanttView tasks={filteredTasks} allTasks={tasks} projectColor={activeProject?.color || "#ea6a34"} onOpenTask={openEditTask} onAddDates={(task) => task ? openEditTask(task) : openNewTask()} canEdit={canEdit} />
        ) : view === "budget" ? (
          <BudgetPanel project={activeProject} tasks={tasks} projectColor={activeProject?.color || "#ea6a34"} canEdit={canEdit} onOpenTask={openEditTask} onOpenProjectSettings={openProjectSettings} />
        ) : view === "resources" ? (
          <ResourcesPanel project={activeProject} tasks={tasks} members={workloadMembers} canEdit={canEdit} onChangeResources={updateResources} onOpenTask={openEditTask} />
        ) : view === "workload" ? (
          <TeamWorkloadPanel project={activeProject} tasks={tasks} members={workloadMembers} canEdit={canEdit} onChangeTasks={updateTeamTasks} onChangeCapacity={updateTeamCapacity} onOpenTask={openEditTask} onOpenTeam={() => { setCollaborationModalOpen(true); loadCollaboration(); }} />
        ) : view === "time" ? (
          <TimeTrackingPanel project={activeProject} tasks={tasks} members={workloadMembers} actor={collaboration.actor} canEdit={canEdit} onChangeTimeData={updateTimeData} onOpenTask={openEditTask} initialTaskId={timeFocusTaskId} />
        ) : view === "integrations" ? (
          <IntegrationsPanel project={activeProject} canEdit={canEdit} onChangeData={updateIntegrationData} />
        ) : view === "assistant" ? (
          <AssistantPanel project={activeProject} members={workloadMembers} actor={collaboration.actor} canEdit={canEdit} onChangeMessages={updateAssistantMessages} onOpenTask={openEditTask} onNavigate={setView} />
        ) : view === "risks" ? (
          <RiskPanel project={activeProject} tasks={tasks} members={activeMembers} canEdit={canEdit} onChangeRisks={updateRisks} onOpenTask={openEditTask} initialTaskId={riskFocusTaskId} />
        ) : view === "files" ? (
          <FilesPanel project={activeProject} tasks={tasks} canEdit={canEdit} onOpenTask={openEditTask} initialTaskId={fileFocusTaskId} />
        ) : <ReportsPanel projects={projects} reportData={reportData} reportStatus={reportStatus} onReload={loadReports} />}
      </section>

      {taskModalOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setTaskModalOpen(false)}>
          <div className="modal task-modal" role="dialog" aria-modal="true">
            <div className="modal-header"><div><span className="section-kicker">Карточка задачи</span><h2>{editingTaskId ? "Редактировать задачу" : "Новая задача"}</h2></div><button className="modal-close" onClick={() => setTaskModalOpen(false)}><X size={20} /></button></div>
            <form onSubmit={saveTask}>
              <fieldset className="task-edit-fields" disabled={!canEdit}>
              <label className="field full"><span>Название</span><input autoFocus value={taskDraft.title} onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })} placeholder="Что нужно сделать?" required /></label>
              <label className="field full"><span>Описание</span><textarea value={taskDraft.description} onChange={(event) => setTaskDraft({ ...taskDraft, description: event.target.value })} placeholder="Коротко опишите ожидаемый результат" rows="3" /></label>
              <div className="form-grid">
                <label className="field"><span>Статус</span><select value={taskDraft.status} onChange={(event) => setTaskDraft({ ...taskDraft, status: event.target.value, progress: event.target.value === "done" ? 100 : taskDraft.progress })}>{columns.map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}</select></label>
                <label className="field"><span>Приоритет</span><select value={taskDraft.priority} onChange={(event) => setTaskDraft({ ...taskDraft, priority: event.target.value })}>{Object.entries(priorities).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
                <label className="field"><span>Начало</span><input type="date" max={taskDraft.due || undefined} value={taskDraft.start || ""} onChange={(event) => setTaskDraft({ ...taskDraft, start: event.target.value })} /></label>
                <label className="field"><span>Срок</span><input type="date" min={taskDraft.start || undefined} value={taskDraft.due} onChange={(event) => setTaskDraft({ ...taskDraft, due: event.target.value })} /></label>
                <label className="field"><span>Исполнитель</span><select value={taskDraft.assigneeKey || ""} onChange={(event) => setTaskDraft({ ...taskDraft, assigneeKey: event.target.value })}><option value="">Не назначен</option>{activeMembers.map((member) => <option key={member.member_key} value={member.member_key}>{member.display_name}{member.status === "invited" ? " · приглашён" : ""}</option>)}</select></label>
                <label className="field"><span>Трудоёмкость, ч</span><input type="number" min="1" max="500" step="1" value={taskDraft.effortHours || ""} onChange={(event) => setTaskDraft({ ...taskDraft, effortHours: Math.max(1, Number(event.target.value) || 1) })} /></label>
                <label className="field"><span>Прогресс · {taskDraft.subtasks.length ? calculatedProgress(taskDraft) : taskDraft.status === "done" ? 100 : taskDraft.progress}%</span><input type="range" min="0" max="100" step="5" value={taskDraft.subtasks.length ? calculatedProgress(taskDraft) : taskDraft.status === "done" ? 100 : taskDraft.progress} disabled={taskDraft.status === "done" || taskDraft.subtasks.length > 0} onChange={(event) => setTaskDraft({ ...taskDraft, progress: Number(event.target.value) })} /></label>
              </div>
              <div className="task-cost-editor">
                <div className="task-cost-title"><div><WalletCards size={17} /><strong>Бюджет задачи</strong></div><span>{new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(Number(taskDraft.actualCost) || 0)}</span></div>
                <div className="task-cost-grid"><label className="field"><span>Категория расходов</span><select value={taskDraft.costCategory || "other"} onChange={(event) => setTaskDraft({ ...taskDraft, costCategory: event.target.value })}>{Object.entries(costCategories).map(([id, category]) => <option key={id} value={id}>{category.label}</option>)}</select></label><label className="field"><span>План, ₽</span><input type="number" min="0" step="1000" value={taskDraft.plannedCost || ""} onChange={(event) => setTaskDraft({ ...taskDraft, plannedCost: Number(event.target.value) || 0 })} placeholder="0" /></label><label className="field"><span>Факт, ₽</span><input type="number" min="0" step="1000" value={taskDraft.actualCost || ""} onChange={(event) => setTaskDraft({ ...taskDraft, actualCost: Number(event.target.value) || 0 })} placeholder="0" /></label></div>
              </div>
              <div className="dependency-editor">
                <div className="dependency-title"><div><ChartGantt size={17} /><strong>Зависимости</strong></div><span>{(taskDraft.dependsOn || []).length}</span></div>
                <p>Задача начнётся после завершения выбранных предшественников.</p>
                {(taskDraft.dependsOn || []).length > 0 && <div className="dependency-chips">{taskDraft.dependsOn.map((id) => { const parent = tasks.find((task) => task.id === id); return parent ? <span key={id}><Link2 size={12} />{parent.title}<button type="button" onClick={() => setTaskDraft({ ...taskDraft, dependsOn: taskDraft.dependsOn.filter((parentId) => parentId !== id) })} aria-label={`Удалить зависимость ${parent.title}`}><X size={12} /></button></span> : null; })}</div>}
                <label className="dependency-select"><Link2 size={15} /><select value="" onChange={(event) => { const id = event.target.value; if (id) setTaskDraft({ ...taskDraft, dependsOn: [...(taskDraft.dependsOn || []), id] }); }}><option value="">Добавить предшественника…</option>{tasks.filter((task) => task.id !== editingTaskId && !(taskDraft.dependsOn || []).includes(task.id)).map((task) => <option key={task.id} value={task.id} disabled={dependencyWouldCycle(task.id)}>{task.title}{dependencyWouldCycle(task.id) ? " · создаст цикл" : ""}</option>)}</select><ChevronDown size={14} /></label>
              </div>
              <div className="subtasks-editor">
                <div className="subtasks-title"><div><ListChecks size={17} /><strong>Подзадачи</strong></div><span>{taskDraft.subtasks.filter((item) => item.done).length}/{taskDraft.subtasks.length}</span></div>
                <div className="add-subtask"><input value={subtaskInput} onChange={(event) => setSubtaskInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addDraftSubtask(); } }} placeholder="Добавить шаг выполнения..." /><button type="button" onClick={addDraftSubtask}><Plus size={16} /> Добавить</button></div>
                <div className="draft-subtasks">{taskDraft.subtasks.map((item) => <div key={item.id}><button type="button" className={item.done ? "checked" : ""} onClick={() => setTaskDraft({ ...taskDraft, subtasks: taskDraft.subtasks.map((subtask) => subtask.id === item.id ? { ...subtask, done: !subtask.done, completedAt: !subtask.done ? new Date().toISOString() : null } : subtask) })}>{item.done ? <CheckCircle2 size={17} /> : <Circle size={17} />}</button><input className={item.done ? "done" : ""} value={item.text} onChange={(event) => setTaskDraft({ ...taskDraft, subtasks: taskDraft.subtasks.map((subtask) => subtask.id === item.id ? { ...subtask, text: event.target.value } : subtask) })} /><label className="subtask-due-field" title="Срок подзадачи"><CalendarDays size={13} /><input type="date" value={item.due || ""} onChange={(event) => setTaskDraft({ ...taskDraft, subtasks: taskDraft.subtasks.map((subtask) => subtask.id === item.id ? { ...subtask, due: event.target.value } : subtask) })} /></label><button type="button" className="remove-subtask" onClick={() => setTaskDraft({ ...taskDraft, subtasks: taskDraft.subtasks.filter((subtask) => subtask.id !== item.id) })}><X size={15} /></button></div>)}</div>
              </div>
              </fieldset>
              <div className="modal-actions">{editingTaskId && canEdit ? <button type="button" className="delete-button" onClick={() => deleteTask(editingTaskId)}>Удалить</button> : <span />}<div><button type="button" className="secondary-button" onClick={() => setTaskModalOpen(false)}>Закрыть</button>{canEdit && <button type="submit" className="primary-button">{editingTaskId ? "Сохранить" : "Добавить задачу"}</button>}</div></div>
            </form>
            {editingTaskId && <div className="task-module-links"><button className="task-files-button" onClick={() => { setTaskModalOpen(false); setFileFocusTaskId(editingTaskId); setView("files"); }}><Paperclip size={16} /><span><strong>Файлы задачи</strong><em>Открыть документы и добавить вложения</em></span><ChevronRight size={17} /></button><button className="task-risk-button" onClick={() => { setTaskModalOpen(false); setRiskFocusTaskId(editingTaskId); setView("risks"); }}><ShieldAlert size={16} /><span><strong>Риски задачи</strong><em>Открыть связанные риски и проблемы</em></span><ChevronRight size={17} /></button><button className="task-time-button" onClick={() => { setTaskModalOpen(false); setTimeFocusTaskId(editingTaskId); setView("time"); }}><Timer size={16} /><span><strong>Время задачи</strong><em>Открыть таймер и журнал трудозатрат</em></span><ChevronRight size={17} /></button></div>}
            {editingTaskId && <section className="task-comments"><div className="task-comments-head"><div><MessageSquare size={17} /><strong>Обсуждение</strong></div><span>{collaboration.comments.filter((comment) => comment.task_id === editingTaskId).length}</span></div><div className="comment-list">{collaboration.comments.filter((comment) => comment.task_id === editingTaskId).map((comment) => <article key={comment.id}><span className="comment-avatar">{comment.author_name.slice(0, 1).toUpperCase()}</span><div><div><strong>{comment.author_name}</strong><time>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(comment.created_at))}</time></div><p>{comment.body}</p></div>{(collaboration.actor?.role === "owner" || collaboration.actor?.key === comment.author_key) && <button onClick={() => collaborationAction({ action: "delete_comment", commentId: comment.id }, "Комментарий удалён")} title="Удалить комментарий"><X size={14} /></button>}</article>)}{!collaboration.comments.some((comment) => comment.task_id === editingTaskId) && <div className="comments-empty">Обсуждение пока не начато</div>}</div><form className="comment-form" onSubmit={addComment}><input value={commentInput} onChange={(event) => setCommentInput(event.target.value)} placeholder="Написать комментарий..." maxLength="2000" /><button type="submit" disabled={!commentInput.trim() || collaborationStatus === "loading"}><Send size={15} /> Отправить</button></form></section>}
          </div>
        </div>
      )}

      {projectModalOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setProjectModalOpen(false)}>
          <div className="modal project-modal" role="dialog" aria-modal="true">
            <div className="modal-header"><div><span className="section-kicker">Рабочее пространство</span><h2>{editingProjectId ? "Настройки проекта" : "Новый проект"}</h2></div><button className="modal-close" onClick={() => setProjectModalOpen(false)}><X size={20} /></button></div>
            <form onSubmit={saveProject}>
              <label className="field full"><span>Название проекта</span><input autoFocus value={projectDraft.name} onChange={(event) => setProjectDraft({ ...projectDraft, name: event.target.value })} placeholder="Например, Переезд офиса" required /></label>
              <label className="field full"><span>Описание</span><textarea value={projectDraft.description} onChange={(event) => setProjectDraft({ ...projectDraft, description: event.target.value })} placeholder="Коротко сформулируйте цель проекта" rows="3" /></label>
              <label className="field full"><span>Лимит бюджета, ₽</span><input type="number" min="0" step="10000" value={projectDraft.budget || ""} onChange={(event) => setProjectDraft({ ...projectDraft, budget: Number(event.target.value) || 0 })} placeholder="Например, 1 500 000" /></label>
              <div className="field full"><span>Цвет проекта</span><div className="color-picker">{["#ea6a34", "#2a8a68", "#5c6bc0", "#b45175", "#8b6c42"].map((color) => <button type="button" key={color} className={projectDraft.color === color ? "active" : ""} style={{ background: color }} onClick={() => setProjectDraft({ ...projectDraft, color })}>{projectDraft.color === color && <Check size={15} />}</button>)}</div></div>
              <div className="modal-actions">{editingProjectId && projects.length > 1 ? <button type="button" className={`delete-button ${confirmProjectDelete ? "confirm" : ""}`} onClick={deleteProject}><Trash2 size={15} />{confirmProjectDelete ? "Нажмите ещё раз" : "Удалить проект"}</button> : <span />}<div><button type="button" className="secondary-button" onClick={() => setProjectModalOpen(false)}>Отмена</button><button type="submit" className="primary-button">{editingProjectId ? "Сохранить" : "Создать проект"}</button></div></div>
            </form>
          </div>
        </div>
      )}

      {collaborationModalOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCollaborationModalOpen(false)}>
          <div className="modal collaboration-modal" role="dialog" aria-modal="true">
            <div className="modal-header"><div><span className="section-kicker">Общее пространство</span><h2>Участники</h2></div><button className="modal-close" onClick={() => setCollaborationModalOpen(false)}><X size={20} /></button></div>
            <div className="collaboration-summary"><span className="collaboration-shield"><ShieldCheck size={19} /></span><div><strong>Совместная работа защищена ролями</strong><p>Клиенты видят только опубликованные этапы, документы и согласования.</p></div></div>
            {collaborationStatus === "error" && <button className="collaboration-retry" onClick={() => loadCollaboration()}>Не удалось загрузить участников · повторить</button>}
            <div className="member-list">
              {collaboration.members.map((member) => <article key={member.member_key}><span className="member-avatar">{member.display_name.slice(0, 1).toUpperCase()}</span><div><strong>{member.display_name}{member.member_key === collaboration.actor?.key && <em>Вы</em>}</strong><span>{member.email}</span></div><span className={`member-status ${member.status}`}>{member.status === "invited" ? "Приглашён" : "Активен"}</span>{member.role === "owner" ? <span className="owner-role">Владелец</span> : collaboration.actor?.role === "owner" ? <select value={member.role} onChange={(event) => collaborationAction({ action: "update_role", memberKey: member.member_key, role: event.target.value }, "Роль обновлена")}><option value="editor">Редактор</option><option value="viewer">Наблюдатель</option><option value="client">Клиент</option></select> : <span className="member-role">{member.role === "editor" ? "Редактор" : member.role === "client" ? "Клиент" : "Наблюдатель"}</span>}{collaboration.actor?.role === "owner" && member.role !== "owner" && <button className="remove-member" onClick={() => collaborationAction({ action: "remove_member", memberKey: member.member_key }, "Участник удалён")} title="Удалить участника"><UserX size={16} /></button>}</article>)}
            </div>
            {collaboration.actor?.role === "owner" && <form className="invite-form" onSubmit={inviteMember}><div className="invite-title"><UserPlus size={17} /><div><strong>Добавить участника</strong><span>Выберите рабочую или клиентскую роль</span></div></div><div className="invite-grid"><label className="field"><span>Имя</span><input value={inviteDraft.name} onChange={(event) => setInviteDraft({ ...inviteDraft, name: event.target.value })} placeholder="Например, Анна" /></label><label className="field"><span>Email</span><input type="email" value={inviteDraft.email} onChange={(event) => setInviteDraft({ ...inviteDraft, email: event.target.value })} placeholder="name@company.ru" required /></label><label className="field"><span>Роль</span><select value={inviteDraft.role} onChange={(event) => setInviteDraft({ ...inviteDraft, role: event.target.value })}><option value="editor">Редактор</option><option value="viewer">Наблюдатель</option><option value="client">Клиент</option></select></label><button type="submit" className="primary-button" disabled={collaborationStatus === "loading"}><UserPlus size={16} /> Добавить</button></div><p>После добавления предоставьте этому email доступ к закрытому сайту. Клиент увидит только портал.</p></form>}
          </div>
        </div>
      )}

      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    </main>
  );
}
