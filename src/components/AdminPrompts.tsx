"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type PromptSettings = {
  prompt_assist_template: string;
  prompt_feedback_template: string;
  incorrect_capture_system_prompt: string;
  incorrect_capture_user_prompt: string;
  hazard_identification_system_prompt: string;
  hazard_identification_user_prompt: string;
};

type TemplateItem = {
  key: keyof PromptSettings;
  title: string;
  description: string;
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
        body: JSON.stringify(draft),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to save admin prompts");
      setData(draft);
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
            {WORKBENCH_TEMPLATES.map((item) => (
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
        </>
      )}
    </div>
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
