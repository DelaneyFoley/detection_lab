import type { Metadata } from "next";
import "./globals.css";
import { AppFeedbackProvider } from "@/components/shared/AppFeedbackProvider";

export const metadata: Metadata = {
  title: "VLM Eval — Prompt-Based Detection Evaluator",
  description: "Evaluate prompt-based binary detections with VLMs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <AppFeedbackProvider>{children}</AppFeedbackProvider>
      </body>
    </html>
  );
}
