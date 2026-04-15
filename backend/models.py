"""
Modèles Pydantic pour la validation des requêtes et réponses API.
Skill : fastapi-architect (Pydantic strict), clean-arch (nommage explicite)
"""
from typing import Any, Literal
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Requêtes entrantes
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    """Corps de la requête POST /chat"""
    message: str = Field(..., min_length=1, max_length=2000, description="Message de l'utilisateur")
    session_id: str = Field(..., min_length=1, max_length=100, description="Identifiant de session unique")


# ---------------------------------------------------------------------------
# Réponses sortantes
# ---------------------------------------------------------------------------

class ChatResponse(BaseModel):
    """Corps de la réponse du endpoint /chat"""
    session_id: str
    mode: Literal["CONSULTATION", "ACTION_PENDING", "ACTION_EXECUTED", "CONVERSATION"]
    response: str = Field(..., description="Réponse en langage naturel à afficher à l'utilisateur")
    sql_executed: str | None = Field(None, description="Requête SQL exécutée (mode CONSULTATION)")
    data: list[dict[str, Any]] | None = Field(None, description="Données brutes retournées par MySQL")


class AlerteResponse(BaseModel):
    """Représentation d'une alerte système"""
    id: int
    type: str
    message: str
    niveau: Literal["info", "avertissement", "critique"]
    traitee: bool
    animal_id: int | None
    created_at: str


class AlertesListResponse(BaseModel):
    """Liste paginée d'alertes"""
    total: int
    alertes: list[AlerteResponse]


# ---------------------------------------------------------------------------
# Structure interne : action en attente de confirmation
# ---------------------------------------------------------------------------

class PendingAction(BaseModel):
    """
    Action stockée en mémoire en attente du 'Oui' de l'utilisateur.
    Skill llm-agent-flow : Mode ACTION — confirmation obligatoire.
    """
    procedure: Literal["sp_enregistrer_pesee", "sp_declarer_vente"]
    args: tuple
    confirmation_message: str
    human_summary: str

    model_config = {"arbitrary_types_allowed": True}
