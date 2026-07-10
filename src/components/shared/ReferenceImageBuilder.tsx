"use client";

import { useCallback, useState } from "react";

interface RefItem {
  id: string;
  dataUrl: string;
  label: string;
}

/**
 * Compose up to 10 labeled images into a single reference sheet (client-side
 * canvas) that is stored with a prompt version and sent to the model at
 * inference as a visual few-shot calibration example. `value` is the current
 * composed data URL (JPEG); `onChange` receives the new one (or null when cleared).
 */
export function ReferenceImageBuilder({
  value,
  onChange,
}: {
  value?: string | null;
  onChange: (dataUrl: string | null) => void;
}) {
  const [items, setItems] = useState<RefItem[]>([]);
  const [title, setTitle] = useState("Severity Reference");
  const [busy, setBusy] = useState(false);

  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const room = 10 - items.length;
    if (room <= 0) return;
    const picked = Array.from(files).slice(0, room);
    const loaded = await Promise.all(
      picked.map(
        (f) =>
          new Promise<RefItem>((res) => {
            const r = new FileReader();
            r.onload = () => res({ id: crypto.randomUUID(), dataUrl: String(r.result), label: "" });
            r.readAsDataURL(f);
          })
      )
    );
    setItems((prev) => [...prev, ...loaded].slice(0, 10));
  }, [items.length]);

  const compose = useCallback(async () => {
    if (items.length === 0) {
      onChange(null);
      return;
    }
    setBusy(true);
    try {
      const cols = items.length <= 2 ? items.length : items.length <= 6 ? 3 : 4;
      const rows = Math.ceil(items.length / cols);
      const CELL = 340, PAD = 14, CAP = 40, TITLE = 52;
      const cw = CELL + 2 * PAD;
      const ch = CELL + CAP + 2 * PAD;
      const W = cols * cw;
      const H = TITLE + rows * ch;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#1e1e1e";
      ctx.fillRect(0, 0, W, TITLE);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 26px Arial, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(title || "Reference", 18, TITLE / 2);

      const imgs = await Promise.all(
        items.map(
          (it) =>
            new Promise<HTMLImageElement>((res, rej) => {
              const im = new Image();
              im.onload = () => res(im);
              im.onerror = rej;
              im.src = it.dataUrl;
            })
        )
      );
      imgs.forEach((im, i) => {
        const cx = (i % cols) * cw;
        const cy = TITLE + Math.floor(i / cols) * ch;
        const scale = Math.min(CELL / im.width, CELL / im.height);
        const dw = im.width * scale;
        const dh = im.height * scale;
        ctx.drawImage(im, cx + PAD + (CELL - dw) / 2, cy + PAD + (CELL - dh) / 2, dw, dh);
        ctx.strokeStyle = "#333333";
        ctx.lineWidth = 2;
        ctx.strokeRect(cx + PAD, cy + PAD, CELL, CELL);
        ctx.fillStyle = "#111111";
        ctx.font = "bold 20px Arial, sans-serif";
        ctx.textBaseline = "top";
        ctx.fillText((items[i]?.label || "").slice(0, 48), cx + PAD, cy + PAD + CELL + 8);
      });
      onChange(canvas.toDataURL("image/jpeg", 0.82));
    } finally {
      setBusy(false);
    }
  }, [items, title, onChange]);

  const removeItem = (id: string) => setItems((prev) => prev.filter((x) => x.id !== id));
  const setLabel = (id: string, label: string) =>
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, label } : x)));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs"
          placeholder="Sheet title (e.g. Severity Reference)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label className="cursor-pointer rounded bg-indigo-600/80 hover:bg-indigo-600 px-2.5 py-1.5 text-xs text-white">
          Add images
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void addFiles(e.target.files);
              e.currentTarget.value = "";
            }}
          />
        </label>
      </div>

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map((it) => (
            <div key={it.id} className="rounded border border-gray-700 p-1.5 space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.dataUrl} alt="ref" className="h-20 w-full rounded object-cover" />
              <input
                className="w-full bg-gray-900 border border-gray-600 rounded px-1.5 py-1 text-[11px]"
                placeholder="Label (e.g. 2 - Moderate)"
                value={it.label}
                onChange={(e) => setLabel(it.id, e.target.value)}
              />
              <button
                type="button"
                className="w-full text-[10px] text-red-300 hover:text-red-200"
                onClick={() => removeItem(it.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || items.length === 0}
          onClick={() => void compose()}
          className="rounded bg-emerald-600/80 hover:bg-emerald-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          {busy ? "Composing…" : `Compose sheet (${items.length}/10)`}
        </button>
        {value && (
          <button
            type="button"
            className="text-xs text-red-300 hover:text-red-200"
            onClick={() => {
              setItems([]);
              onChange(null);
            }}
          >
            Clear reference
          </button>
        )}
      </div>

      {value && (
        <div className="rounded border border-gray-700 p-2">
          <p className="mb-1 text-[11px] text-gray-500">Reference image attached to this version (sent to the model at inference):</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="composed reference" className="max-h-64 w-auto rounded" />
        </div>
      )}
    </div>
  );
}
