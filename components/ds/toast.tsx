"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

export type ToastTone = "ok" | "warn" | "bad" | "info";

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
}

type ToastContextValue = {
  show: (toast: Omit<ToastItem, "id">) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_BORDER_CLASSES: Record<ToastTone, string> = {
  ok: "border-l-ds-ok",
  warn: "border-l-ds-warn",
  bad: "border-l-ds-bad",
  info: "border-l-ds-info",
};

const TONE_TEXT_CLASSES: Record<ToastTone, string> = {
  ok: "text-ds-ok",
  warn: "text-ds-warn",
  bad: "text-ds-bad",
  info: "text-ds-info",
};

export function ToastVisual({ tone, title, description }: Omit<ToastItem, "id">) {
  return (
    <div
      role="status"
      className={`w-80 rounded-ds-control border-l-4 bg-ds-surface p-3 shadow-ds-2 ${TONE_BORDER_CLASSES[tone]}`}
    >
      <p className={`text-sm font-medium ${TONE_TEXT_CLASSES[tone]}`}>{title}</p>
      {description && <p className="mt-0.5 text-xs text-ds-ink-2">{description}</p>}
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const show = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = String(nextId.current++);
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 5000);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <ToastVisual tone={toast.tone} title={toast.title} description={toast.description} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
