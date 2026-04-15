"""
Router /alertes : consultation et gestion des alertes système.
Skill : fastapi-architect (modulaire, Pydantic)
"""
from fastapi import APIRouter, Query, HTTPException
from backend.database import execute_query
from backend.models import AlerteResponse, AlertesListResponse

router = APIRouter(prefix="/alertes", tags=["Alertes"])


@router.get("", response_model=AlertesListResponse)
def get_alertes(
    non_traitees_seulement: bool = Query(False, description="Retourner uniquement les alertes non traitées"),
    niveau: str | None = Query(None, description="Filtrer par niveau : info | avertissement | critique"),
    limit: int = Query(50, ge=1, le=200),
) -> AlertesListResponse:
    """Retourne la liste des alertes système, triées par date décroissante."""
    conditions = []
    params: list = []

    if non_traitees_seulement:
        conditions.append("a.traitee = 0")

    if niveau is not None:
        if niveau not in ("info", "avertissement", "critique"):
            raise HTTPException(status_code=400, detail="Niveau invalide. Valeurs : info | avertissement | critique")
        conditions.append("a.niveau = %s")
        params.append(niveau)

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    params.append(limit)

    sql = f"""
        SELECT a.id, a.type, a.message, a.niveau, a.traitee, a.animal_id,
               DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i:%S') AS created_at
        FROM alertes a
        {where_clause}
        ORDER BY a.created_at DESC
        LIMIT %s
    """
    rows = execute_query(sql, tuple(params))
    alertes = [
        AlerteResponse(
            id=r["id"],
            type=r["type"] or "inconnu",
            message=r["message"] or "",
            niveau=r["niveau"] if r["niveau"] in ("info", "avertissement", "critique") else "info",
            traitee=bool(r["traitee"]),
            animal_id=r["animal_id"],
            created_at=r["created_at"],
        )
        for r in rows
    ]
    return AlertesListResponse(total=len(alertes), alertes=alertes)


@router.patch("/{alerte_id}/traiter", response_model=dict)
def marquer_traitee(alerte_id: int) -> dict:
    """Marque une alerte comme traitée (traitee = 1)."""
    rows = execute_query("SELECT id FROM alertes WHERE id = %s", (alerte_id,))
    if not rows:
        raise HTTPException(status_code=404, detail=f"Alerte {alerte_id} introuvable.")

    from backend.database import _get_connection
    conn = _get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE alertes SET traitee = 1 WHERE id = %s", (alerte_id,))
        conn.commit()
    finally:
        cursor.close()
        conn.close()

    return {"message": f"Alerte {alerte_id} marquée comme traitée.", "alerte_id": alerte_id}
