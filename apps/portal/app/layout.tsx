import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Контур — публичный статус",
  description: "Защищённая страница статуса проекта.",
  robots: { index: false, follow: false, nocache: true },
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
