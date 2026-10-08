import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { AlertWatcher } from "@/components/alert-watcher";
import { LpMonitor } from "@/components/lp/monitor-context";
import { AppShell } from "@/components/shell/app-shell";
import { themeBootScript } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WETH live pairs",
  description: "Live WETH pairs, LP burn monitoring, and name, ticker, and narrative trends for newly launched Ethereum tokens.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <LpMonitor>
          <AppShell>
            <AlertWatcher />
            {children}
          </AppShell>
        </LpMonitor>
      </body>
    </html>
  );
}
