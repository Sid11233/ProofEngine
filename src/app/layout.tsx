import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { brand, pageTitle } from "@/lib/brand";
import { IllustrationDefs } from "@/components/illustrations/illustration-defs";
import { LoaderDefs } from "@/components/motion/loader-defs";
import { MOTION_COOKIE, parsePreference } from "@/lib/motion/preference";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: pageTitle(),
  description: "Client-approved case studies, collected by AI interview.",
  applicationName: brand.name,
  // iOS home screen: icon, standalone mode and status bar style. The manifest covers everyone else.
  icons: {
    icon: [
      { url: "/icons/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: brand.shortName, statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#fafaf9",
  // Use the full screen on phones with notches (content respects env(safe-area-inset-*)), and let the
  // on-screen keyboard resize the layout instead of covering the input.
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Render per request so the CSP nonce from middleware reaches Next's scripts.
  await connection();
  // The in-app Reduce motion setting (a plain display cookie), applied before first paint.
  const motion = parsePreference((await cookies()).get(MOTION_COOKIE)?.value);

  return (
    <html lang="en" data-motion={motion}>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <LoaderDefs />
        <IllustrationDefs />
        {children}
      </body>
    </html>
  );
}
