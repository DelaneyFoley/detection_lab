"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(JSON.stringify({
      level: "error",
      message: "Unhandled client error",
      ts: new Date().toISOString(),
      name: error.name,
      error: error.message,
      digest: error.digest || null,
      stack: error.stack || null,
    }));
  }, [error]);

  return (
    <html>
      <body className="min-h-screen flex items-center justify-center p-6">
        <div className="app-modal-panel max-w-lg w-full rounded-lg p-6 space-y-3">
          <h2 className="text-lg font-semibold text-[var(--app-danger)]">Something went wrong</h2>
          <p className="text-sm text-[var(--app-text-muted)]">An unexpected error occurred. You can retry without losing saved data.</p>
          <button
            onClick={() => reset()}
            className="app-btn app-btn-danger app-btn-md"
          >
            Retry
          </button>
        </div>
      </body>
    </html>
  );
}
