"""
Router /ventes : consultation et enregistrement des ventes.
Skill : fastapi-architect (modulaire, Pydantic)
"""
from decimal import Decimal
from datetime import date
from typing import Any

import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.database import execute_query, execute_procedure, resolve_animal_by_tag

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ventes", tags=["Ventes"])


class VenteCreate(BaseModel):
    numero_tag: str
    acheteur: str
    telephone: str | None = None
    prix_fcfa: float
    poids_vente_kg: float | None = None
    date_vente: str | None = None


def _clean(v: Any) -> Any:
    if isinstance(v, Decimal): return float(v)
    if isinstance(v, date):    return str(v)
    return v


@router.post("")
def create_vente(body: VenteCreate) -> dict:
    """Enregistre une vente via sp_declarer_vente sans passer par le LLM."""
    animal = resolve_animal_by_tag(body.numero_tag)
    if not animal:
        raise HTTPException(status_code=404, detail=f"Animal introuvable : {body.numero_tag}")
    if animal["statut"] != "actif":
        raise HTTPException(status_code=400, detail=f"Animal {body.numero_tag} non actif (statut : {animal['statut']})")

    date_vente = body.date_vente or str(date.today())
    args = (animal["id"], body.acheteur, body.telephone, body.prix_fcfa, body.poids_vente_kg, date_vente)
    try:
        rows = execute_procedure("sp_declarer_vente", args)
    except Exception as exc:
        logger.exception("Erreur POST /ventes — tag=%s args=%s", body.numero_tag, args)
        raise HTTPException(status_code=500, detail=str(exc))

    return {"ok": True, "message": f"Vente enregistrée pour {body.numero_tag.upper()}"}


@router.get("")
def get_ventes(limit: int = Query(60, ge=1, le=200)) -> list[dict]:
    """
    Retourne l'historique complet des ventes, triées par date décroissante.
    Inclut les informations de l'animal vendu.
    """
    sql = """
        SELECT
            v.id,
            a.numero_tag,
            COALESCE(a.nom, '—')            AS nom_animal,
            r.nom                            AS race,
            v.acheteur,
            COALESCE(v.telephone, '—')       AS telephone,
            v.prix_fcfa,
            COALESCE(v.poids_vente_kg, 0)    AS poids_vente_kg,
            DATE_FORMAT(v.date_vente, '%Y-%m-%d') AS date_vente
        FROM   ventes v
        JOIN   animaux a ON a.id = v.animal_id
        LEFT JOIN races r ON r.id = a.race_id
        ORDER  BY v.date_vente DESC
        LIMIT  %s
    """
    rows = execute_query(sql, (limit,))
    return [{k: _clean(v) for k, v in row.items()} for row in rows]


@router.get("/stats")
def get_ventes_stats() -> dict:
    """KPIs des ventes : total transactions, revenu total, prix moyen."""
    row = execute_query("""
        SELECT
            COUNT(*)                        AS total_ventes,
            COALESCE(SUM(prix_fcfa), 0)     AS revenu_total,
            COALESCE(AVG(prix_fcfa), 0)     AS prix_moyen,
            COALESCE(AVG(poids_vente_kg), 0) AS poids_moyen
        FROM ventes
    """)
    r = row[0] if row else {}
    return {k: float(v) if isinstance(v, Decimal) else (v or 0) for k, v in r.items()}
