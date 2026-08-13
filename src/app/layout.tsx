import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fraunces, Outfit } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cutline — Audio Lyrics Splitter",
  description:
    "Upload a song and a lyric sheet. Cutline timestamps the vocal, maps each line, and splits lyric clips plus instrumental breaths into a ZIP.",
  icons: {
    icon: "/images/cutline-mark.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${fraunces.variable} ${outfit.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
