"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { DEFAULT_FEEDBACK_IMAGE_LIMITS, FEEDBACK_IMAGE_LIMIT_KEYS } from "@/lib/adminPrompts";

type PromptSettings = {
  prompt_assist_template: string;
  prompt_feedback_template: string;
  incorrect_capture_system_prompt: string;
  incorrect_capture_user_prompt: string;
  hazard_identification_system_prompt: string;
  hazard_identification_user_prompt: string;
};

type ImageLimits = Record<string, number>;

type TemplateItem = {
  key: keyof PromptSettings;
  title: string;
  description: string;
};

const IMAGE_LIMIT_LABELS: Record<string, string> = {
  feedback_fp_image_limit: "False Positives",
  feedback_fn_image_limit: "False Negatives",
  feedback_tp_image_limit: "True Positives",
  feedback_tn_image_limit: "True Negatives",
  feedback_parse_fail_image_limit: "Parse Failures",
};

const WORKBENCH_TEMPLATES: TemplateItem[] = [
  {
    key: "prompt_assist_template",
    title: "Prompt Assist Template",
    description: "Controls how new detections are scaffolded from a natural-language request.",
  },
  {
    key: "prompt_feedback_template",
    title: "Prompt Feedback Template",
    description: "Controls how post-HIL review results are analyzed for targeted prompt improvements.",
  },
];

const CATEGORY_TEMPLATES: Array<{ title: string; items: TemplateItem[] }> = [
  {
    title: "Incorrect Capture",
    items: [
      {
        key: "incorrect_capture_system_prompt",
        title: "System Prompt",
        description: "Shared system-level instruction applied to every incorrect-capture detection.",
      },
      {
        key: "incorrect_capture_user_prompt",
        title: "User Prompt",
        description: "Shared user prompt base applied to every incorrect-capture detection.",
      },
    ],
  },
  {
    title: "Hazard Identification",
    items: [
      {
        key: "hazard_identification_system_prompt",
        title: "System Prompt",
        description: "Shared system-level instruction applied to every hazard-identification detection.",
      },
      {
        key: "hazard_identification_user_prompt",
        title: "User Prompt",
        description: "Shared user prompt base applied to every hazard-identification detection.",
      },
    ],
  },
];

export function AdminPrompts() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [data, setData] = useState<PromptSettings>({
    prompt_assist_template: "",
    prompt_feedback_template: "",
    incorrect_capture_system_prompt: "",
    incorrect_capture_user_prompt: "",
    hazard_identification_system_prompt: "",
    hazard_identification_user_prompt: "",
  });
  const [draft, setDraft] = useState<PromptSettings>({
    prompt_assist_template: "",
    prompt_feedback_template: "",
    incorrect_capture_system_prompt: "",
    incorrect_capture_user_prompt: "",
    hazard_identification_system_prompt: "",
    hazard_identification_user_prompt: "",
  });
  const [imageLimits, setImageLimits] = useState<ImageLimits>({ ...DEFAULT_FEEDBACK_IMAGE_LIMITS });
  const [imageLimitsDraft, setImageLimitsDraft] = useState<ImageLimits>({ ...DEFAULT_FEEDBACK_IMAGE_LIMITS });
  const [expanded, setExpanded] = useState<Record<keyof PromptSettings, boolean>>({
    prompt_assist_template: false,
    prompt_feedback_template: false,
    incorrect_capture_system_prompt: false,
    incorrect_capture_user_prompt: false,
    hazard_identification_system_prompt: false,
    hazard_identification_user_prompt: false,
  });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/prompts");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load admin prompts");
      const next = {
        prompt_assist_template: String(json?.prompt_assist_template || ""),
        prompt_feedback_template: String(json?.prompt_feedback_template || ""),
        incorrect_capture_system_prompt: String(json?.incorrect_capture_system_prompt || ""),
        incorrect_capture_user_prompt: String(json?.incorrect_capture_user_prompt || ""),
        hazard_identification_system_prompt: String(json?.hazard_identification_system_prompt || ""),
        hazard_identification_user_prompt: String(json?.hazard_identification_user_prompt || ""),
      };
      setData(next);
      setDraft(next);

      const limits: ImageLimits = {};
      for (const key of FEEDBACK_IMAGE_LIMIT_KEYS) {
        limits[key] = typeof json?.[key] === "number" ? json[key] : DEFAULT_FEEDBACK_IMAGE_LIMITS[key];
      }
      setImageLimits(limits);
      setImageLimitsDraft(limits);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load admin prompts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onSave = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, ...imageLimitsDraft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to save admin prompts");
      setData(draft);
      setImageLimits(imageLimitsDraft);
      setEditing(false);
      setSavedAt(new Date().toLocaleString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save admin prompts");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="app-page-header">
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="app-page-title">Template Governance</h2>
          <p className="app-page-copy">
            Manage the templates that shape prompt generation and the shared category prompts applied across detections.
            These values are global system configuration, not per-detection edits.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {savedAt && <span className="app-status-chip">Saved {savedAt}</span>}
          {!editing ? (
            <button onClick={() => setEditing(true)} className="app-btn app-btn-primary app-btn-lg text-sm">
              Edit Templates
            </button>
          ) : (
            <>
              <button onClick={onSave} disabled={saving} className="app-btn app-btn-success app-btn-md text-sm">
                {saving ? "Saving..." : "Save Changes"}
              </button>
              <button
                onClick={() => {
                  setDraft(data);
                  setImageLimitsDraft(imageLimits);
                  setEditing(false);
                }}
                className="app-btn app-btn-subtle app-btn-md text-sm"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="rounded-2xl border border-[rgba(255,123,136,0.22)] bg-[rgba(85,24,31,0.68)] px-4 py-3 text-sm text-[var(--app-danger)]">{error}</div>}

      {loading ? (
        <div className="app-card px-4 py-6 text-sm text-[var(--app-text-muted)]">Loading templates...</div>
      ) : (
        <>
          <SectionBlock
            kicker="Workbench Templates"
            title="Generation and feedback templates"
            description="These templates shape how AI-assisted editing behaves across detections."
          >
            {WORKBENCH_TEMPLATES.map((item) =>
              item.key === "prompt_feedback_template" ? (
                <FeedbackTemplateCard
                  key={item.key}
                  title={item.title}
                  description={item.description}
                  value={(editing ? draft : data)[item.key]}
                  editing={editing}
                  expanded={editing || expanded[item.key]}
                  onToggle={() => setExpanded((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                  onChange={(value) => setDraft((prev) => ({ ...prev, [item.key]: value }))}
                  imageLimits={editing ? imageLimitsDraft : imageLimits}
                  onImageLimitChange={(key, val) =>
                    setImageLimitsDraft((prev) => ({ ...prev, [key]: val }))
                  }
                />
              ) : (
                <TemplateCard
                  key={item.key}
                  title={item.title}
                  description={item.description}
                  value={(editing ? draft : data)[item.key]}
                  editing={editing}
                  expanded={editing || expanded[item.key]}
                  onToggle={() => setExpanded((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                  onChange={(value) => setDraft((prev) => ({ ...prev, [item.key]: value }))}
                />
              )
            )}
          </SectionBlock>

          {CATEGORY_TEMPLATES.map((section) => (
            <SectionBlock
              key={section.title}
              kicker="Category Templates"
              title={section.title}
              description="These prompts are applied automatically to every detection in this category."
            >
              {section.items.map((item) => (
                <TemplateCard
                  key={item.key}
                  title={item.title}
                  description={item.description}
                  value={(editing ? draft : data)[item.key]}
                  editing={editing}
                  expanded={editing || expanded[item.key]}
                  onToggle={() => setExpanded((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                  onChange={(value) => setDraft((prev) => ({ ...prev, [item.key]: value }))}
                />
              ))}
            </SectionBlock>
          ))}

          <AnnotatorRegistry />
        </>
      )}
    </div>
  );
}

function AnnotatorRegistry() {
  const [annotators, setAnnotators] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/qa?action=annotators");
    if (res.ok) {
      const data = await res.json();
      setAnnotators(data.annotators || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addAnnotator = async () => {
    const name = newName.trim();
    if (!name) return;
    await fetch("/api/qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_annotator", name }),
    });
    setNewName("");
    load();
  };

  const removeAnnotator = async (name: string) => {
    await fetch("/api/qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove_annotator", name }),
    });
    load();
  };

  return (
    <section className="app-card-strong space-y-4 p-5">
      <div>
        <div className="app-kicker mb-2">User Management</div>
        <h3 className="text-lg font-semibold text-white">Annotator Registry</h3>
        <p className="mt-1 text-sm text-[var(--app-text-muted)]">
          Manage the list of annotators available for dataset assignment.
        </p>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1 max-w-xs">
          <label className="app-label mb-1 block text-xs">New annotator name</label>
          <input
            type="text"
            className="app-input px-3 py-2 text-sm"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addAnnotator()}
            placeholder="e.g. Jane Smith"
          />
        </div>
        <button
          onClick={addAnnotator}
          disabled={!newName.trim()}
          className="app-btn app-btn-primary app-btn-md text-sm disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {loading ? (
        <p className="text-sm text-[var(--app-text-muted)]">Loading...</p>
      ) : annotators.length === 0 ? (
        <p className="text-sm text-[var(--app-text-muted)]">No annotators registered yet.</p>
      ) : (
        <div className="space-y-1">
          {annotators.map((name) => (
            <div
              key={name}
              className="flex items-center justify-between rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-soft)] px-4 py-2"
            >
              <span className="text-sm text-[var(--app-text)]">{name}</span>
              <button
                onClick={() => removeAnnotator(name)}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SectionBlock({
  kicker,
  title,
  description,
  children,
}: {
  kicker: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="app-card-strong space-y-4 p-5">
      <div>
        <div className="app-kicker mb-2">{kicker}</div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="mt-1 text-sm text-[var(--app-text-muted)]">{description}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function TemplateCard({
  title,
  description,
  value,
  editing,
  onChange,
  expanded,
  onToggle,
}: {
  title: string;
  description: string;
  value: string;
  editing: boolean;
  onChange: (value: string) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="app-card overflow-hidden">
      <button type="button" className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left" onClick={onToggle}>
        <div>
          <h4 className="text-sm font-medium text-white">{title}</h4>
          <p className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">{description}</p>
        </div>
        <span className="text-xs font-medium text-[var(--app-accent)]">{expanded ? "Collapse" : "Expand"}</span>
      </button>
      {expanded && (
        <div className="border-t border-white/6 px-4 py-4">
          {editing ? (
            <textarea
              className="app-textarea min-h-[320px] max-h-[68vh] overflow-y-auto px-3 py-3 text-xs font-mono"
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          ) : (
            <pre className="rounded-2xl border border-white/6 bg-[rgba(5,13,20,0.72)] p-4 text-xs text-gray-300 whitespace-pre-wrap max-h-[58vh] overflow-y-auto">
              {value}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function FeedbackTemplateCard({
  title,
  description,
  value,
  editing,
  onChange,
  expanded,
  onToggle,
  imageLimits,
  onImageLimitChange,
}: {
  title: string;
  description: string;
  value: string;
  editing: boolean;
  onChange: (value: string) => void;
  expanded: boolean;
  onToggle: () => void;
  imageLimits: ImageLimits;
  onImageLimitChange: (key: string, val: number) => void;
}) {
  return (
    <div className="app-card overflow-hidden">
      <button type="button" className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left" onClick={onToggle}>
        <div>
          <h4 className="text-sm font-medium text-white">{title}</h4>
          <p className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">{description}</p>
        </div>
        <span className="text-xs font-medium text-[var(--app-accent)]">{expanded ? "Collapse" : "Expand"}</span>
      </button>
      {expanded && (
        <div className="border-t border-white/6 px-4 py-4 space-y-4">
          <div>
            <h5 className="text-sm font-semibold text-white mb-1">Image Limits</h5>
            <p className="text-xs text-[var(--app-text-muted)] mb-3">
              Maximum number of images sent to the VLM for each outcome type during prompt feedback analysis. Set 0 to disable a category.
            </p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {FEEDBACK_IMAGE_LIMIT_KEYS.map((key) => (
                <div key={key}>
                  <label className="block text-xs text-gray-400 mb-1">
                    {IMAGE_LIMIT_LABELS[key] || key}
                  </label>
                  {editing ? (
                    <input
                      type="number"
                      min={0}
                      max={20}
                      className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm"
                      value={imageLimits[key] ?? DEFAULT_FEEDBACK_IMAGE_LIMITS[key]}
                      onChange={(e) =>
                        onImageLimitChange(key, Math.max(0, Math.min(20, parseInt(e.target.value) || 0)))
                      }
                    />
                  ) : (
                    <div className="rounded-lg border border-white/8 bg-[rgba(5,13,20,0.72)] px-3 py-2 text-sm text-gray-200">
                      {imageLimits[key] ?? DEFAULT_FEEDBACK_IMAGE_LIMITS[key]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          {editing ? (
            <textarea
              className="app-textarea min-h-[320px] max-h-[68vh] overflow-y-auto px-3 py-3 text-xs font-mono"
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          ) : (
            <pre className="rounded-2xl border border-white/6 bg-[rgba(5,13,20,0.72)] p-4 text-xs text-gray-300 whitespace-pre-wrap max-h-[58vh] overflow-y-auto">
              {value}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
