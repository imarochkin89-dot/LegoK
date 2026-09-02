export default function Home() {
  return (
    <main className="landing-shell">
      <div className="brand"><span className="brand-mark">К</span><span>Контур</span></div>
      <section className="landing-card">
        <span className="eyebrow">Публичный статус проекта</span>
        <h1>Информация доступна только по персональной ссылке</h1>
        <p>Откройте ссылку, которую прислал руководитель проекта, и введите PIN-код. Регистрация не требуется.</p>
        <div className="security-note"><span>✓</span><div><strong>Безопасный просмотр</strong><small>Ссылка ограничена по сроку и может быть отозвана в любой момент.</small></div></div>
        <footer>Если ссылка не открывается, запросите новую у руководителя проекта.</footer>
      </section>
      <p className="landing-foot">Контур · защищённый клиентский портал</p>
    </main>
  );
}
