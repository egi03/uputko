"""ElevenLabs webhook tool configs generated from agent/tools.schema.json (single source of truth).

    uv run python scripts/elevenlabs_tools.py            # write agent/elevenlabs/tools/*.json
    uv run python scripts/elevenlabs_tools.py --apply    # create/update tools, attach to the agent
    uv run python scripts/elevenlabs_tools.py --apply --prompt  # also the prompt, first message,
                                                                # End call and privacy settings

Uses PUBLIC_BASE_URL, ELEVENLABS_API_KEY and TOOL_SECRET from the environment or .env. --apply
stores TOOL_SECRET as an ElevenLabs workspace secret (created once, value kept in sync) and the
tools reference it by id; ELEVENLABS_TOOL_SECRET_ID overrides that. Secrets never go into the files.
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx

BACKEND = Path(__file__).resolve().parent.parent
REPO = BACKEND.parent
SCHEMA = REPO / "agent" / "tools.schema.json"
PROMPT = REPO / "agent" / "system_prompt.md"
FIRST_MESSAGE = REPO / "agent" / "first_message.txt"
OUT = REPO / "agent" / "elevenlabs" / "tools"
API = "https://api.elevenlabs.io/v1/convai/tools"
SECRETS_API = "https://api.elevenlabs.io/v1/convai/secrets"
AGENTS_API = "https://api.elevenlabs.io/v1/convai/agents"
SECRET_NAME = "uputko_tool_secret"  # noqa: S105 - the secret's name, not its value
TIMEOUT_SECS = 5  # ElevenLabs minimum; our tools answer from the local database
AGENT_NAME = "Uputko"  # the agent's name in the ElevenLabs workspace
# System tool: the agent may end the conversation (empty description = ElevenLabs' default).
END_CALL = {
    "type": "system",
    "name": "end_call",
    "description": "",
    "params": {"system_tool_type": "end_call"},
}
# No voice recordings, and transcripts are deleted right after the conversation (retention 0).
# Conversations from before the change are left as they are.
PRIVACY = {"record_voice": False, "retention_days": 0}


def _env(name: str, default: str = "") -> str:
    if name in os.environ:
        return os.environ[name]
    env_file = REPO / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip()
    return default


def _property(name: str, spec: dict[str, Any]) -> dict[str, Any]:
    prop: dict[str, Any] = {"type": spec["type"], "description": spec.get("description", name)}
    if "enum" in spec:
        prop["enum"] = spec["enum"]
        default = spec.get("default")
        if default is not None:
            prop["description"] += f" Default: {default}."
    if name == "conversation_id":
        # Bound to the system variable; the LLM never fills it. ElevenLabs rejects a description
        # next to dynamic_variable ("Can only set one of: description, dynamic_variable, …").
        prop = {"type": "string", "dynamic_variable": "system__conversation_id"}
    return prop


def tool_config(tool: dict[str, Any], base_url: str, secret_id: str) -> dict[str, Any]:
    params = tool["parameters"]
    return {
        "type": "webhook",
        "name": tool["name"],
        "description": tool["description"],
        "response_timeout_secs": TIMEOUT_SECS,
        "api_schema": {
            "url": f"{base_url.rstrip('/')}{tool['path']}",
            "method": "POST",
            "content_type": "application/json",
            "request_headers": {
                "X-Tool-Secret": {"secret_id": secret_id or "SET_ELEVENLABS_TOOL_SECRET_ID"},
                "X-Profile": "premium",
            },
            "request_body_schema": {
                "type": "object",
                "description": f"Arguments for {tool['name']}",
                "properties": {k: _property(k, v) for k, v in params["properties"].items()},
                "required": params.get("required", []),
            },
        },
    }


def ensure_secret(client: httpx.Client, value: str) -> str:
    """Workspace secret holding TOOL_SECRET: created once, afterwards its value is kept in sync."""
    resp = client.get(SECRETS_API, params={"search": SECRET_NAME})
    resp.raise_for_status()
    found = [s for s in resp.json().get("secrets", []) if s.get("name") == SECRET_NAME]
    body = {"name": SECRET_NAME, "value": value}
    if found:
        secret_id: str = found[0]["secret_id"]
        resp = client.patch(f"{SECRETS_API}/{secret_id}", json={"type": "update", **body})
        resp.raise_for_status()
        print(f"secret {SECRET_NAME}: updated ({secret_id})")
        return secret_id
    resp = client.post(SECRETS_API, json={"type": "new", **body})
    resp.raise_for_status()
    secret_id = resp.json()["secret_id"]
    print(f"secret {SECRET_NAME}: created ({secret_id})")
    return secret_id


def apply(configs: list[dict[str, Any]], client: httpx.Client) -> list[str]:
    """Creates or updates our tools; returns their ids."""
    resp = client.get(API)
    resp.raise_for_status()  # an empty list after a 429/5xx would create duplicate tools
    existing = resp.json().get("tools", [])
    by_name = {t["tool_config"]["name"]: t["id"] for t in existing if "tool_config" in t}
    ids = []
    for cfg in configs:
        body = {"tool_config": cfg}
        if cfg["name"] in by_name:
            resp = client.patch(f"{API}/{by_name[cfg['name']]}", json=body)
        else:
            resp = client.post(API, json=body)
        resp.raise_for_status()
        ids.append(resp.json().get("id") or by_name[cfg["name"]])
        print(f"{cfg['name']}: {ids[-1]}")
    return ids


def attach(client: httpx.Client, agent_id: str, tool_ids: list[str]) -> None:
    """Adds our tools to the agent; other tools stay. PATCH merges nested settings, so nothing
    else changes."""
    url = f"{AGENTS_API}/{agent_id}"
    resp = client.get(url)
    resp.raise_for_status()
    current = resp.json()["conversation_config"]["agent"]["prompt"].get("tool_ids") or []
    missing = [t for t in tool_ids if t not in current]
    if not missing:
        print("agent: tools already attached")
        return
    body = {"conversation_config": {"agent": {"prompt": {"tool_ids": current + missing}}}}
    client.patch(url, json=body).raise_for_status()
    print(f"agent: attached {len(missing)} tool(s)")


def sync_prompt(client: httpx.Client, agent_id: str) -> None:
    """System prompt, first message, the End call system tool and privacy settings from the
    repository; the voice, LLM and the rest of the agent's settings stay as set in ElevenLabs
    (PATCH merges)."""
    agent = {
        "prompt": {
            "prompt": PROMPT.read_text(encoding="utf-8"),
            # "To je sve" ends the conversation by voice.
            "built_in_tools": {"end_call": END_CALL},
        },
        "first_message": FIRST_MESSAGE.read_text(encoding="utf-8").strip(),
        "language": "hr",
    }
    body = {
        "name": AGENT_NAME,
        "conversation_config": {"agent": agent},
        "platform_settings": {"privacy": PRIVACY},
    }
    client.patch(f"{AGENTS_API}/{agent_id}", json=body).raise_for_status()
    print("agent: name, prompt, first message, End call and privacy updated")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="create/update tools via the API")
    parser.add_argument(
        "--prompt",
        action="store_true",
        help="with --apply: also the prompt, first message, End call and privacy settings",
    )
    args = parser.parse_args()
    if args.prompt and not args.apply:
        sys.exit("--prompt works only with --apply")
    base_url = _env("PUBLIC_BASE_URL", "https://example.trycloudflare.com")
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    for tool in schema["tools"]:
        # Files keep the placeholder secret id and URL so the repo never holds real values.
        public = tool_config(tool, "{PUBLIC_BASE_URL}", "")
        path = OUT / f"{tool['name']}.json"
        text = json.dumps(public, ensure_ascii=False, indent=2) + "\n"
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"wrote {path.relative_to(REPO)}")
    if not args.apply:
        return
    api_key = _env("ELEVENLABS_API_KEY")
    tool_secret = _env("TOOL_SECRET")
    secret_id = _env("ELEVENLABS_TOOL_SECRET_ID")
    if not api_key or not (tool_secret or secret_id):
        sys.exit("--apply needs ELEVENLABS_API_KEY and TOOL_SECRET in .env")
    if base_url.startswith("https://example."):
        sys.exit("Set PUBLIC_BASE_URL in .env to the tunnel URL (cloudflared) first")
    agent_id = _env("ELEVENLABS_AGENT_ID")
    with httpx.Client(headers={"xi-api-key": api_key}, timeout=30) as client:
        secret_id = secret_id or ensure_secret(client, tool_secret)
        ids = apply([tool_config(t, base_url, secret_id) for t in schema["tools"]], client)
        if agent_id:
            attach(client, agent_id, ids)
            if args.prompt:
                sync_prompt(client, agent_id)
        else:
            print("Set ELEVENLABS_AGENT_ID to attach the tools, or add them in Agent → Tools.")


if __name__ == "__main__":
    main()
