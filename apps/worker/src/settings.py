"""Worker configuration via pydantic-settings."""

import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mysql_url: str = ""
    livekit_url: str = ""
    livekit_api_key: str = ""
    livekit_api_secret: str = ""
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    default_llm_provider: str = "openai"
    default_llm_model: str = "gpt-4o-mini"
    api_url: str = "http://localhost:3001"
    internal_api_key: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()

# LangChain's init_chat_model reads API keys from os.environ, not from our
# pydantic settings. Export them so the SDKs (openai, anthropic) can find them.
if settings.openai_api_key:
    os.environ.setdefault("OPENAI_API_KEY", settings.openai_api_key)
if settings.anthropic_api_key:
    os.environ.setdefault("ANTHROPIC_API_KEY", settings.anthropic_api_key)
