import { GeistMono } from "geist/font/mono";
import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import { themeInitScript } from "@/components/theme-toggle";
import { Toaster } from "@/components/toaster";
import { APP_NAME, APP_TAGLINE } from "@/lib/app-config";
import "./globals.css";

// Self-hosted at build time by next/font; no request to Google at runtime.
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_TAGLINE,
  applicationName: APP_NAME,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1f5b3f" },
    { media: "(prefers-color-scheme: dark)", color: "#143d2a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${figtree.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh bg-paper text-ink">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
