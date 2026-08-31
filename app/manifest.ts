import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TeacherSheet",
    short_name: "TeacherSheet",
    description: "Analyze worksheet structure locally from photos and documents.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f6fb",
    theme_color: "#6548f5",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
