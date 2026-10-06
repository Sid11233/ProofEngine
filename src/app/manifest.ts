import type { MetadataRoute } from "next";
import { brand } from "@/lib/brand";

// The web app manifest (served at /manifest.webmanifest). Installing opens the signed-in dashboard; the
// interview pages are plain web pages and are not part of the app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app/dashboard",
    name: brand.name,
    short_name: brand.shortName,
    description: "Client-approved case studies, collected by AI interview.",
    start_url: "/app/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: "#171717",
    background_color: "#fafaf9",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
