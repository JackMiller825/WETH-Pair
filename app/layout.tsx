import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AlertWatcher } from "@/components/alert-watcher";
import { SiteNav } from "@/components/site-nav";
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
  description: "Live WETH pairs and name, ticker, and narrative trends for newly launched Ethereum tokens.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteNav />
        <AlertWatcher />
        {children}
      </body>
    </html>
  );
}
