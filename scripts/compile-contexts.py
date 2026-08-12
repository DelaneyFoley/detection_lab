#!/usr/bin/env python3
"""
Compile the production context aggregate compositions from the read-only
`ai-services` source (Slice S1).

This imports the REAL production definitions (`ai.lookups.CONTEXTS`) and emits,
for each VLM detection context, the exact `build_prompt()` output, the dynamic
`response_format` JSON schema, model, thinking level, and ordered members. It
runs the real production assembly so there is zero drift.

It is strictly read-only: it only imports `ai-services` modules and reads git
metadata. It never writes to that repository.

Usage:
    python3 compile-contexts.py [AI_SERVICES_PATH]

AI_SERVICES_PATH may also be provided via the AI_SERVICES_PATH env var. When
omitted, defaults to a sibling `../ai-services` directory. Output is a single
JSON document printed to stdout.
"""
import hashlib
import json
import os
import subprocess
import sys


def resolve_ai_services_path() -> str:
    if len(sys.argv) > 1 and sys.argv[1].strip():
        return os.path.abspath(sys.argv[1].strip())
    env = os.environ.get("AI_SERVICES_PATH", "").strip()
    if env:
        return os.path.abspath(env)
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "..", "ai-services"))


def git_revision(repo_path: str) -> str:
    try:
        out = subprocess.run(
            ["git", "-C", repo_path, "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return out.stdout.strip() if out.returncode == 0 else ""
    except Exception:
        return ""


def member_role(index: int, detection_count: int, has_ic: bool) -> str:
    if index < detection_count:
        return "detection"
    if has_ic and index == detection_count:
        return "ic_correct"
    return "ic_incorrect"


def main() -> int:
    ai_path = resolve_ai_services_path()
    if not os.path.isdir(ai_path):
        json.dump({"error": f"ai-services path not found: {ai_path}", "contexts": []}, sys.stdout)
        return 2

    sys.path.insert(0, ai_path)
    try:
        from ai.lookups import CONTEXTS
    except Exception as exc:  # noqa: BLE001
        try:
            listing = sorted(os.listdir(ai_path))[:20]
        except Exception:
            listing = []
        json.dump(
            {
                "error": f"failed to import ai.lookups: {exc}",
                "diagnostics": {
                    "python": sys.executable,
                    "ai_path": ai_path,
                    "isdir": os.path.isdir(ai_path),
                    "listing": listing,
                    "sys_path_head": sys.path[:3],
                },
                "contexts": [],
            },
            sys.stdout,
        )
        return 3

    source_revision = git_revision(ai_path)
    contexts = []
    for ctx in CONTEXTS:
        all_detections = ctx.all_detections
        if not all_detections:
            # Non-VLM / service-only contexts have no aggregate prompt.
            continue

        detection_count = len(ctx.detections)
        has_ic = ctx.incorrect_capture is not None
        members = [
            {
                "role": member_role(idx, detection_count, has_ic),
                "label": det.label,
                "description": det.description,
                "position": idx + 1,
            }
            for idx, det in enumerate(all_detections)
        ]

        built_prompt = ctx.build_prompt()
        response_schema = ctx.response_format.model_json_schema()
        google_model = ctx.google_model.value
        thinking_level = ctx.thinking_level.value
        has_vlm = any(step.name == "VLM" for step in ctx.processing_steps)

        checksum = hashlib.sha256(
            json.dumps(
                {
                    "google_model": google_model,
                    "thinking_level": thinking_level,
                    "built_prompt": built_prompt,
                    "members": members,
                    "response_schema": response_schema,
                },
                sort_keys=True,
                ensure_ascii=False,
            ).encode("utf-8")
        ).hexdigest()

        contexts.append(
            {
                "name": ctx.name,
                "has_vlm": has_vlm,
                "google_model": google_model,
                "thinking_level": thinking_level,
                "detection_count": detection_count,
                "members": members,
                "built_prompt": built_prompt,
                "response_schema": response_schema,
                "checksum": checksum,
            }
        )

    contexts.sort(key=lambda c: c["name"])
    json.dump(
        {"source_revision": source_revision, "context_count": len(contexts), "contexts": contexts},
        sys.stdout,
        ensure_ascii=False,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
