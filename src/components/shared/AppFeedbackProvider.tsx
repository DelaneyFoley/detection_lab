"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

type FeedbackTone = "info" | "success" | "warning" | "error";

type ToastOptions = {
  title?: string;
  message: string;
  tone?: FeedbackTone;
};

type ConfirmOptions = {
  title?: string;
  message: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  dismissLabel?: string;
  tone?: "default" | "danger" | "warning";
};

type FeedbackContextValue = {
  notify: (input: string | ToastOptions) => void;
  confirm: (options: string | ConfirmOptions) => Promise<boolean | null>;
};

type ToastItem = ToastOptions & { id: number };

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function AppFeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { open: boolean }) | null>(null);
  const confirmResolverRef = useRef<((value: boolean | null) => void) | null>(null);
  const nextToastIdRef = useRef(1);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (input: string | ToastOptions) => {
      const payload: ToastOptions = typeof input === "string" ? { message: input } : input;
      const id = nextToastIdRef.current++;
      setToasts((prev) => [...prev, { id, tone: "info", ...payload }]);
      window.setTimeout(() => dismissToast(id), 4200);
    },
    [dismissToast]
  );

  const resolveConfirm = useCallback((value: boolean | null) => {
    confirmResolverRef.current?.(value);
    confirmResolverRef.current = null;
    setConfirmState(null);
  }, []);

  const confirm = useCallback((input: string | ConfirmOptions) => {
    const payload: ConfirmOptions =
      typeof input === "string" ? { message: input } : input;
    setConfirmState({
      open: true,
      title: payload.title || "Confirm Action",
      message: payload.message,
      confirmLabel: payload.confirmLabel || "Confirm",
      cancelLabel: payload.cancelLabel || "Cancel",
      dismissLabel: payload.dismissLabel,
      tone: payload.tone || "default",
    });
    return new Promise<boolean | null>((resolve) => {
      confirmResolverRef.current = resolve;
    });
  }, []);

  const value = useMemo<FeedbackContextValue>(
    () => ({
      notify,
      confirm,
    }),
    [confirm, notify]
  );

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      <div className="pointer-events-none fixed right-4 top-4 z-[80] flex w-full max-w-sm flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-xl border px-4 py-3 shadow-[0_18px_44px_rgba(0,0,0,0.32)] backdrop-blur ${
              toast.tone === "success"
                ? "border-[rgba(47,227,170,0.26)] bg-[rgba(11,38,29,0.96)] text-emerald-50"
                : toast.tone === "warning"
                  ? "border-[rgba(240,180,100,0.24)] bg-[rgba(65,45,16,0.96)] text-amber-50"
                  : toast.tone === "error"
                    ? "border-[rgba(255,123,136,0.24)] bg-[rgba(60,18,25,0.96)] text-red-50"
                    : "border-[var(--app-border-strong)] bg-[var(--app-surface-strong)] text-white"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {toast.title && <div className="text-sm font-semibold">{toast.title}</div>}
                <div className="text-sm leading-5">{toast.message}</div>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="text-xs text-white/70 transition hover:text-white"
              >
                Close
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmState?.open && (
        <div className="app-modal-overlay fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="app-modal-panel w-full max-w-md rounded-[16px] p-5">
            <div className="text-lg font-semibold text-white">{confirmState.title}</div>
            <div className="mt-3 text-sm leading-6 text-[var(--app-text-muted)] whitespace-pre-line">{confirmState.message}</div>
            <div className={`mt-5 flex gap-3 ${confirmState.dismissLabel ? "justify-between" : confirmState.tone === "danger" ? "justify-between" : "justify-end"}`}>
              {confirmState.dismissLabel && (
                <button
                  type="button"
                  onClick={() => resolveConfirm(null)}
                  className="app-btn app-btn-md bg-red-500/20 text-red-200 border border-red-400/30 hover:bg-red-500/30"
                >
                  {confirmState.dismissLabel}
                </button>
              )}
              <button
                type="button"
                onClick={() => resolveConfirm(false)}
                className={`app-btn app-btn-md ${
                  confirmState.tone === "danger"
                    ? "bg-purple-500/20 text-purple-200 border border-purple-400/30 hover:bg-purple-500/30"
                    : confirmState.tone === "warning"
                      ? "bg-red-500/20 text-red-200 border border-red-400/30 hover:bg-red-500/30"
                      : "app-btn-subtle"
                }`}
              >
                {confirmState.cancelLabel}
              </button>
              <button
                type="button"
                onClick={() => resolveConfirm(true)}
                className={`app-btn app-btn-md ${
                  confirmState.tone === "danger" || confirmState.tone === "warning"
                    ? "bg-purple-500/20 text-purple-200 border border-purple-400/30 hover:bg-purple-500/30"
                    : "app-btn-primary"
                }`}
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function useAppFeedback() {
  const value = useContext(FeedbackContext);
  if (!value) {
    throw new Error("useAppFeedback must be used within AppFeedbackProvider");
  }
  return value;
}
