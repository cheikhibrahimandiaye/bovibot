"""
Gestion de la connexion MySQL avec pool de connexions.
Skill : fastapi-architect (sessions MySQL propres), mysql-plsql-expert
"""
from typing import Any
import mysql.connector
from mysql.connector import pooling, Error as MySQLError

from backend.config import settings

# ---------------------------------------------------------------------------
# Pool de connexions (initialisé au démarrage de l'application)
# ---------------------------------------------------------------------------
_pool: pooling.MySQLConnectionPool | None = None


def init_pool() -> None:
    """Initialise le pool de connexions MySQL. Appelé au démarrage de l'app."""
    global _pool
    _pool = pooling.MySQLConnectionPool(
        pool_name="bovibot_pool",
        pool_size=5,
        host=settings.db_host,
        port=settings.db_port,
        user=settings.db_user,
        password=settings.db_password,
        database=settings.db_name,
        autocommit=False,
    )


def _get_connection() -> pooling.PooledMySQLConnection:
    if _pool is None:
        raise RuntimeError("Le pool MySQL n'est pas initialisé. Appelez init_pool() au démarrage.")
    return _pool.get_connection()


def _fix_str(value: Any) -> Any:
    """Corrige le mojibake latin1→UTF-8 causé par le C-extension de mysql-connector.

    Le C-extension décode les bytes UTF-8 stockés en base comme s'ils étaient
    latin1, produisant 'Ã©' (U+00C3 + U+00A9) au lieu de 'é' (U+00E9).
    Fix : ré-encoder en latin1 pour retrouver les bytes bruts, puis décoder en UTF-8.
    Les strings purement ASCII (Ndama, TAG-001…) traversent sans changement.
    """
    if not isinstance(value, str):
        return value
    try:
        return value.encode("latin1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value


def _fix_row(row: dict[str, Any]) -> dict[str, Any]:
    return {k: _fix_str(v) for k, v in row.items()}


# ---------------------------------------------------------------------------
# Helpers SQL
# ---------------------------------------------------------------------------

def execute_query(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    """Exécute une requête SELECT et retourne une liste de dictionnaires."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(dictionary=True)
        cursor.execute(sql, params)
        rows = cursor.fetchall()
        return [_fix_row(r) for r in rows]
    finally:
        cursor.close()
        conn.close()


def execute_procedure(proc_name: str, args: tuple) -> list[dict[str, Any]]:
    """
    Appelle une procédure stockée et retourne les lignes du premier result set.
    Skill llm-agent-flow : Mode ACTION — cette fonction ne doit être appelée
    qu'après confirmation explicite de l'utilisateur (réponse 'Oui').
    """
    import logging
    _log = logging.getLogger(__name__)
    conn = _get_connection()
    cursor = None
    try:
        cursor = conn.cursor(dictionary=True)
        cursor.callproc(proc_name, args)
        # Lire les result sets AVANT le commit (certaines versions du C-extension
        # invalident les stored_results après conn.commit())
        result_rows: list[dict[str, Any]] = []
        for result_set in cursor.stored_results():
            result_rows.extend(result_set.fetchall())
        conn.commit()
        return [_fix_row(r) for r in result_rows]
    except MySQLError as exc:
        _log.error("execute_procedure(%s) — MySQLError: %s", proc_name, exc)
        conn.rollback()
        raise exc
    except Exception as exc:
        _log.exception("execute_procedure(%s) — exception inattendue: %s", proc_name, exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        if cursor is not None:
            cursor.close()
        conn.close()


def execute_write(sql: str, params: tuple = ()) -> int:
    """Exécute une requête INSERT/UPDATE/DELETE et retourne le lastrowid."""
    import logging
    _log = logging.getLogger(__name__)
    conn = _get_connection()
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(sql, params)
        conn.commit()
        return cursor.lastrowid or 0
    except MySQLError as exc:
        _log.error("execute_write — MySQLError: %s", exc)
        conn.rollback()
        raise exc
    finally:
        if cursor is not None:
            cursor.close()
        conn.close()


def resolve_animal_by_tag(numero_tag: str) -> dict[str, Any] | None:
    """Retourne l'animal correspondant au numero_tag, ou None si introuvable."""
    rows = execute_query(
        "SELECT id, numero_tag, nom, statut FROM animaux WHERE numero_tag = %s LIMIT 1",
        (numero_tag.upper(),),
    )
    return rows[0] if rows else None
