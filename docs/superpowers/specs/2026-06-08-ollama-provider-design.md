# Ollama Provider Support

**Date:** 2026-06-08
**Status:** Approved

## Goal

Add Ollama as a first-class LLM provider with a clear UI for selecting it, viewing connection status, and choosing models.

## Background

The existing LLM provider system uses a generic `OpenAICompatibleClient` for all providers. Ollama exposes an OpenAI-compatible API at `http://localhost:11434/v1`, so no new backend routing is needed. What's missing is:

- A typed `provider_type` field to distinguish Ollama from LM Studio, GitHub Models, and custom providers
- A UI preset that pre-fills the Ollama defaults when adding a provider
- Per-provider connection status in the Settings UI (online/offline + model count)

## Approach

Typed provider presets (Approach A). A `provider_type` field is added to the schema and stored in the vault note. The backend continues to route all provider types through `OpenAICompatibleClient` — no adapter routing changes. The type is used purely for UI labeling, preset auto-fill, and future extensibility.

## Backend Changes

### `vault/schemas.py`

Add `provider_type` field to `LLMProvider`:

```python
provider_type: Literal["ollama", "lmstudio", "github_models", "custom"] = "custom"
```

Existing notes without the field default to `"custom"` via the default value.

### `api/routers/llm.py`

Add `provider_type` to `_ProviderBody` and pass it through in `create_provider` and `update_provider`.

### `llm/providers/ollama.py`

New module matching the existing `lmstudio.py` pattern. Documents the Ollama preset config:
- `base_url`: `http://localhost:11434/v1`
- `local`: `True`
- `requires_token`: `False`

Not wired into the registry (same as `lmstudio.py` and `github_models.py`).

## Frontend Changes

### `api/client.ts`

Add `provider_type` to `LLMProviderDTO`:

```typescript
provider_type: "ollama" | "lmstudio" | "github_models" | "custom";
```

### `routes/SettingsRoute.tsx` — `LLMProvidersSection`

Replace the bare add-provider form with a type-selector workflow:

1. **Provider type dropdown** with four options: Ollama, LM Studio, GitHub Models, Custom
2. **Auto-fill on type selection:**

   | Type | Display name | Base URL | Local |
   |---|---|---|---|
   | `ollama` | Ollama | `http://localhost:11434/v1` | true |
   | `lmstudio` | LM Studio | `http://127.0.0.1:1234/v1` | true |
   | `github_models` | GitHub Models | `https://models.inference.ai.azure.com` | false |
   | `custom` | (blank) | (blank) | true |

3. All pre-filled fields remain editable (user may run Ollama on a non-default port).

4. **Status badge per provider row** using `useLLMModels`:
   - Loading: "Checking…"
   - Success: green "Online · N models"
   - Error: red "Offline"

### `routes/SettingsRoute.tsx` — `DefaultChatModel`

Show `provider_type` label alongside `display_name` in the provider selector so the user can distinguish multiple providers of the same type (e.g. two Ollama instances on different ports).

## Data Flow

```
User selects "Ollama" in type dropdown
  → form pre-fills with Ollama defaults
  → user clicks "Add provider"
  → POST /llm/providers { provider_type: "ollama", base_url: "...", local: true, ... }
  → backend stores LLMProvider note with provider_type field
  → provider list reloads
  → each row fires useLLMModels(provider.id)
  → status badge shows "Online · N models" or "Offline"
```

## What Does Not Change

- `OpenAICompatibleClient` — unchanged, handles Ollama already
- `ProviderRegistry` — unchanged, no adapter routing
- Chat model selection — `useLLMModels` + `ModelPill` already work for any OpenAI-compatible provider
- Privacy mode enforcement — unchanged, `local: true` already exempts Ollama from remote-provider blocks

## Out of Scope

- Auto-discovery of a running Ollama instance
- Ollama-specific model management (pull/delete models)
- Adapter routing in the registry (deferred until a provider needs non-OpenAI-compatible behavior)
