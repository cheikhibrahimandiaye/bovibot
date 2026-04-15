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

    # Ollama (LLM local)
    ollama_host: str = "http://localhost:11434"
    ollama_model: str = "mistral"

    # Application FastAPI
    api_port: int = 8002

    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), env_file_encoding="utf-8")


settings = Settings()
