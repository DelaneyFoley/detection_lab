"use client";

import type { ProductionSnapshot } from "@/types";

const INPUT_CLS = "w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm";
const LABEL_CLS = "text-xs text-gray-400 block mb-1";

/**
 * Authoring UI for a SINGLE DETECTION (PC-001). A single detection runs exactly
 * like a production-context aggregate but over one detection: pick the context
 * whose shared instructions (preamble) the detection runs inside, set the
 * mandatory production label (the label whose presence means DETECTED), and
 * author the Detection Prompt (the detection block's description). No system
 * prompt, no decision policy, no decision rubric.
 */
export function SingleDetectionPanel({
  contextNames,
  selectedContext,
  onSelectContext,
  snapshot,
  ctxLoading,
  ctxError,
  productionLabel,
  onChangeProductionLabel,
  detectionPrompt,
  onChangeDetectionPrompt,
  preamble,
  compiledPreview,
  disabled,
}: {
  contextNames: string[];
  selectedContext: string;
  onSelectContext: (name: string) => void;
  snapshot: ProductionSnapshot | null;
  ctxLoading: boolean;
  ctxError: string;
  productionLabel: string;
  onChangeProductionLabel: (value: string) => void;
  detectionPrompt: string;
  onChangeDetectionPrompt: (value: string) => void;
  preamble: string;
  compiledPreview: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <label className={LABEL_CLS}>Context</label>
          <select
            className={INPUT_CLS}
            value={selectedContext}
            onChange={(e) => onSelectContext(e.target.value)}
            disabled={disabled}
          >
            <option value="">Select a production context…</option>
            {contextNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--app-text-muted)]">
            The context this detection will be inserted into. Its shared instructions become the
            prompt preamble (frozen as a snapshot for reproducibility).
          </p>
          {ctxLoading && <p className="mt-1 text-xs text-[var(--app-text-muted)]">Importing context snapshot…</p>}
          {ctxError && <p className="mt-1 text-xs text-red-400">{ctxError}</p>}
        </div>
        <div>
          <label className={LABEL_CLS}>Production Label (required)</label>
          <input
            className={INPUT_CLS}
            value={productionLabel}
            onChange={(e) => onChangeProductionLabel(e.target.value)}
            placeholder="e.g. major corrosion"
            disabled={disabled}
          />
          <p className="mt-1 text-xs text-[var(--app-text-muted)]">
            The label returned by the model that maps to DETECTED for this single detection.
          </p>
        </div>
      </div>

      <div>
        <label className={LABEL_CLS}>User Prompt Shared Instructions</label>
        <div className="app-card w-full px-3 py-2 text-sm min-h-16 whitespace-pre-wrap text-[var(--app-text-muted)]">
          {snapshot ? preamble || "(context has no shared preamble)" : "Select a context to load its shared instructions."}
        </div>
        <div className="mt-1 text-[11px] text-gray-500">Sourced from the selected context. Not editable here.</div>
      </div>

      <div>
        <label className={LABEL_CLS}>Detection Prompt</label>
        <textarea
          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm min-h-[8rem] resize-none overflow-hidden"
          value={detectionPrompt}
          onChange={(e) => {
            onChangeDetectionPrompt(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = e.target.scrollHeight + "px";
          }}
          ref={(el) => {
            if (el) {
              el.style.height = "auto";
              el.style.height = el.scrollHeight + "px";
            }
          }}
          placeholder="Describe what the model should look for. This becomes the detection block inside the shared instructions."
          disabled={disabled}
        />
      </div>

      {snapshot && (
        <div>
          <label className={LABEL_CLS}>Compiled Prompt Preview</label>
          <div className="app-card w-full px-3 py-2 text-xs min-h-24 max-h-64 overflow-auto whitespace-pre-wrap text-[var(--app-text)]">
            {compiledPreview}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">
            Exactly what runs: the context preamble followed by this one detection block. DETECTED means
            the model returns the production label.
          </div>
        </div>
      )}
    </div>
  );
}
