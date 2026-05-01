import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mesa y Mus",
  description:
    "Aplicación web para autogestionar un torneo suizo de mus con QR, selfies, clasificación automática y fase final.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
