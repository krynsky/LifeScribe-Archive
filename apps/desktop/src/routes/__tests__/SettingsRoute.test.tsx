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

    expect(screen.getByPlaceholderText(/display name/i)).toHaveValue("Ollama");
    expect(screen.getByPlaceholderText(/base url/i)).toHaveValue("http://localhost:11434/v1");
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

    expect(screen.getByPlaceholderText(/display name/i)).toHaveValue("LM Studio");
    expect(screen.getByPlaceholderText(/base url/i)).toHaveValue("http://127.0.0.1:1234/v1");
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
