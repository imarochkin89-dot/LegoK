"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Download, MonitorSmartphone, RefreshCw, Share2, WifiOff, X } from "lucide-react";

function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

export default function PwaInstall() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [registration, setRegistration] = useState(null);

  const isIos = useMemo(() => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent), []);

  useEffect(() => {
    setIsStandalone(isStandaloneMode());
    setIsOnline(navigator.onLine);

    const rememberPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const markInstalled = () => {
      setInstallPrompt(null);
      setIsStandalone(true);
      setDialogOpen(false);
    };
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);

    window.addEventListener("beforeinstallprompt", rememberPrompt);
    window.addEventListener("appinstalled", markInstalled);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    if ("serviceWorker" in navigator && window.location.hostname !== "terminal.local") {
      navigator.serviceWorker.register("/sw.js").then((workerRegistration) => {
        setRegistration(workerRegistration);
        if (workerRegistration.waiting) setUpdateReady(true);
        workerRegistration.addEventListener("updatefound", () => {
          const worker = workerRegistration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setUpdateReady(true);
          });
        });
      }).catch(() => {});
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", rememberPrompt);
      window.removeEventListener("appinstalled", markInstalled);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  async function installApp() {
    if (!installPrompt) {
      setDialogOpen(true);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setIsStandalone(true);
    setInstallPrompt(null);
    setDialogOpen(false);
  }

  function applyUpdate() {
    registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
    window.setTimeout(() => window.location.reload(), 350);
  }

  const state = !isOnline ? "offline" : updateReady ? "update" : isStandalone ? "installed" : "install";
  const stateLabel = state === "offline" ? "Офлайн" : state === "update" ? "Обновить" : state === "installed" ? "Приложение" : "Установить";
  const StateIcon = state === "offline" ? WifiOff : state === "update" ? RefreshCw : state === "installed" ? MonitorSmartphone : Download;

  return (
    <>
      <button
        className={`pwa-install-button ${state}`}
        onClick={state === "update" ? applyUpdate : () => setDialogOpen(true)}
        aria-label={stateLabel}
        title={state === "installed" ? "Контур установлен как приложение" : stateLabel}
      >
        <StateIcon size={14} />
        <span>{stateLabel}</span>
      </button>

      {dialogOpen && typeof document !== "undefined" && createPortal(
        <div className="pwa-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDialogOpen(false)}>
          <section className="pwa-dialog" role="dialog" aria-modal="true" aria-labelledby="pwa-title">
            <button className="pwa-dialog-close" onClick={() => setDialogOpen(false)} aria-label="Закрыть"><X size={18} /></button>
            <div className="pwa-app-mark" aria-hidden="true"><span /></div>
            <span className="section-kicker">Контур для вашего устройства</span>
            <h2 id="pwa-title">Планировщик как приложение</h2>
            <p className="pwa-dialog-lead">Открывайте рабочее пространство отдельным окном, быстрее возвращайтесь к проектам и продолжайте работу при нестабильном интернете.</p>

            <div className="pwa-benefits">
              <article><MonitorSmartphone size={18} /><div><strong>Отдельное приложение</strong><span>Иконка на рабочем столе и запуск без вкладок браузера.</span></div></article>
              <article><WifiOff size={18} /><div><strong>Офлайн-режим</strong><span>Ранее открытый проект и локальные изменения доступны без сети.</span></div></article>
              <article><RefreshCw size={18} /><div><strong>Автообновление</strong><span>Новая версия загружается при следующем подключении.</span></div></article>
            </div>

            {isStandalone ? (
              <div className="pwa-installed-note"><CheckCircle2 size={18} /><div><strong>Приложение уже установлено</strong><span>Вы используете автономный режим Контур.</span></div></div>
            ) : !installPrompt ? (
              <div className="pwa-manual-note">
                <Share2 size={17} />
                <div><strong>{isIos ? "Установка на iPhone или iPad" : "Установка через меню браузера"}</strong><span>{isIos ? "Нажмите «Поделиться», затем «На экран Домой»." : "Откройте меню браузера и выберите «Установить Контур» или «Добавить на главный экран»."}</span></div>
              </div>
            ) : null}

            <div className="pwa-dialog-actions">
              <button onClick={() => setDialogOpen(false)}>Позже</button>
              {!isStandalone && <button className="pwa-install-primary" onClick={installApp}><Download size={16} />Установить</button>}
            </div>
            <small>Установка не меняет права доступа. Данные остаются в вашем приватном рабочем пространстве.</small>
          </section>
        </div>,
        document.body
      )}
    </>
  );
}
