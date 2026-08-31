import type { CapacitorConfig } from "@capacitor/cli";

// APK packaging comes after the web version is deployed.
// Set CAPACITOR_SERVER_URL to the production TeacherSheet URL before `npx cap add android`.
const config: CapacitorConfig = {
  appId: "com.teachersheet.app",
  appName: "TeacherSheet",
  webDir: "public",
  server: process.env.CAPACITOR_SERVER_URL
    ? { url: process.env.CAPACITOR_SERVER_URL, cleartext: false }
    : undefined
};

export default config;
