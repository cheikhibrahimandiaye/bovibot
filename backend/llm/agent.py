"""
Agent LLM BoviBot : orchestration des modes CONSULTATION et ACTION.
Skill : llm-agent-flow (confirmation avant tout CALL sp_...)
Supporte Ollama (local) et OpenAI API (déploiement cloud) via LLM_PROVIDER.
"""
import json
import logging
from datetime import date
from typing import Any

from backend.config import settings
from backend.database import execute_query, execute_procedure, resolve_animal_by_tag
from backend.llm.prompts import SYSTEM_PROMPT
from backend.models import PendingAction

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Appel LLM — Ollama ou OpenAI selon LLM_PROVIDER
# ---------------------------------------------------------------------------

def call_llm(user_message: str, conversation_history: list[dict]) -> dict[str, Any]:
    """Envoie le message au LLM configuré et retourne le JSON parsé."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(conversation_history)
    messages.append({"role": "user", "content": user_message})

    if settings.llm_provider == "openai":
        raw_json = _call_openai(messages)
    else:
        raw_json = _call_ollama(messages)

    logger.info("Réponse LLM brute : %.200s", raw_json)

    return _parse_llm_json(raw_json)


def _call_ollama(messages: list[dict]) -> str:
    import ollama
    client = ollama.Client(host=settings.ollama_host)
    logger.info("Appel Ollama — modèle : %s", settings.ollama_model)
    response = client.chat(
        model=settings.ollama_model,
        messages=messages,
        format="json",
        options={"temperature": 0.1},
    )
    if isinstance(response, dict):
        return response["message"]["content"]
    return response.message.content


_FALLBACK_MODELS = [
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemma-3-27b-it:free",
    "google/gemma-3-12b-it:free",
    "nousresearch/hermes-3-llama-3.1-405b:free",
    "qwen/qwen3-coder:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
]

def _call_openai(messages: list[dict]) -> str:
    from openai import OpenAI, RateLimitError
    client = OpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        max_retries=0,
    )
    models = [settings.openai_model] + [m for m in _FALLBACK_MODELS if m != settings.openai_model]
    last_exc = None
    for model in models:
        try:
            logger.info("Appel LLM cloud — modèle : %s | base_url : %s", model, settings.openai_base_url)
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.1,
                response_format={"type": "json_object"},
            )
            return response.choices[0].message.content
        except RateLimitError as e:
            logger.warning("Rate limit sur %s, essai modèle suivant...", model)
            last_exc = e
        except Exception as e:
            logger.warning("Erreur sur %s : %s, essai modèle suivant...", model, e)
            last_exc = e
    raise last_exc


def _parse_llm_json(raw_json: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw_json)
    except json.JSONDecodeError:
        # Mistral renvoie parfois du texte avant/après le JSON — on extrait le 1er bloc JSON
        import re
        match = re.search(r'\{.*\}', raw_json, re.DOTALL)
        if match:
            parsed = json.loads(match.group())
        else:
            logger.error("Impossible de parser la réponse LLM : %s", raw_json)
            parsed = {}

    if "mode" not in parsed:
        parsed["mode"] = "CONVERSATION"
    if "natural_response" not in parsed:
        parsed["natural_response"] = raw_json.strip() or "Je n'ai pas pu générer une réponse structurée."

    return parsed


# ---------------------------------------------------------------------------
# Mode CONSULTATION : exécution SQL + formatage réponse
# ---------------------------------------------------------------------------

def handle_consultation(llm_output: dict[str, Any]) -> dict[str, Any]:
    """Exécute la requête SQL générée par le LLM et enrichit la réponse."""
    sql: str = llm_output.get("sql", "")

    # Sécurité : refus des commandes d'écriture même si le LLM hallucine
    forbidden_keywords = ("INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE", "CALL")
    sql_upper = sql.upper()
    for keyword in forbidden_keywords:
        if keyword in sql_upper:
            return {
                "mode": "CONSULTATION",
                "response": "Erreur de sécurité : requête non autorisée détectée.",
                "sql_executed": None,
                "data": None,
            }

    data = execute_query(sql)
    return {
        "mode": "CONSULTATION",
        "response": llm_output.get("natural_response", "Voici les résultats."),
        "sql_executed": sql,
        "data": _serialize_rows(data),
    }


# ---------------------------------------------------------------------------
# Mode ACTION : résolution du tag + construction PendingAction
# ---------------------------------------------------------------------------

def build_pending_action(llm_output: dict[str, Any]) -> tuple[PendingAction | None, str]:
    """
    Résout le numero_tag en animal_id et construit un PendingAction.
    Retourne (PendingAction, "") en succès ou (None, message_erreur) en échec.
    Skill llm-agent-flow : PAS d'exécution ici — uniquement préparation.
    """
    procedure: str = llm_output.get("procedure", "")
    params: dict = llm_output.get("extracted_params", {})
    numero_tag: str = params.get("numero_tag", "").upper()

    # Résolution du tag en ID via la base
    animal = resolve_animal_by_tag(numero_tag)
    if animal is None:
        return None, f"Animal introuvable avec le tag '{numero_tag}'. Vérifiez le numéro."
    if animal["statut"] != "actif":
        return None, (
            f"L'animal {numero_tag} n'est pas actif (statut : {animal['statut']}). "
            "Opération impossible."
        )

    animal_id: int = animal["id"]
    today: str = str(date.today())

    if procedure == "sp_enregistrer_pesee":
        poids_kg = float(params.get("poids_kg", 0))
        date_pesee = params.get("date_pesee", today)
        agent = params.get("agent", "BoviBot")
        args = (animal_id, poids_kg, date_pesee, agent)
        confirmation = (
            f"Confirmer la pesée ?\n"
            f"  Animal   : {numero_tag} / {animal.get('nom', 'Sans nom')}\n"
            f"  Poids    : {poids_kg} kg\n"
            f"  Date     : {date_pesee}\n"
            f"  Agent    : {agent}\n"
            f"Répondez Oui pour valider."
        )

    elif procedure == "sp_declarer_vente":
        acheteur = params.get("acheteur", "")
        telephone = params.get("telephone", None)
        prix_fcfa = float(params.get("prix_fcfa", 0))
        poids_vente = params.get("poids_vente_kg", None)
        args = (animal_id, acheteur, telephone, prix_fcfa, poids_vente, today)
        confirmation = (
            f"Confirmer la vente ?\n"
            f"  Animal   : {numero_tag} / {animal.get('nom', 'Sans nom')}\n"
            f"  Acheteur : {acheteur}\n"
            f"  Tél.     : {telephone or 'Non renseigné'}\n"
            f"  Prix     : {int(prix_fcfa):,} FCFA\n"
            f"  Poids    : {poids_vente or 'Non renseigné'} kg\n"
            f"  Date     : {today} (automatique)\n"
            f"Répondez Oui pour valider."
        )
    else:
        return None, f"Procédure inconnue : '{procedure}'."

    pending = PendingAction(
        procedure=procedure,
        args=args,
        confirmation_message=confirmation,
        human_summary=llm_output.get("natural_response", ""),
    )
    return pending, ""


# ---------------------------------------------------------------------------
# Mode ACTION CONFIRMÉ : exécution de la procédure stockée
# ---------------------------------------------------------------------------

def execute_confirmed_action(pending: PendingAction) -> dict[str, Any]:
    """
    Exécute la procédure stockée après confirmation 'Oui' de l'utilisateur.
    Skill llm-agent-flow : SEUL point d'exécution des procédures.
    """
    result_rows = execute_procedure(pending.procedure, pending.args)
    if result_rows:
        row = result_rows[0]
        message = row.get("message", "Opération effectuée avec succès.")
        # Enrichissement pour sp_enregistrer_pesee
        if "gmq_kg_par_jour" in row and row["gmq_kg_par_jour"] is not None:
            message = (
                f"Pesée enregistrée. GMQ actuel : {row['gmq_kg_par_jour']} kg/jour. "
                f"Statut : {row.get('statut_alerte', 'OK')}."
            )
        elif "prix_fcfa" in row:
            message = f"Vente enregistrée (ID #{row.get('vente_id', '?')}). Animal désormais marqué 'vendu'."
    else:
        message = "Opération effectuée avec succès."

    return {
        "mode": "ACTION_EXECUTED",
        "response": message,
        "sql_executed": None,
        "data": _serialize_rows(result_rows),
    }


# ---------------------------------------------------------------------------
# Utilitaire
# ---------------------------------------------------------------------------

def _serialize_rows(rows: list[dict]) -> list[dict]:
    """Convertit les types non-sérialisables JSON (date, Decimal) en str/float."""
    from decimal import Decimal
    serialized = []
    for row in rows:
        clean = {}
        for key, value in row.items():
            if isinstance(value, date):
                clean[key] = str(value)
            elif isinstance(value, Decimal):
                clean[key] = float(value)
            else:
                clean[key] = value
        serialized.append(clean)
    return serialized
