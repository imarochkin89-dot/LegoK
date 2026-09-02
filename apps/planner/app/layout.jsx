import "./globals.css";

export const metadata = {
  title: "Контур — планировщик проекта",
  description: "Приватный интерактивный планировщик задач и прогресса",
  applicationName: "Контур",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icons/kontur-192.png" />
        <link rel="apple-touch-icon" href="/icons/kontur-192.png" />
        <meta name="theme-color" content="#1f2f27" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Контур" />
      </head>
      <body>{children}</body>
    </html>
  );
}
