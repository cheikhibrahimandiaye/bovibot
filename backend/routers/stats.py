"""
Router /stats : statistiques du tableau de bord — données pour les tuiles dynamiques.
Utilise fn_gmq() et fn_age_en_mois() via MySQL pour les métriques PL/SQL.
"""
from typing import Any
from decimal import Decimal
from datetime import date
from fastapi import APIRouter
from backend.database import execute_query

router = APIRouter(prefix="/stats", tags=["Statistiques"])


def _clean(val: Any) -> Any:
    if isinstance(val, Decimal): return float(val)
    if isinstance(val, date):    return str(val)
    return val


@router.get("")
def get_stats() -> dict[str, Any]:
    """Métriques globales du troupeau pour les 4 tuiles du dashboard."""
    counts = execute_query("""
        SELECT
            (SELECT COUNT(*) FROM animaux WHERE statut = 'actif')                   AS total_actifs,
            (SELECT COUNT(*) FROM animaux)                                          AS total_animaux,
            (SELECT COUNT(*) FROM alertes WHERE traitee = 0 AND niveau = 'critique') AS alertes_critiques,
            (SELECT COUNT(*) FROM alertes WHERE traitee = 0)                        AS alertes_total,
            (SELECT COUNT(*) FROM reproduction
             WHERE  statut = 'en_cours'
             AND    date_velage_prevue BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY))
                                                                                    AS velages_7jours
    """)
    gmq_row = execute_query("""
        SELECT ROUND(AVG(fn_gmq(id)), 3) AS gmq_moyen
        FROM   animaux
        WHERE  statut = 'actif'
        HAVING gmq_moyen > 0
    """)
    age_row = execute_query("""
        SELECT ROUND(AVG(fn_age_en_mois(id)), 1) AS age_moyen
        FROM   animaux
        WHERE  statut = 'actif'
    """)
    result = {k: _clean(v) for k, v in (counts[0] if counts else {}).items()}
    result["gmq_moyen"]  = _clean(gmq_row[0]["gmq_moyen"])  if gmq_row and gmq_row[0]["gmq_moyen"]  else 0.0
    result["age_moyen"]  = _clean(age_row[0]["age_moyen"])  if age_row and age_row[0]["age_moyen"]  else 0.0
    return result


@router.get("/animaux")
def get_animaux_stats(statut: str | None = None) -> list[dict[str, Any]]:
    """Animaux avec GMQ et âge calculés. Filtre par statut si fourni (actif|vendu|mort)."""
    from fastapi import HTTPException as _HTTPException
    _STATUTS = {"actif", "vendu", "mort"}
    params: tuple = ()
    where = ""
    if statut:
        if statut not in _STATUTS:
            raise _HTTPException(status_code=400, detail=f"Statut invalide. Valeurs : {', '.join(_STATUTS)}")
        where = "WHERE a.statut = %s"
        params = (statut,)
    rows = execute_query(f"""
        SELECT
            a.id, a.numero_tag, a.nom, a.sexe, a.statut,
            a.poids_actuel_kg,
            fn_age_en_mois(a.id)          AS age_mois,
            GREATEST(fn_gmq(a.id), 0)     AS gmq,
            r.nom                          AS race
        FROM   animaux a
        LEFT JOIN races r ON r.id = a.race_id
        {where}
        ORDER BY a.numero_tag
    """, params)
    return [{k: _clean(v) for k, v in row.items()} for row in rows]
