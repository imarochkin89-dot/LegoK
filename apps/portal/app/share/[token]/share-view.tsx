/* eslint-disable react-hooks/immutability, react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Decision = { id:string; decision:"approved"|"changes_requested"; comment?:string; clientName:string; decidedAt:string };
type Task = { id:string; title:string; description?:string; status?:string; due?:string; progress?:number; decision?:Decision|null };
type Document = { id:string; name:string; size?:number; type?:string; publishedAt?:string; available?:boolean; syncedAt?:string };
type FeedbackMessage = { id:string; authorType:"client"|"manager"; authorName:string; body:string; createdAt:string };
type Feedback = { id:string; category:"general"|"stage"|"document"; subject:string; taskId?:string; taskTitle?:string; clientName:string; status:"new"|"in_progress"|"resolved"; createdAt:string; updatedAt:string; messages:FeedbackMessage[] };
type Update = { id:string; title:string; body:string; category:"progress"|"milestone"|"document"|"deadline"|"important"; pinned:boolean; publishedAt:string; createdBy:string };
type Snapshot = { project:{ id:string; name:string; description?:string; color?:string }; portal?:{ clientName?:string; greeting?:string; contactName?:string; contactEmail?:string; nextUpdate?:string }; tasks?:Task[]; documents?:Document[]; feedback?:Feedback[]; updates?:Update[]; generatedAt?:string };
type Portfolio = { version?:number; anchorProjectId?:string; projects:Snapshot[]; generatedAt?:string };
type ShareData = { share?:{ expiresAt?:string }; data?:Snapshot|Portfolio; error?:string; locked?:boolean };
type DecisionDraft = { projectId:string; taskId:string; decision:"approved"|"changes_requested"; comment:string };
type FeedbackDraft = { category:"general"|"stage"|"document"; taskId:string; subject:string; message:string; contact:string };

const emptyFeedback = ():FeedbackDraft => ({ category:"general", taskId:"", subject:"", message:"", contact:"" });

function date(value?:string, withTime=false) {
  if (!value) return "—";
  try { return new Intl.DateTimeFormat("ru-RU", withTime ? { dateStyle:"medium", timeStyle:"short" } : { dateStyle:"medium" }).format(new Date(value)); } catch { return value; }
}
function bytes(value=0) { if (!value) return ""; const units=["Б","КБ","МБ","ГБ"]; const i=Math.min(3,Math.floor(Math.log(value)/Math.log(1024))); return `${(value/1024**i).toFixed(i?1:0)} ${units[i]}`; }
function statusLabel(value?:string) { const normalized=String(value||"").toLowerCase(); if (["done","completed","готово"].includes(normalized)) return ["Готово","done"]; if (["in-progress","progress","doing","в работе"].includes(normalized)) return ["В работе","progress"]; return ["Запланировано",""]; }
function feedbackStatus(value:Feedback["status"]) { return value === "resolved" ? "Решено" : value === "in_progress" ? "В работе" : "Новое"; }
function feedbackCategory(value:Feedback["category"]) { return value === "stage" ? "Этап" : value === "document" ? "Документы" : "Общий вопрос"; }
function updateCategory(value:Update["category"]) { return value === "milestone" ? "Веха" : value === "document" ? "Документы" : value === "deadline" ? "Сроки" : value === "important" ? "Важно" : "Прогресс"; }

export default function ShareView({ token }: { token:string }) {
  const [pin,setPin]=useState("");
  const [payload,setPayload]=useState<ShareData|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [downloading,setDownloading]=useState("");
  const [clientName,setClientName]=useState("");
  const [decisionDraft,setDecisionDraft]=useState<DecisionDraft|null>(null);
  const [decisionBusy,setDecisionBusy]=useState(false);
  const [feedbackDraft,setFeedbackDraft]=useState<FeedbackDraft>(emptyFeedback);
  const [feedbackReplies,setFeedbackReplies]=useState<Record<string,string>>({});
  const [feedbackBusy,setFeedbackBusy]=useState("");
  const [feedbackNotice,setFeedbackNotice]=useState("");
  const [showAllUpdates,setShowAllUpdates]=useState(false);
  const [activeProjectId,setActiveProjectId]=useState("");
  const feedbackRef=useRef<HTMLElement|null>(null);

  function projectSnapshots(value=payload?.data):Snapshot[] {
    if (!value) return [];
    return "projects" in value && Array.isArray(value.projects) ? value.projects : [value as Snapshot];
  }
  function currentProjectId() {
    const projects=projectSnapshots();
    return projects.some(item=>item.project.id===activeProjectId)?activeProjectId:(projects[0]?.project.id||"");
  }

  useEffect(()=>{
    setClientName(localStorage.getItem("kontur-client-name")||"");
    setFeedbackDraft(previous=>({...previous,contact:localStorage.getItem("kontur-client-contact")||""}));
    const saved=sessionStorage.getItem(`kontur-share-${token}`)||"";
    if(saved) load(saved);
  },[token]);

  async function load(activeSession:string){
    setBusy(true); setError("");
    try{const response=await fetch(`/api/share?token=${encodeURIComponent(token)}&session=${encodeURIComponent(activeSession)}`,{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error||"Ссылка недоступна");setPayload(data);}
    catch(e){sessionStorage.removeItem(`kontur-share-${token}`);setError(e instanceof Error?e.message:"Ссылка недоступна");}
    finally{setBusy(false);}
  }
  async function unlock(event:FormEvent){
    event.preventDefault(); setBusy(true); setError("");
    try{const response=await fetch("/api/share",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"unlock",token,pin})});const data=await response.json();if(!response.ok)throw new Error(data.error||"Не удалось открыть ссылку");sessionStorage.setItem(`kontur-share-${token}`,data.session);setPayload(data);setPin("");}
    catch(e){setError(e instanceof Error?e.message:"Не удалось открыть ссылку");}
    finally{setBusy(false);}
  }
  async function download(document:Document){
    if(!document.available||downloading)return;
    const activeSession=sessionStorage.getItem(`kontur-share-${token}`)||""; setDownloading(document.id); setError("");
    try{const response=await fetch(`/api/share?token=${encodeURIComponent(token)}&session=${encodeURIComponent(activeSession)}&fileId=${encodeURIComponent(document.id)}`,{cache:"no-store"});if(!response.ok){const data=await response.json();throw new Error(data.error||"Не удалось скачать документ");}const blob=await response.blob();const href=URL.createObjectURL(blob);const link=window.document.createElement("a");link.href=href;link.download=document.name||"document";window.document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(href);}
    catch(e){setError(e instanceof Error?e.message:"Не удалось скачать документ");}
    finally{setDownloading("");}
  }
  function beginDecision(task:Task, decision:"approved"|"changes_requested") {
    if (task.decision?.clientName && !clientName) setClientName(task.decision.clientName);
    setDecisionDraft({ projectId:currentProjectId(), taskId:task.id, decision, comment:task.decision?.comment||"" });
    setError("");
  }
  async function submitDecision(event:FormEvent) {
    event.preventDefault();
    if (!decisionDraft) return;
    const name=clientName.trim();
    if(!name){setError("Укажите ваше имя");return;}
    if(decisionDraft.decision==="changes_requested"&&!decisionDraft.comment.trim()){setError("Опишите необходимые изменения");return;}
    const activeSession=sessionStorage.getItem(`kontur-share-${token}`)||""; setDecisionBusy(true); setError("");
    try{const response=await fetch("/api/share",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"decision",token,session:activeSession,projectId:decisionDraft.projectId,taskId:decisionDraft.taskId,decision:decisionDraft.decision,comment:decisionDraft.comment,clientName:name})});const data=await response.json();if(!response.ok)throw new Error(data.error||"Не удалось сохранить решение");localStorage.setItem("kontur-client-name",name);setPayload(previous=>({...previous,...data}));setDecisionDraft(null);}
    catch(e){setError(e instanceof Error?e.message:"Не удалось сохранить решение");}
    finally{setDecisionBusy(false);}
  }
  function askAboutTask(task:Task) {
    setFeedbackDraft(previous=>({...previous,category:"stage",taskId:task.id,subject:`Вопрос по этапу «${task.title}»`}));
    setFeedbackNotice(""); setError("");
    setTimeout(()=>feedbackRef.current?.scrollIntoView({behavior:"smooth",block:"start"}),0);
  }
  async function submitFeedback(event:FormEvent) {
    event.preventDefault();
    const name=clientName.trim();
    if(!name){setError("Укажите ваше имя");return;}
    const activeSession=sessionStorage.getItem(`kontur-share-${token}`)||""; setFeedbackBusy("create"); setError(""); setFeedbackNotice("");
    try{const response=await fetch("/api/share",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"feedback_create",token,session:activeSession,projectId:currentProjectId(),clientName:name,clientContact:feedbackDraft.contact,category:feedbackDraft.category,taskId:feedbackDraft.taskId,subject:feedbackDraft.subject,message:feedbackDraft.message})});const data=await response.json();if(!response.ok)throw new Error(data.error||"Не удалось отправить обращение");localStorage.setItem("kontur-client-name",name);localStorage.setItem("kontur-client-contact",feedbackDraft.contact);setPayload(previous=>({...previous,...data}));setFeedbackDraft(previous=>({...emptyFeedback(),contact:previous.contact}));setFeedbackNotice("Сообщение отправлено руководителю проекта");}
    catch(e){setError(e instanceof Error?e.message:"Не удалось отправить обращение");}
    finally{setFeedbackBusy("");}
  }
  async function replyFeedback(feedbackId:string) {
    const message=(feedbackReplies[feedbackId]||"").trim();
    const name=clientName.trim();
    if(!message||!name)return;
    const activeSession=sessionStorage.getItem(`kontur-share-${token}`)||""; setFeedbackBusy(feedbackId); setError(""); setFeedbackNotice("");
    try{const response=await fetch("/api/share",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"feedback_reply",token,session:activeSession,feedbackId,message,clientName:name})});const data=await response.json();if(!response.ok)throw new Error(data.error||"Не удалось отправить сообщение");setPayload(previous=>({...previous,...data}));setFeedbackReplies(previous=>({...previous,[feedbackId]:""}));setFeedbackNotice("Ответ добавлен в переписку");}
    catch(e){setError(e instanceof Error?e.message:"Не удалось отправить сообщение");}
    finally{setFeedbackBusy("");}
  }

  if (!payload?.data) return <main className="share-shell"><header className="share-top"><div className="brand"><span className="brand-mark">К</span><span>Контур</span></div><span className="secure-label">◉ Защищённая ссылка</span></header><section className="lock-card"><div className="lock-icon">⌁</div><span className="eyebrow">Доступ к проекту</span><h1>Введите PIN-код</h1><p>Код выдаёт руководитель проекта. После пяти неверных попыток доступ временно блокируется.</p><form className="pin-form" onSubmit={unlock}><input autoFocus inputMode="numeric" pattern="[0-9]{4,10}" value={pin} onChange={event=>setPin(event.target.value.replace(/\D/g,"").slice(0,10))} placeholder="••••••" aria-label="PIN-код"/><button disabled={busy||pin.length<4}>{busy?"Проверяю…":"Открыть"}</button></form>{error&&<div className="error-box">{error}</div>}<p className="lock-foot">Ссылка может быть ограничена по сроку или отозвана владельцем.</p></section></main>;

  const projects=projectSnapshots(payload.data);
  const data=projects.find(item=>item.project.id===activeProjectId)||projects[0];
  const tasks=data.tasks||[], documents=data.documents||[], feedback=data.feedback||[], updates=data.updates||[];
  const visibleUpdates=showAllUpdates?updates:updates.slice(0,4);
  return <main className="share-shell">
    <header className="share-top"><div className="brand"><span className="brand-mark">К</span><span>Контур</span></div><span className="secure-label">◉ Доступ подтверждён</span></header>
    <div className="portal">
      {projects.length>1&&<nav className="portfolio-switcher" aria-label="Проекты в публичной ссылке"><div className="portfolio-switcher-head"><div><span className="eyebrow">Портфель проектов</span><h2>Выберите проект</h2></div><span>{projects.length} проектов</span></div><div className="portfolio-tabs">{projects.map(item=>{const selected=item.project.id===data.project.id;const projectTasks=item.tasks||[];const progress=projectTasks.length?Math.round(projectTasks.reduce((sum,task)=>sum+Math.max(0,Math.min(100,Number(task.progress)||0)),0)/projectTasks.length):0;return <button type="button" key={item.project.id} className={selected?"selected":""} onClick={()=>{setActiveProjectId(item.project.id);setDecisionDraft(null);setFeedbackDraft(previous=>({...emptyFeedback(),contact:previous.contact}));setFeedbackNotice("");setError("");setShowAllUpdates(false);}} style={{"--tab-color":item.project.color||"#2f7754"} as React.CSSProperties}><span className="portfolio-tab-color"/><span><strong>{item.project.name}</strong><small>{projectTasks.length} этапов · {progress}%</small></span></button>})}</div></nav>}
      <section className="hero" style={{"--project-color":data.project.color||"#2f7754"} as React.CSSProperties}><span className="eyebrow">{data.portal?.clientName||"Статус проекта"}</span><h1>{data.project.name}</h1><p>{data.portal?.greeting||data.project.description||"Актуальный статус согласованных этапов проекта."}</p><div className="hero-meta"><span>Обновлено: {date(data.generatedAt,true)}</span><span>Ссылка до: {date(payload.share?.expiresAt,true)}</span></div></section>
      <section className="panel update-feed"><div className="update-feed-head"><div><span className="eyebrow">История проекта</span><h2>Лента обновлений</h2></div><span>{updates.length} публикаций</span></div>{updates.length?<><div className="update-timeline">{visibleUpdates.map(item=><article key={item.id} className={`update-card update-${item.category}${item.pinned?" pinned":""}`}><div className="update-dot">{item.pinned?"◆":"●"}</div><div className="update-card-main"><div className="update-meta"><span>{updateCategory(item.category)}</span><time>{date(item.publishedAt,true)}</time>{item.pinned&&<b>Закреплено</b>}</div><h3>{item.title}</h3><p>{item.body}</p><small>{item.createdBy}</small></div></article>)}</div>{updates.length>4&&<button className="update-more" onClick={()=>setShowAllUpdates(value=>!value)}>{showAllUpdates?"Свернуть ленту":`Показать все обновления · ${updates.length}`}</button>}</>:<div className="empty update-empty">Новости проекта появятся здесь после первой публикации.</div>}</section>
      <div className="portal-grid">
        <section className="panel"><div className="panel-head"><h2>Ход работ</h2><span>{tasks.length} этапов</span></div>{error&&<div className="error-box stage-error">{error}</div>}<div className="task-list">{tasks.length?tasks.map(task=>{const [label,kind]=statusLabel(task.status);const progress=Math.max(0,Math.min(100,Number(task.progress)||0));const editing=decisionDraft?.taskId===task.id;return <article className="task" key={task.id}><div className="task-top"><div><h3>{task.title}</h3>{task.description&&<p>{task.description}</p>}</div><span className={`status status-${kind}`}>{label}</span></div><div className="progress-row"><div className="progress-track"><span style={{width:`${progress}%`}}/></div><b>{progress}%</b></div>{task.due&&<div className="task-date">Срок: {date(task.due)}</div>}{task.decision&&<div className={`decision-result decision-${task.decision.decision}`}><strong>{task.decision.decision==="approved"?"✓ Этап согласован":"↺ Запрошены изменения"}</strong><span>{task.decision.clientName} · {date(task.decision.decidedAt,true)}</span>{task.decision.comment&&<p>{task.decision.comment}</p>}</div>}{editing?<form className="decision-form" onSubmit={submitDecision}><div className="decision-choice"><button type="button" className={decisionDraft.decision==="approved"?"selected approved":""} onClick={()=>setDecisionDraft({...decisionDraft,decision:"approved"})}>Согласовать</button><button type="button" className={decisionDraft.decision==="changes_requested"?"selected changes":""} onClick={()=>setDecisionDraft({...decisionDraft,decision:"changes_requested"})}>Нужны изменения</button></div><input value={clientName} onChange={event=>setClientName(event.target.value.slice(0,100))} placeholder="Ваше имя" required/><textarea value={decisionDraft.comment} onChange={event=>setDecisionDraft({...decisionDraft,comment:event.target.value.slice(0,2000)})} placeholder={decisionDraft.decision==="approved"?"Комментарий — необязательно":"Опишите необходимые изменения"} rows={3}/><div className="decision-submit"><button type="button" onClick={()=>setDecisionDraft(null)}>Отмена</button><button type="submit" disabled={decisionBusy}>{decisionBusy?"Сохраняю…":"Отправить решение"}</button></div></form>:<div className="decision-actions">{task.decision?<button onClick={()=>beginDecision(task,task.decision!.decision)}>Изменить решение</button>:<><button className="approve" onClick={()=>beginDecision(task,"approved")}>✓ Согласовать</button><button onClick={()=>beginDecision(task,"changes_requested")}>Нужны изменения</button></>}<button className="question" onClick={()=>askAboutTask(task)}>Задать вопрос</button></div>}</article>}):<div className="empty">Опубликованных этапов пока нет</div>}</div></section>
        <aside className="side-stack"><section className="panel"><h2>Контакты</h2><div className="contact-lines"><div className="contact-line"><small>Руководитель</small><strong>{data.portal?.contactName||"Руководитель проекта"}</strong></div>{data.portal?.contactEmail&&<div className="contact-line"><small>Электронная почта</small><strong>{data.portal.contactEmail}</strong></div>}{data.portal?.nextUpdate&&<div className="contact-line"><small>Следующее обновление</small><strong>{date(data.portal.nextUpdate)}</strong></div>}</div></section><section className="panel"><div className="panel-head"><h2>Документы</h2><span>{documents.length}</span></div><div className="doc-list">{documents.length?documents.map(document=><button className="document" key={document.id} onClick={()=>download(document)} disabled={!document.available||Boolean(downloading)} title={document.available?"Скачать документ":"Документ готовится к публикации"}><span className="doc-icon">{downloading===document.id?"…":"⇩"}</span><div><strong>{document.name}</strong><small>{bytes(document.size)}{document.available?" · Скачать":" · Готовится"}</small></div></button>):<div className="empty">Нет опубликованных документов</div>}</div></section></aside>
      </div>
      <section className="panel feedback-panel" ref={feedbackRef}><div className="feedback-heading"><div><span className="eyebrow">Прямая связь</span><h2>Обратная связь</h2><p>Задайте вопрос, уточните детали или продолжите переписку с руководителем проекта.</p></div><span className="feedback-count">{feedback.length}</span></div>
        {error&&<div className="error-box feedback-error">{error}</div>}
        {feedbackNotice&&<div className="feedback-notice">✓ {feedbackNotice}</div>}
        <div className="feedback-layout"><form className="feedback-form" onSubmit={submitFeedback}><div className="feedback-fields"><label><span>Тема обращения</span><select value={feedbackDraft.category} onChange={event=>setFeedbackDraft({...feedbackDraft,category:event.target.value as FeedbackDraft["category"],taskId:event.target.value==="stage"?feedbackDraft.taskId:""})}><option value="general">Общий вопрос</option><option value="stage">Вопрос по этапу</option><option value="document">Документы</option></select></label>{feedbackDraft.category==="stage"&&<label><span>Этап</span><select value={feedbackDraft.taskId} onChange={event=>setFeedbackDraft({...feedbackDraft,taskId:event.target.value})} required><option value="">Выберите этап</option>{tasks.map(task=><option key={task.id} value={task.id}>{task.title}</option>)}</select></label>}<label className={feedbackDraft.category==="stage"?"wide":""}><span>Заголовок</span><input value={feedbackDraft.subject} onChange={event=>setFeedbackDraft({...feedbackDraft,subject:event.target.value.slice(0,180)})} placeholder="Кратко сформулируйте вопрос" required minLength={3}/></label><label><span>Ваше имя</span><input value={clientName} onChange={event=>setClientName(event.target.value.slice(0,100))} placeholder="Как к вам обращаться" required/></label><label><span>Контакт — необязательно</span><input value={feedbackDraft.contact} onChange={event=>setFeedbackDraft({...feedbackDraft,contact:event.target.value.slice(0,160)})} placeholder="E-mail или телефон"/></label></div><label><span>Сообщение</span><textarea value={feedbackDraft.message} onChange={event=>setFeedbackDraft({...feedbackDraft,message:event.target.value.slice(0,3000)})} rows={5} placeholder="Опишите вопрос или предложение" required minLength={3}/></label><button type="submit" disabled={feedbackBusy==="create"}>{feedbackBusy==="create"?"Отправляю…":"Отправить сообщение"}</button></form>
          <div className="feedback-threads">{feedback.length?feedback.map(item=><article className={`feedback-thread feedback-${item.status}`} key={item.id}><div className="feedback-thread-head"><div><span>{feedbackCategory(item.category)}{item.taskTitle?` · ${item.taskTitle}`:""}</span><h3>{item.subject}</h3></div><b>{feedbackStatus(item.status)}</b></div><div className="feedback-messages">{item.messages.map(message=><div key={message.id} className={`feedback-message message-${message.authorType}`}><div><strong>{message.authorName}</strong><time>{date(message.createdAt,true)}</time></div><p>{message.body}</p></div>)}</div><div className="feedback-reply"><textarea rows={2} value={feedbackReplies[item.id]||""} onChange={event=>setFeedbackReplies(previous=>({...previous,[item.id]:event.target.value.slice(0,3000)}))} placeholder="Продолжить переписку…"/><button type="button" onClick={()=>replyFeedback(item.id)} disabled={feedbackBusy===item.id||!(feedbackReplies[item.id]||"").trim()}>{feedbackBusy===item.id?"Отправляю…":"Ответить"}</button></div></article>):<div className="empty feedback-empty">Ваши обращения появятся здесь вместе с ответами руководителя.</div>}</div></div>
      </section>
      <footer className="portal-foot"><span>Показаны только данные, выбранные владельцем проекта</span><span>{projects.length>1?`Проект ${projects.findIndex(item=>item.project.id===data.project.id)+1} из ${projects.length} · `:""}Контур · публичный статус</span></footer>
    </div>
  </main>;
}
