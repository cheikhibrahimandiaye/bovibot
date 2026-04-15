"""
Router /pesees : enregistrement d'une pesée via sp_enregistrer_pesee.
Skill : fastapi-architect (modulaire, Pydantic)
"""
from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.database import execute_procedure, resolve_animal_by_tag

router = APIRouter(prefix="/pesees", tags=["Pesées"])


class PeseeCreate(BaseModel):
    numero_tag: str
    poids_kg: float
    date_pesee: str | None = None
    agent: str = "BoviBot"


@router.post("")
def create_pesee(body: PeseeCreate) -> dict:
    """Enregistre une pesée via sp_enregistrer_pesee sans passer par le LLM."""
    animal = resolve_animal_by_tag(body.numero_tag)
    if not animal:
        raise HTTPException(status_code=404, detail=f"Animal introuvable : {body.numero_tag}")
    if animal["statut"] != "actif":
        raise HTTPException(status_code=400, detail=f"Animal {body.numero_tag} non actif (statut : {animal['statut']})")

    date_pesee = body.date_pesee or str(date.today())
    args = (animal["id"], body.poids_kg, date_pesee, body.agent)
    try:
        rows = execute_procedure("sp_enregistrer_pesee", args)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    result = rows[0] if rows else {}
    gmq = result.get("gmq_kg_par_jour")
    msg = f"Pesée enregistrée : {body.poids_kg} kg pour {body.numero_tag.upper()}"
    if gmq is not None:
        msg += f" · GMQ : {gmq} kg/j"
    return {"ok": True, "message": msg, "gmq": gmq}
