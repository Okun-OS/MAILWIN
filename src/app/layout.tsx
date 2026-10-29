import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", weight: ["600", "700", "800"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "OKUN Mailwin", template: "%s · OKUN Mailwin" },
  description: "Dein KI-Assistent für E-Mail, Termine und Projekte.",
};

export const viewport: Viewport = { themeColor: "#03bd7b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${inter.variable} ${jakarta.variable}`}>
      <body>{children}</body>
    </html>
  );
}
