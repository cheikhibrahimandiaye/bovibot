"""
Router /sante : consultation des actes vétérinaires (table sante).
Skill : fastapi-architect (modulaire, Pydantic)
"""
from decimal import Decimal
from datetime import date
from typing import Any

import logging
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from backend.database import execute_query, execute_write, resolve_animal_by_tag

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sante", tags=["Santé"])


class SanteCreate(BaseModel):
    numero_tag: str
    type: str
    date_acte: str | None = None
    veterinaire: str | None = None
    prochain_rdv: str | None = None


@router.post("")
def create_sante(body: SanteCreate) -> dict:
    """Enregistre un acte vétérinaire. Déclenche trg_alerte_vaccination si prochain_rdv dépassé."""
    animal = resolve_animal_by_tag(body.numero_tag)
    if not animal:
        raise HTTPException(status_code=404, detail=f"Animal introuvable : {body.numero_tag}")

    date_acte = body.date_acte or str(date.today())
    try:
        new_id = execute_write(
            "INSERT INTO sante (animal_id, type, date_acte, veterinaire, prochain_rdv) VALUES (%s,%s,%s,%s,%s)",
            (animal["id"], body.type, date_acte, body.veterinaire, body.prochain_rdv),
        )
    except Exception as exc:
        logger.exception("Erreur POST /sante : %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))

    return {"ok": True, "id": new_id, "message": f"Acte '{body.type}' enregistré pour {body.numero_tag.upper()}"}


def _clean(v: Any) -> Any:
    if isinstance(v, Decimal): return float(v)
    if isinstance(v, date):    return str(v)
    return v


@router.get("")
def get_sante(
    animal_tag: str | None = Query(None, description="Filtrer par numéro TAG (ex: TAG-001)"),
    type_acte:  str | None = Query(None, description="Filtrer par type d'acte"),
    limit: int = Query(60, ge=1, le=200),
) -> list[dict]:
    """
    Retourne les actes vétérinaires (vaccination, soin, contrôle…)
    triés par date décroissante, enrichis des infos de l'animal.
    """
    conditions: list[str] = []
    params: list = []

    if animal_tag:
        conditions.append("UPPER(a.numero_tag) = %s")
        params.append(animal_tag.upper())

    if type_acte:
        conditions.append("s.type = %s")
        params.append(type_acte)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    params.append(limit)

    sql = f"""
        SELECT
            s.id,
            a.numero_tag,
            COALESCE(a.nom, '—')                                AS nom_animal,
            a.statut                                            AS statut_animal,
            s.type                                              AS type_acte,
            DATE_FORMAT(s.date_acte, '%Y-%m-%d')                AS date_acte,
            COALESCE(s.veterinaire, '—')                        AS veterinaire,
            CASE WHEN s.prochain_rdv IS NOT NULL
                 THEN DATE_FORMAT(s.prochain_rdv, '%Y-%m-%d')
                 ELSE NULL END                                  AS prochain_rdv,
            CASE WHEN s.prochain_rdv IS NOT NULL
                      AND s.prochain_rdv < CURDATE()
                 THEN 1 ELSE 0 END                              AS rdv_depasse
        FROM   sante s
        JOIN   animaux a ON a.id = s.animal_id
        {where}
        ORDER  BY s.date_acte DESC
        LIMIT  %s
    """
    rows = execute_query(sql, tuple(params))
    return [{k: _clean(v) for k, v in row.items()} for row in rows]


@router.get("/stats")
def get_sante_stats() -> dict:
    """Statistiques sanitaires globales pour les KPIs."""
    row = execute_query("""
        SELECT
            COUNT(*)                                                              AS total_actes,
            SUM(CASE WHEN prochain_rdv IS NOT NULL
                          AND prochain_rdv < CURDATE() THEN 1 ELSE 0 END)        AS rdv_depasses,
            SUM(CASE WHEN prochain_rdv IS NOT NULL
                          AND prochain_rdv BETWEEN CURDATE()
                          AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 1 ELSE 0 END)
                                                                                  AS rdv_prochains_30j,
            COUNT(DISTINCT animal_id)                                             AS animaux_suivis
        FROM sante
    """)
    return {k: (v or 0) for k, v in (row[0] if row else {}).items()}
