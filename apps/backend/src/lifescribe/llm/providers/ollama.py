from __future__ import annotations

from dataclasses import dataclass

from lifescribe.llm.openai_compatible import OpenAICompatibleClient
from lifescribe.vault.schemas import LLMProvider

# Preset dataclass for Ollama. Not wired into ProviderRegistry — all provider
# types use OpenAICompatibleClient directly via the registry. This class
# documents the Ollama configuration and is available for future adapter routing.


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
