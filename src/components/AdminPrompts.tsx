"use client";

import { useEffect, useState } from "react";

type PromptSettings = {
  prompt_assist_template: string;
  prompt_feedback_template: string;
};

export function AdminPrompts() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [data, setData] = useState<PromptSettings>({
    prompt_assist_template: "",
    prompt_feedback_template: "",
  });
  const [draft, setDraft] = useState<PromptSettings>({
    prompt_assist_template: "",
    prompt_feedback_template: "",
  });
  const [assistExpanded, setAssistExpanded] = useState(false);
  const [feedbackExpanded, setFeedbackExpanded] = useState(false);

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
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Admin</h2>
          <p className="text-sm text-gray-500">
            Manage Prompt Assist and Prompt Feedback instruction templates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded"
            >
              Edit
            </button>
          ) : (
            <>
              <button
                onClick={onSave}
                disabled={saving}
                className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => {
                  setDraft(data);
                  setEditing(false);
                }}
                className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {savedAt && <div className="text-xs text-green-400">Saved: {savedAt}</div>}
      {error && <div className="text-xs text-red-400">{error}</div>}

      {loading ? (
        <div className="text-sm text-gray-500">Loading templates...</div>
      ) : (
        <>
          <TemplateCard
            title="Prompt Assist Template"
            value={editing ? draft.prompt_assist_template : data.prompt_assist_template}
            editing={editing}
            onChange={(value) => setDraft((prev) => ({ ...prev, prompt_assist_template: value }))}
            expanded={editing || assistExpanded}
            onToggle={() => setAssistExpanded((v) => !v)}
          />
          <TemplateCard
            title="Prompt Feedback Template"
            value={editing ? draft.prompt_feedback_template : data.prompt_feedback_template}
            editing={editing}
            onChange={(value) => setDraft((prev) => ({ ...prev, prompt_feedback_template: value }))}
            expanded={editing || feedbackExpanded}
            onToggle={() => setFeedbackExpanded((v) => !v)}
          />
        </>
      )}
    </div>
  );
}

function TemplateCard({
  title,
  value,
  editing,
  onChange,
  expanded,
  onToggle,
}: {
  title: string;
  value: string;
  editing: boolean;
  onChange: (value: string) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-2">
      <button
        type="button"
        className="w-full text-left flex items-center justify-between"
        onClick={onToggle}
      >
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-blue-300">{expanded ? "Collapse" : "Expand"}</span>
      </button>
      {expanded && (
        editing ? (
          <textarea
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono min-h-[320px] max-h-[68vh] overflow-y-auto"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <pre className="text-xs whitespace-pre-wrap bg-gray-950/50 border border-gray-800 rounded p-3 text-gray-300 max-h-[58vh] overflow-y-auto">
            {value}
          </pre>
        )
      )}
    </div>
  );
}
