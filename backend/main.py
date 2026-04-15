"""
Point d'entrée principal de l'application BoviBot.
Skill : fastapi-architect (port 8002, structure modulaire)
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import settings
from backend.database import init_pool
from backend.routers import chat, alertes, stats, sante, ventes, pesees

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(name)s | %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialise le pool MySQL au démarrage, ferme les ressources à l'arrêt."""
    logger.info("Démarrage BoviBot — initialisation du pool MySQL...")
    init_pool()
    logger.info("Pool MySQL initialisé. BoviBot prêt sur le port %d.", settings.api_port)
    yield
    logger.info("Arrêt de BoviBot.")


app = FastAPI(
    title="BoviBot API",
    description="Assistant IA de gestion d'élevage bovin — ESP/UCAD Licence 3",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — à restreindre aux domaines connus en production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)

# Enregistrement des routers
app.include_router(chat.router)
app.include_router(alertes.router)
app.include_router(stats.router)
app.include_router(sante.router)
app.include_router(ventes.router)
app.include_router(pesees.router)


@app.get("/", tags=["Santé"])
def health_check() -> dict:
    return {"status": "ok", "app": "BoviBot", "version": "1.0.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=settings.api_port, reload=True)
