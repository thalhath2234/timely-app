
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import Providers from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Timely",
  description: "Private personal planning, scheduling, and notes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased bg-background`}
    >
      <body className="h-screen flex flex-col font-sans">
        <a href="#main-content" className="sr-only z-[110] rounded bg-background px-3 py-2 text-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
