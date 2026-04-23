"""
Configuration centralisée de l'application BoviBot.
Skill : fastapi-architect + clean-arch (pydantic-settings, nommage explicite)
"""
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Chemin absolu vers backend/.env, quel que soit le répertoire de lancement
_ENV_FILE = Path(__file__).parent / ".env"


class Settings(BaseSettings):
    # Base de données MySQL
    db_host: str = "localhost"
    db_port: int = 3306
    db_user: str = "root"
    db_password: str = ""
    db_name: str = "bovibot"

    # LLM — mode "ollama" (local) ou "openai" (déploiement cloud)
    llm_provider: str = "ollama"   # "ollama" | "openai"
    ollama_host: str = "http://localhost:11434"
    ollama_model: str = "mistral"
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"

    # Application FastAPI
    api_port: int = 8002

    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), env_file_encoding="utf-8")


settings = Settings()
