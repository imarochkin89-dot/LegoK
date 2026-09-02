"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, CheckCircle2, Cloud, Download, File, FileSpreadsheet, FileText, FolderOpen, Image as ImageIcon, Link2, LoaderCircle, RefreshCw, Search, Trash2, UploadCloud, X } from "lucide-react";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} КБ`;
  return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} МБ`;
}

function fileKind(item) {
  const type = String(item.type || "").toLowerCase();
  const extension = String(item.name || "").split(".").pop()?.toLowerCase() || "";
  if (type.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(extension)) return "image";
  if (type.includes("spreadsheet") || type.includes("excel") || ["xls", "xlsx", "csv", "ods"].includes(extension)) return "sheet";
  if (type.includes("zip") || ["zip", "rar", "7z", "tar", "gz"].includes(extension)) return "archive";
  if (type.includes("pdf") || type.includes("document") || type.startsWith("text/") || ["pdf", "doc", "docx", "txt", "rtf", "odt"].includes(extension)) return "document";
  return "other";
}

function kindLabel(kind) {
  return { image: "Изображение", sheet: "Таблица", archive: "Архив", document: "Документ", other: "Другой файл" }[kind];
}

function FileKindIcon({ kind, size = 18 }) {
  if (kind === "image") return <ImageIcon size={size} />;
  if (kind === "sheet") return <FileSpreadsheet size={size} />;
  if (kind === "archive") return <Archive size={size} />;
  if (kind === "document") return <FileText size={size} />;
  return <File size={size} />;
}

export default function FilesPanel({ project, tasks, canEdit, onOpenTask, initialTaskId = "" }) {
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [taskFilter, setTaskFilter] = useState(initialTaskId || "all");
  const [uploadTaskId, setUploadTaskId] = useState(initialTaskId || "");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    setTaskFilter(initialTaskId || "all");
    setUploadTaskId(initialTaskId || "");
  }, [initialTaskId]);

  useEffect(() => { loadFiles(); }, [project?.id]);

  async function loadFiles() {
    if (!project?.id) return;
    setStatus("loading");
    setError("");
    try {
      const response = await fetch(`/api/files?projectId=${encodeURIComponent(project.id)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить файлы");
      setFiles(Array.isArray(data.files) ? data.files : []);
      setStatus("ready");
    } catch (loadError) {
      setStatus("error");
      setError(loadError.message || "Хранилище временно недоступно");
    }
  }

  async function uploadFiles(fileList) {
    const selected = Array.from(fileList || []);
    if (!selected.length || uploading || !canEdit) return;
    const tooLarge = selected.find((item) => item.size > MAX_FILE_BYTES);
    if (tooLarge) { setError(`«${tooLarge.name}» превышает 25 МБ`); return; }
    const empty = selected.find((item) => !item.size);
    if (empty) { setError(`«${empty.name}» — пустой файл`); return; }
    setUploading(true);
    setError("");
    try {
      for (let index = 0; index < selected.length; index += 1) {
        const item = selected[index];
        setUploadProgress(`${index + 1} из ${selected.length} · ${item.name}`);
        const form = new FormData();
        form.append("file", item);
        form.append("projectId", project.id);
        if (uploadTaskId) form.append("taskId", uploadTaskId);
        const response = await fetch("/api/files", { method: "POST", body: form });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Не удалось загрузить «${item.name}»`);
      }
      setUploadProgress(`${selected.length} ${selected.length === 1 ? "файл загружен" : "файла загружено"}`);
      await loadFiles();
      setTimeout(() => setUploadProgress(""), 2500);
    } catch (uploadError) {
      setError(uploadError.message || "Не удалось загрузить файл");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function deleteFile(item) {
    if (confirmDeleteId !== item.id) { setConfirmDeleteId(item.id); return; }
    setConfirmDeleteId("");
    setError("");
    try {
      const response = await fetch(`/api/files?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось удалить файл");
      setFiles((current) => current.filter((fileItem) => fileItem.id !== item.id));
    } catch (deleteError) {
      setError(deleteError.message || "Не удалось удалить файл");
    }
  }

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const filteredFiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return files.filter((item) => {
      const kind = fileKind(item);
      return (!needle || item.name.toLowerCase().includes(needle) || String(item.uploadedBy || "").toLowerCase().includes(needle))
        && (kindFilter === "all" || kind === kindFilter)
        && (taskFilter === "all" || (taskFilter === "unlinked" ? !item.taskId : item.taskId === taskFilter));
    });
  }, [files, kindFilter, query, taskFilter]);
  const totalSize = files.reduce((sum, item) => sum + Number(item.size || 0), 0);
  const linkedCount = files.filter((item) => item.taskId).length;
  const documentCount = files.filter((item) => ["document", "sheet"].includes(fileKind(item))).length;

  return (
    <section className="files-panel" aria-label="Файлы и документы">
      <header className="files-header"><div><span className="section-kicker">Облачное хранилище</span><h2>Файлы и документы</h2><p>Документы проекта хранятся в R2 и доступны участникам рабочего пространства.</p></div><button onClick={loadFiles} disabled={status === "loading"} title="Обновить список"><RefreshCw size={16} className={status === "loading" ? "spin" : ""} /> Обновить</button></header>

      <div className="files-kpis"><article><span className="files-kpi-icon orange"><FolderOpen size={18} /></span><div><strong>{files.length}</strong><span>Всего файлов</span></div></article><article><span className="files-kpi-icon green"><FileText size={18} /></span><div><strong>{documentCount}</strong><span>Документы и таблицы</span></div></article><article><span className="files-kpi-icon blue"><Link2 size={18} /></span><div><strong>{linkedCount}</strong><span>Связано с задачами</span></div></article><article><span className="files-kpi-icon ink"><Cloud size={18} /></span><div><strong>{formatSize(totalSize)}</strong><span>Занято в хранилище</span></div></article></div>

      <div className="files-top-grid">
        <section className={`upload-card ${dragActive ? "is-dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.target === event.currentTarget) setDragActive(false); }} onDrop={(event) => { event.preventDefault(); setDragActive(false); uploadFiles(event.dataTransfer.files); }}>
          <div className="upload-card-head"><div><span className="section-kicker">Загрузка</span><h3>Добавить документы</h3></div>{uploadProgress && <span className="upload-result">{uploading ? <LoaderCircle size={13} className="spin" /> : <CheckCircle2 size={13} />}{uploadProgress}</span>}</div>
          <label className="upload-task-select"><Link2 size={15} /><span>Привязать к задаче</span><select value={uploadTaskId} onChange={(event) => setUploadTaskId(event.target.value)} disabled={!canEdit || uploading}><option value="">Без привязки</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
          <label className={`file-drop-zone ${!canEdit ? "disabled" : ""}`}><input ref={inputRef} type="file" multiple hidden disabled={!canEdit || uploading} onChange={(event) => uploadFiles(event.target.files)} /><span className="file-drop-icon">{uploading ? <LoaderCircle size={25} className="spin" /> : <UploadCloud size={25} />}</span><strong>{canEdit ? "Перетащите файлы или нажмите для выбора" : "В режиме наблюдателя загрузка недоступна"}</strong><em>До 25 МБ на файл · можно выбрать несколько</em></label>
        </section>

        <aside className="storage-card"><span className="storage-cloud"><Cloud size={24} /></span><div><span className="section-kicker">Защищённое хранение</span><h3>R2 + D1</h3><p>Содержимое хранится отдельно от списка задач. Метаданные, автор и связи с задачами сохраняются в D1.</p></div><ul><li><CheckCircle2 size={14} />Единое хранилище команды</li><li><CheckCircle2 size={14} />Доступ по ролям проекта</li><li><CheckCircle2 size={14} />Скачивание оригиналов</li></ul></aside>
      </div>

      {error && <div className="files-error"><span>{error}</span><button onClick={() => setError("")} aria-label="Закрыть сообщение"><X size={14} /></button></div>}

      <section className="files-library">
        <div className="files-library-head"><div><span className="section-kicker">Библиотека проекта</span><h3>Документы</h3></div><div className="files-filters"><label className="files-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти файл..." />{query && <button onClick={() => setQuery("")}><X size={13} /></button>}</label><select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}><option value="all">Все типы</option><option value="document">Документы</option><option value="sheet">Таблицы</option><option value="image">Изображения</option><option value="archive">Архивы</option><option value="other">Другие</option></select><select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}><option value="all">Все задачи</option><option value="unlinked">Без привязки</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></div></div>

        {status === "loading" && !files.length ? <div className="files-empty"><LoaderCircle size={24} className="spin" /><strong>Загружаю библиотеку…</strong></div> : filteredFiles.length ? <div className="files-list">{filteredFiles.map((item) => { const kind = fileKind(item); const task = taskById.get(item.taskId); return <article key={item.id}><span className={`file-kind-icon kind-${kind}`}><FileKindIcon kind={kind} /></span><div className="file-main"><strong title={item.name}>{item.name}</strong><span>{kindLabel(kind)} · {formatSize(item.size)}</span></div><div className="file-link">{task ? <button onClick={() => onOpenTask(task)}><Link2 size={12} />{task.title}</button> : <span>Без привязки</span>}</div><div className="file-author"><strong>{item.uploadedBy || "Участник"}</strong><time>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(item.createdAt))}</time></div><div className="file-actions"><a href={`/api/files?id=${encodeURIComponent(item.id)}`} title="Скачать файл"><Download size={15} /></a>{canEdit && <button className={confirmDeleteId === item.id ? "confirm" : ""} onClick={() => deleteFile(item)} onBlur={() => setTimeout(() => setConfirmDeleteId(""), 150)} title={confirmDeleteId === item.id ? "Нажмите ещё раз для удаления" : "Удалить файл"}><Trash2 size={15} /><span>{confirmDeleteId === item.id ? "Подтвердить" : ""}</span></button>}</div></article>; })}</div> : <div className="files-empty"><FolderOpen size={30} /><strong>{status === "error" ? "Хранилище пока недоступно" : files.length ? "Ничего не найдено" : "Файлов пока нет"}</strong><p>{status === "error" ? "Повторите загрузку списка позже." : files.length ? "Измените параметры поиска или фильтры." : "Загрузите первый документ проекта."}</p>{status === "error" && <button onClick={loadFiles}>Повторить</button>}</div>}
      </section>
    </section>
  );
}
