"""
Router /chat : point d'entrée unique pour les modes CONSULTATION et ACTION.
Skill : llm-agent-flow (confirmation obligatoire avant tout CALL sp_...)
        fastapi-architect (modulaire, Pydantic, port 8002)
"""
import logging
from fastapi import APIRouter, HTTPException

from backend.models import ChatRequest, ChatResponse, PendingAction
from backend.llm.agent import (
    call_llm,
    handle_consultation,
    build_pending_action,
    execute_confirmed_action,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["Chat IA"])

# ---------------------------------------------------------------------------
# Stockage en mémoire des actions en attente de confirmation
# Clé : session_id (str) | Valeur : PendingAction
# ---------------------------------------------------------------------------
_pending_actions: dict[str, PendingAction] = {}

# Historique de conversation par session (liste de messages OpenAI)
_conversation_history: dict[str, list[dict]] = {}

_CONFIRMATION_KEYWORDS = {"oui", "yes", "ok", "confirmer", "valider", "confirme", "validé"}
_CANCELLATION_KEYWORDS = {"non", "no", "annuler", "annule", "cancel", "stop"}


@router.post("", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    """
    Endpoint principal du chat BoviBot.

    Flux Mode CONSULTATION :
      Message → LLM génère SQL → Exécution → Réponse naturelle

    Flux Mode ACTION :
      Message → LLM extrait paramètres → Confirmation affichée
      → Utilisateur répond 'Oui' → CALL sp_... → Résultat

    Skill llm-agent-flow : aucun CALL sans 'Oui' explicite.
    """
    session_id = request.session_id
    user_message = request.message.strip()

    # --- Vérification annulation d'action en attente ---
    if session_id in _pending_actions:
        if _is_cancellation(user_message):
            _pending_actions.pop(session_id, None)
            return ChatResponse(
                session_id=session_id,
                mode="CONVERSATION",
                response="Opération annulée. Comment puis-je vous aider ?",
            )

    # --- Vérification confirmation d'action en attente ---
    if session_id in _pending_actions and _is_confirmation(user_message):
        pending = _pending_actions.pop(session_id)
        try:
            result = execute_confirmed_action(pending)
        except Exception as exc:
            logger.error("Erreur lors de l'exécution de la procédure : %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

        _append_to_history(session_id, "user", user_message)
        _append_to_history(session_id, "assistant", result["response"])
        return ChatResponse(
            session_id=session_id,
            mode="ACTION_EXECUTED",
            response=result["response"],
            data=result.get("data"),
        )

    # --- Appel LLM pour classifier et traiter le message ---
    logger.info("POST /chat | session=%s | msg=%.60s", session_id, user_message)
    history = _conversation_history.get(session_id, [])
    try:
        llm_output = call_llm(user_message, history)
        logger.info("LLM mode=%s", llm_output.get("mode"))
    except Exception as exc:
        logger.error("Erreur LLM : %s", exc)
        raise HTTPException(status_code=502, detail=f"Erreur de connexion au LLM : {exc}")

    mode = llm_output.get("mode", "CONVERSATION")

    # --- Mode CONSULTATION ---
    if mode == "CONSULTATION":
        try:
            result = handle_consultation(llm_output)
        except Exception as exc:
            logger.error("Erreur SQL : %s", exc)
            raise HTTPException(status_code=500, detail=f"Erreur d'exécution SQL : {exc}")

        _append_to_history(session_id, "user", user_message)
        _append_to_history(session_id, "assistant", result["response"])
        return ChatResponse(
            session_id=session_id,
            mode="CONSULTATION",
            response=result["response"],
            sql_executed=result.get("sql_executed"),
            data=result.get("data"),
        )

    # --- Mode ACTION : construction et mise en attente ---
    if mode == "ACTION_PENDING":
        pending, error_message = build_pending_action(llm_output)
        if pending is None:
            return ChatResponse(
                session_id=session_id,
                mode="CONVERSATION",
                response=f"Impossible de traiter cette action : {error_message}",
            )
        _pending_actions[session_id] = pending
        _append_to_history(session_id, "user", user_message)
        _append_to_history(session_id, "assistant", pending.confirmation_message)
        return ChatResponse(
            session_id=session_id,
            mode="ACTION_PENDING",
            response=pending.confirmation_message,
        )

    # --- Mode CONVERSATION (salutation, question générale) ---
    natural_response = llm_output.get("natural_response", "Je suis BoviBot, votre assistant d'élevage.")
    _append_to_history(session_id, "user", user_message)
    _append_to_history(session_id, "assistant", natural_response)
    return ChatResponse(
        session_id=session_id,
        mode="CONVERSATION",
        response=natural_response,
    )


# ---------------------------------------------------------------------------
# Helpers privés
# ---------------------------------------------------------------------------

def _is_confirmation(message: str) -> bool:
    return message.lower().strip().rstrip("!.") in _CONFIRMATION_KEYWORDS


def _is_cancellation(message: str) -> bool:
    return message.lower().strip().rstrip("!.") in _CANCELLATION_KEYWORDS


def _append_to_history(session_id: str, role: str, content: str) -> None:
    """Conserve les 10 derniers échanges par session pour garder le contexte LLM."""
    if session_id not in _conversation_history:
        _conversation_history[session_id] = []
    _conversation_history[session_id].append({"role": role, "content": content})
    # Limite à 20 messages (10 échanges) pour maîtriser les tokens
    if len(_conversation_history[session_id]) > 20:
        _conversation_history[session_id] = _conversation_history[session_id][-20:]
