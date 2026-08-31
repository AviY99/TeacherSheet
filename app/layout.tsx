import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "TeacherSheet",
  description: "Turn a photographed worksheet into a reusable exercise structure.",
  applicationName: "TeacherSheet",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "TeacherSheet", statusBarStyle: "default" }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#6548f5"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
