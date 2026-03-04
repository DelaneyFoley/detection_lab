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
      <body className="bg-gray-950 text-white min-h-screen flex items-center justify-center p-6">
        <div className="max-w-lg w-full border border-red-800/50 bg-gray-900 rounded-lg p-6 space-y-3">
          <h2 className="text-lg font-semibold text-red-300">Something went wrong</h2>
          <p className="text-sm text-gray-300">An unexpected error occurred. You can retry without losing saved data.</p>
          <button
            onClick={() => reset()}
            className="px-3 py-2 rounded bg-red-600 hover:bg-red-500 text-sm font-medium"
          >
            Retry
          </button>
        </div>
      </body>
    </html>
  );
}
