# Ollama Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ollama as a first-class LLM provider with a type-selector preset, per-provider connection status badge, and model count in the Settings UI.

**Architecture:** A new `provider_type` field (`"ollama" | "lmstudio" | "github_models" | "custom"`) is added to the `LLMProvider` schema and stored in vault notes. No registry routing changes — all types continue to use `OpenAICompatibleClient`. The Settings UI gains a type dropdown that pre-fills URL/name/local and a per-row status badge using the existing `useLLMModels` hook.

**Tech Stack:** Python / Pydantic (backend schema), FastAPI (API router), TypeScript / React / React Query (frontend), Vitest + MSW (frontend tests), pytest (backend tests)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `apps/backend/src/lifescribe/vault/schemas.py` | Add `provider_type` field to `LLMProvider` |
| Modify | `apps/backend/src/lifescribe/api/routers/llm.py` | Accept and pass through `provider_type` in create/update |
| Create | `apps/backend/src/lifescribe/llm/providers/ollama.py` | Ollama preset dataclass (mirrors `lmstudio.py`) |
| Modify | `apps/desktop/src/api/client.ts` | Add `provider_type` to `LLMProviderDTO` |
| Modify | `apps/desktop/src/routes/SettingsRoute.tsx` | Type selector, auto-fill presets, status badges |
| Modify | `apps/backend/tests/test_schemas.py` | Schema tests for `provider_type` field |
| Modify | `apps/backend/tests/test_api_llm_providers.py` | API tests for `provider_type` round-trip |
| Modify | `apps/desktop/src/routes/__tests__/SettingsRoute.test.tsx` | UI tests for type selector and status badges |

---

## Task 1: Add `provider_type` to `LLMProvider` schema

**Files:**
- Modify: `apps/backend/src/lifescribe/vault/schemas.py` (~line 204)
- Test: `apps/backend/tests/test_schemas.py`

- [ ] **Step 1: Write the failing tests**

Append to `apps/backend/tests/test_schemas.py`:

```python
def test_llm_provider_defaults_provider_type_to_custom() -> None:
    from lifescribe.vault.schemas import LLMProvider

    note = LLMProvider(
        id="llm_x_abc123",
        type="LLMProvider",
        display_name="X",
        base_url="http://localhost:11434/v1",
        local=True,
    )
    assert note.provider_type == "custom"


def test_llm_provider_accepts_ollama_type() -> None:
    from lifescribe.vault.schemas import LLMProvider

    note = LLMProvider(
        id="llm_ollama_abc123",
        type="LLMProvider",
        display_name="Ollama",
        base_url="http://localhost:11434/v1",
        local=True,
        provider_type="ollama",
    )
    assert note.provider_type == "ollama"


def test_llm_provider_parses_provider_type_from_dict() -> None:
    from lifescribe.vault.schemas import parse_note

    data = {
        "id": "llm_ollama_abc123",
        "type": "LLMProvider",
        "schema_version": 1,
        "adapter": "openai_compatible",
        "display_name": "Ollama",
        "base_url": "http://localhost:11434/v1",
        "local": True,
        "secret_ref": None,
        "default_model": None,
        "enabled": True,
        "provider_type": "ollama",
    }
    note = parse_note(data)
    assert note.provider_type == "ollama"  # type: ignore[union-attr]


def test_llm_provider_missing_provider_type_defaults_custom() -> None:
    from lifescribe.vault.schemas import parse_note

    data = {
        "id": "llm_old_abc123",
        "type": "LLMProvider",
        "schema_version": 1,
        "adapter": "openai_compatible",
        "display_name": "Old Provider",
        "base_url": "http://127.0.0.1:1234/v1",
        "local": True,
        "secret_ref": None,
        "default_model": None,
        "enabled": True,
    }
    note = parse_note(data)
    assert note.provider_type == "custom"  # type: ignore[union-attr]
```

- [ ] **Step 2: Run tests to confirm they fail**

```
cd apps/backend
.venv/Scripts/python.exe -m pytest tests/test_schemas.py::test_llm_provider_defaults_provider_type_to_custom tests/test_schemas.py::test_llm_provider_accepts_ollama_type -v
```

Expected: FAIL with `AttributeError` or similar — `provider_type` does not exist yet.

- [ ] **Step 3: Add `provider_type` to `LLMProvider` in `schemas.py`**

In `apps/backend/src/lifescribe/vault/schemas.py`, find `class LLMProvider(_NoteBase):` and add the field after `adapter`:

```python
class LLMProvider(_NoteBase):
    type: Literal["LLMProvider"] = "LLMProvider"
    adapter: Literal["openai_compatible"] = "openai_compatible"
    provider_type: Literal["ollama", "lmstudio", "github_models", "custom"] = "custom"
    display_name: str
    base_url: str
    local: bool
    secret_ref: str | None = None
    default_model: str | None = None
    enabled: bool = True

    @model_validator(mode="after")
    def _check_id_prefix(self) -> LLMProvider:
        if not self.id.startswith("llm_"):
            raise ValueError("LLMProvider id must start with 'llm_'")
        return self
```

- [ ] **Step 4: Run all new schema tests**

```
cd apps/backend
.venv/Scripts/python.exe -m pytest tests/test_schemas.py -v -k "provider_type or llm_provider"
```

Expected: all 6 LLMProvider tests pass (the 2 existing ones plus the 4 new ones).

- [ ] **Step 5: Commit**

```
git add apps/backend/src/lifescribe/vault/schemas.py apps/backend/tests/test_schemas.py
git commit -m "feat: add provider_type field to LLMProvider schema"
```

---

## Task 2: Pass `provider_type` through the API router

**Files:**
- Modify: `apps/backend/src/lifescribe/api/routers/llm.py`
- Test: `apps/backend/tests/test_api_llm_providers.py`

- [ ] **Step 1: Write the failing tests**

Append to `apps/backend/tests/test_api_llm_providers.py`:

```python
def test_create_provider_stores_and_returns_provider_type(tmp_path) -> None:
    _, client = _setup(tmp_path)
    body = {
        "display_name": "Ollama",
        "base_url": "http://localhost:11434/v1",
        "local": True,
        "provider_type": "ollama",
    }
    r = client.post("/llm/providers", json=body, headers=AUTH)
    assert r.status_code == 201
    assert r.json()["provider_type"] == "ollama"


def test_create_provider_defaults_provider_type_to_custom(tmp_path) -> None:
    _, client = _setup(tmp_path)
    body = {
        "display_name": "My Provider",
        "base_url": "http://127.0.0.1:1234/v1",
        "local": True,
    }
    r = client.post("/llm/providers", json=body, headers=AUTH)
    assert r.status_code == 201
    assert r.json()["provider_type"] == "custom"


def test_update_provider_changes_provider_type(tmp_path) -> None:
    _, client = _setup(tmp_path)
    r = client.post(
        "/llm/providers",
        json={"display_name": "X", "base_url": "http://localhost:11434/v1", "local": True},
        headers=AUTH,
    )
    pid = r.json()["id"]
    r = client.put(
        f"/llm/providers/{pid}",
        json={
            "display_name": "Ollama",
            "base_url": "http://localhost:11434/v1",
            "local": True,
            "provider_type": "ollama",
        },
        headers=AUTH,
    )
    assert r.status_code == 200
    assert r.json()["provider_type"] == "ollama"
```

- [ ] **Step 2: Run tests to confirm they fail**

```
cd apps/backend
.venv/Scripts/python.exe -m pytest tests/test_api_llm_providers.py::test_create_provider_stores_and_returns_provider_type -v
```

Expected: FAIL — `provider_type` not in response body.

- [ ] **Step 3: Update `_ProviderBody` and route handlers in `llm.py`**

In `apps/backend/src/lifescribe/api/routers/llm.py`, add `Literal` to the typing import:

```python
from typing import Any, Literal
```

Update `_ProviderBody` to include `provider_type`:

```python
class _ProviderBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str
    base_url: str
    local: bool
    adapter: str = "openai_compatible"
    provider_type: Literal["ollama", "lmstudio", "github_models", "custom"] = "custom"
    secret_ref: str | None = None
    default_model: str | None = None
    enabled: bool = True
```

In `create_provider`, pass `provider_type` when constructing the note:

```python
note = LLMProvider(
    id=pid,
    type="LLMProvider",
    adapter="openai_compatible",
    provider_type=body.provider_type,
    display_name=body.display_name,
    base_url=body.base_url,
    local=body.local,
    secret_ref=body.secret_ref,
    default_model=body.default_model,
    enabled=body.enabled,
)
```

In `update_provider`, pass `provider_type` when constructing the updated note:

```python
note = LLMProvider(
    id=provider_id,
    type="LLMProvider",
    adapter="openai_compatible",
    provider_type=body.provider_type,
    display_name=body.display_name,
    base_url=body.base_url,
    local=body.local,
    secret_ref=body.secret_ref if body.secret_ref is not None else existing.secret_ref,
    default_model=body.default_model,
    enabled=body.enabled,
)
```

- [ ] **Step 4: Run all provider API tests**

```
cd apps/backend
.venv/Scripts/python.exe -m pytest tests/test_api_llm_providers.py -v
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```
git add apps/backend/src/lifescribe/api/routers/llm.py apps/backend/tests/test_api_llm_providers.py
git commit -m "feat: pass provider_type through LLM provider API"
```

---

## Task 3: Create the Ollama provider module

**Files:**
- Create: `apps/backend/src/lifescribe/llm/providers/ollama.py`

- [ ] **Step 1: Create `ollama.py`**

Create `apps/backend/src/lifescribe/llm/providers/ollama.py`:

```python
from __future__ import annotations

from dataclasses import dataclass

from lifescribe.llm.openai_compatible import OpenAICompatibleClient
from lifescribe.vault.schemas import LLMProvider


@dataclass
class OllamaProvider:
    client: OpenAICompatibleClient

    @classmethod
    def from_note(cls, note: LLMProvider, *, token: str | None = None) -> OllamaProvider:
        return cls(
            client=OpenAICompatibleClient(
                base_url=note.base_url,
                token=token,
                local=True,
                requires_token=False,
                provider_id=note.id,
            )
        )
```

- [ ] **Step 2: Verify it imports cleanly**

```
cd apps/backend
.venv/Scripts/python.exe -c "from lifescribe.llm.providers.ollama import OllamaProvider; print('ok')"
```

Expected output: `ok`

- [ ] **Step 3: Run full backend test suite to check for regressions**

```
cd apps/backend
.venv/Scripts/python.exe -m pytest tests/ -q --tb=short
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```
git add apps/backend/src/lifescribe/llm/providers/ollama.py
git commit -m "feat: add OllamaProvider preset module"
```

---

## Task 4: Add `provider_type` to the frontend DTO

**Files:**
- Modify: `apps/desktop/src/api/client.ts`

- [ ] **Step 1: Add `provider_type` to `LLMProviderDTO`**

In `apps/desktop/src/api/client.ts`, update `LLMProviderDTO`:

```typescript
export interface LLMProviderDTO {
  id: string;
  type: "LLMProvider";
  display_name: string;
  base_url: string;
  local: boolean;
  secret_ref: string | null;
  default_model: string | null;
  enabled: boolean;
  has_credential: boolean;
  schema_version: number;
  provider_type: "ollama" | "lmstudio" | "github_models" | "custom";
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```
cd apps/desktop
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```
git add apps/desktop/src/api/client.ts
git commit -m "feat: add provider_type to LLMProviderDTO"
```

---

## Task 5: Settings UI — type selector, auto-fill presets, and status badges

**Files:**
- Modify: `apps/desktop/src/routes/SettingsRoute.tsx`
- Test: `apps/desktop/src/routes/__tests__/SettingsRoute.test.tsx`

- [ ] **Step 1: Write the failing tests**

Replace the contents of `apps/desktop/src/routes/__tests__/SettingsRoute.test.tsx` with:

```typescript
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import SettingsRoute from "../SettingsRoute";
import { BASE, server } from "../../test/mswServer";
import { renderWithProviders } from "../../test/renderWithProviders";

const EMPTY_PROVIDERS: never[] = [];

describe("SettingsRoute", () => {
  it("prefills from server and saves changes", async () => {
    let current = { id: "settings_default", type: "VaultSettings", privacy_mode: false };
    server.use(
      http.get(`${BASE}/vault/settings`, () => HttpResponse.json(current)),
      http.put(`${BASE}/vault/settings`, async ({ request }) => {
        const body = (await request.json()) as { privacy_mode: boolean };
        current = { ...current, privacy_mode: body.privacy_mode };
        return HttpResponse.json(current);
      }),
      http.get(`${BASE}/llm/providers`, () => HttpResponse.json(EMPTY_PROVIDERS)),
    );
    renderWithProviders(<SettingsRoute />, { initialEntries: ["/settings"] });
    const toggle = await screen.findByRole("checkbox", { name: /privacy/i });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    const privacySection = screen.getByRole("heading", { name: /privacy/i }).closest("section")!;
    await userEvent.click(within(privacySection).getByRole("button", { name: /save/i }));
    await waitFor(() => expect(screen.getByText(/saved/i)).toBeInTheDocument());
  });

  it("selecting Ollama preset pre-fills name and URL", async () => {
    server.use(
      http.get(`${BASE}/vault/settings`, () =>
        HttpResponse.json({ id: "settings_default", type: "VaultSettings", privacy_mode: false }),
      ),
      http.get(`${BASE}/llm/providers`, () => HttpResponse.json(EMPTY_PROVIDERS)),
    );
    renderWithProviders(<SettingsRoute />, { initialEntries: ["/settings"] });
    await screen.findByText(/LLM Providers/i);

    const typeSelect = screen.getByRole("combobox", { name: /provider type/i });
    await userEvent.selectOptions(typeSelect, "ollama");

    const nameInput = screen.getByPlaceholderText(/display name/i) as HTMLInputElement;
    const urlInput = screen.getByPlaceholderText(/base url/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Ollama");
    expect(urlInput.value).toBe("http://localhost:11434/v1");
  });

  it("selecting LM Studio preset pre-fills name and URL", async () => {
    server.use(
      http.get(`${BASE}/vault/settings`, () =>
        HttpResponse.json({ id: "settings_default", type: "VaultSettings", privacy_mode: false }),
      ),
      http.get(`${BASE}/llm/providers`, () => HttpResponse.json(EMPTY_PROVIDERS)),
    );
    renderWithProviders(<SettingsRoute />, { initialEntries: ["/settings"] });
    await screen.findByText(/LLM Providers/i);

    const typeSelect = screen.getByRole("combobox", { name: /provider type/i });
    await userEvent.selectOptions(typeSelect, "lmstudio");

    const nameInput = screen.getByPlaceholderText(/display name/i) as HTMLInputElement;
    const urlInput = screen.getByPlaceholderText(/base url/i) as HTMLInputElement;
    expect(nameInput.value).toBe("LM Studio");
    expect(urlInput.value).toBe("http://127.0.0.1:1234/v1");
  });

  it("provider row shows Online status when models load", async () => {
    const provider = {
      id: "llm_ollama_abc123",
      type: "LLMProvider",
      display_name: "Ollama",
      base_url: "http://localhost:11434/v1",
      local: true,
      secret_ref: null,
      default_model: null,
      enabled: true,
      has_credential: false,
      schema_version: 1,
      provider_type: "ollama",
    };
    server.use(
      http.get(`${BASE}/vault/settings`, () =>
        HttpResponse.json({ id: "settings_default", type: "VaultSettings", privacy_mode: false }),
      ),
      http.get(`${BASE}/llm/providers`, () => HttpResponse.json([provider])),
      http.get(`${BASE}/llm/providers/llm_ollama_abc123/models`, () =>
        HttpResponse.json([{ id: "llama3.2" }, { id: "mistral" }]),
      ),
    );
    renderWithProviders(<SettingsRoute />, { initialEntries: ["/settings"] });
    await waitFor(() =>
      expect(screen.getByText(/Online · 2 models/i)).toBeInTheDocument(),
    );
  });

  it("provider row shows Offline when models endpoint errors", async () => {
    const provider = {
      id: "llm_ollama_abc123",
      type: "LLMProvider",
      display_name: "Ollama",
      base_url: "http://localhost:11434/v1",
      local: true,
      secret_ref: null,
      default_model: null,
      enabled: true,
      has_credential: false,
      schema_version: 1,
      provider_type: "ollama",
    };
    server.use(
      http.get(`${BASE}/vault/settings`, () =>
        HttpResponse.json({ id: "settings_default", type: "VaultSettings", privacy_mode: false }),
      ),
      http.get(`${BASE}/llm/providers`, () => HttpResponse.json([provider])),
      http.get(`${BASE}/llm/providers/llm_ollama_abc123/models`, () =>
        HttpResponse.json({ detail: "upstream error" }, { status: 502 }),
      ),
    );
    renderWithProviders(<SettingsRoute />, { initialEntries: ["/settings"] });
    await waitFor(() =>
      expect(screen.getByText(/Offline/i)).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```
cd apps/desktop
npx vitest run --reporter=verbose src/routes/__tests__/SettingsRoute.test.tsx
```

Expected: the 4 new tests fail (elements not found).

- [ ] **Step 3: Implement the UI changes in `SettingsRoute.tsx`**

Replace the full contents of `apps/desktop/src/routes/SettingsRoute.tsx` with:

```tsx
import { useEffect, useState } from "react";

import {
  useCreateLLMProvider,
  useDeleteLLMProvider,
  useIndexStatus,
  useLLMModels,
  useLLMProviders,
  useReindex,
  useSaveSettings,
  useSettings,
} from "../api/queries";
import { LLMProviderDTO } from "../api/client";
import ConnectorsBrowser from "../components/ConnectorsBrowser";

type ProviderType = "ollama" | "lmstudio" | "github_models" | "custom";

const PRESETS: Record<ProviderType, { display_name: string; base_url: string; local: boolean }> = {
  ollama: { display_name: "Ollama", base_url: "http://localhost:11434/v1", local: true },
  lmstudio: { display_name: "LM Studio", base_url: "http://127.0.0.1:1234/v1", local: true },
  github_models: {
    display_name: "GitHub Models",
    base_url: "https://models.inference.ai.azure.com",
    local: false,
  },
  custom: { display_name: "", base_url: "", local: true },
};

function ProviderStatusBadge({ providerId }: { providerId: string }) {
  const { data, isLoading, isError } = useLLMModels(providerId);
  if (isLoading) return <span style={{ color: "#888" }}>Checking…</span>;
  if (isError || !data) return <span style={{ color: "#b00" }}>Offline</span>;
  return (
    <span style={{ color: "#080" }}>
      Online · {data.length} model{data.length !== 1 ? "s" : ""}
    </span>
  );
}

function DefaultChatModel() {
  const { data: providers } = useLLMProviders();
  const { data: settings } = useSettings();
  const save = useSaveSettings();
  const [providerId, setProviderId] = useState(settings?.default_chat_provider_id ?? "");
  const { data: models } = useLLMModels(providerId || undefined);
  const [model, setModel] = useState(settings?.default_chat_model ?? "");

  useEffect(() => {
    if (settings) {
      setProviderId(settings.default_chat_provider_id ?? "");
      setModel(settings.default_chat_model ?? "");
    }
  }, [settings]);

  function providerLabel(p: LLMProviderDTO) {
    const tag = p.provider_type && p.provider_type !== "custom" ? ` (${p.provider_type})` : "";
    return `${p.display_name}${tag}`;
  }

  return (
    <fieldset>
      <legend>Default chat model</legend>
      <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
        <option value="">— none —</option>
        {providers?.map((p) => (
          <option key={p.id} value={p.id}>
            {providerLabel(p)}
          </option>
        ))}
      </select>{" "}
      <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!providerId}>
        <option value="">— none —</option>
        {models?.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={save.isPending}
        onClick={() =>
          save.mutate({
            privacy_mode: settings?.privacy_mode ?? false,
            default_chat_provider_id: providerId || null,
            default_chat_model: model || null,
          })
        }
      >
        Save
      </button>
    </fieldset>
  );
}

function LLMProvidersSection() {
  const { data: providers } = useLLMProviders();
  const create = useCreateLLMProvider();
  const del = useDeleteLLMProvider();
  const [providerType, setProviderType] = useState<ProviderType>("custom");
  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [local, setLocal] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  function onTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const t = e.target.value as ProviderType;
    setProviderType(t);
    const preset = PRESETS[t];
    setDisplayName(preset.display_name);
    setBaseUrl(preset.base_url);
    setLocal(preset.local);
  }

  async function onAdd() {
    setErr(null);
    try {
      await create.mutateAsync({
        display_name: displayName,
        base_url: baseUrl,
        local,
        provider_type: providerType,
      });
      setDisplayName("");
      setBaseUrl("");
      setProviderType("custom");
      setLocal(true);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <fieldset>
      <legend>LLM Providers</legend>
      {providers && providers.length === 0 && (
        <div style={{ color: "#888", marginBottom: 8 }}>No providers yet.</div>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
        {providers?.map((p) => (
          <li key={p.id} style={{ marginBottom: 4 }}>
            <strong>{p.display_name}</strong>{" "}
            <span style={{ color: "#666" }}>
              ({p.local ? "local" : "remote"}) — {p.base_url}
            </span>{" "}
            <ProviderStatusBadge providerId={p.id} />{" "}
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete provider "${p.display_name}"?`)) del.mutate(p.id);
              }}
              disabled={del.isPending}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label htmlFor="provider-type-select">Provider type</label>
        <select id="provider-type-select" value={providerType} onChange={onTypeChange}>
          <option value="ollama">Ollama</option>
          <option value="lmstudio">LM Studio</option>
          <option value="github_models">GitHub Models</option>
          <option value="custom">Custom</option>
        </select>
        <input
          placeholder="Display name (e.g. LM Studio)"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <input
          placeholder="Base URL"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          style={{ width: 260 }}
        />
        <label>
          <input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} />{" "}
          Local
        </label>
        <button
          type="button"
          disabled={!displayName || !baseUrl || create.isPending}
          onClick={onAdd}
        >
          {create.isPending ? "Adding…" : "Add provider"}
        </button>
      </div>
      {err && (
        <div role="alert" style={{ color: "#b00", marginTop: 8 }}>
          {err}
        </div>
      )}
    </fieldset>
  );
}

function ChatIndex() {
  const { data: status } = useIndexStatus();
  const reindex = useReindex();
  if (!status) return null;
  return (
    <fieldset>
      <legend>Chat index</legend>
      <div>Notes indexed: {status.note_count}</div>
      <div>Chunks: {status.chunk_count}</div>
      <div>DB size: {(status.db_size_bytes / 1024).toFixed(1)} KB</div>
      <div>Last indexed: {status.last_indexed_at || "never"}</div>
      {status.stale_notes > 0 && (
        <div style={{ color: "#c00" }}>
          {status.stale_notes} stale note(s) — rebuild recommended.
        </div>
      )}
      <button type="button" disabled={reindex.isPending} onClick={() => reindex.mutate()}>
        {reindex.isPending ? "Rebuilding…" : "Rebuild index"}
      </button>
    </fieldset>
  );
}

export default function SettingsRoute() {
  const { data, isLoading, error } = useSettings();
  const save = useSaveSettings();
  const [privacy, setPrivacy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (data) setPrivacy(data.privacy_mode);
  }, [data]);

  if (error)
    return (
      <div role="alert" style={{ color: "#b00" }}>
        Failed to load settings: {(error as Error).message}
      </div>
    );
  if (isLoading || !data) return <div>Loading…</div>;

  async function onSave() {
    await save.mutateAsync({ privacy_mode: privacy });
    setSavedAt(new Date().toLocaleTimeString());
  }

  return (
    <div>
      <h1>Settings</h1>
      <section style={{ marginBottom: 24 }}>
        <h2>Privacy</h2>
        <label>
          <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />{" "}
          Privacy mode (master switch; no enforcement yet)
        </label>
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={onSave} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
          {savedAt && <span style={{ marginLeft: 12, color: "#080" }}>Saved at {savedAt}</span>}
        </div>
      </section>
      <section style={{ marginBottom: 24 }}>
        <h2>LLM Providers</h2>
        <LLMProvidersSection />
      </section>
      <section style={{ marginBottom: 24 }}>
        <h2>Chat</h2>
        <DefaultChatModel />
      </section>
      <section style={{ marginBottom: 24 }}>
        <h2>Index</h2>
        <ChatIndex />
      </section>
      <section style={{ marginBottom: 24 }}>
        <h2>Connectors</h2>
        <ConnectorsBrowser />
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run the full Settings test suite**

```
cd apps/desktop
npx vitest run --reporter=verbose src/routes/__tests__/SettingsRoute.test.tsx
```

Expected: all 5 tests pass.

- [ ] **Step 5: Run the full frontend test suite to check for regressions**

```
cd apps/desktop
npx vitest run --reporter=verbose
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```
git add apps/desktop/src/routes/SettingsRoute.tsx apps/desktop/src/routes/__tests__/SettingsRoute.test.tsx
git commit -m "feat: add Ollama provider type selector and status badges to Settings UI"
```
