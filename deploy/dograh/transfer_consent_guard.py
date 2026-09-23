"""Deterministic consent gate for Dograh's native transfer-call tool.

The LLM is still responsible for conversation, but it is not trusted to make
the irreversible transfer decision.  A transfer is allowed only when the most
recent customer utterance either directly asks for a human or explicitly
accepts the immediately preceding transfer offer.
"""

from __future__ import annotations

import re
import unicodedata
import logging
from typing import Any

logger = logging.getLogger(__name__)


_NEGATIVE_PATTERNS = (
    r"\b(?:no|nope|nah|nahi|nahin|na|mat|cancel)\b",
    r"\b(?:rehne|rehney|rahne|rene)(?:\s+(?:do|to))?\b",
    r"\b(?:chhodo|chodo)(?:\s+do)?\b",
    r"\b(?:dont|do\s+not)\b",
    r"(?:नहीं|नही|नहिं|ना|मत|(?:रहने|रेहने|रैने)(?:\s*(?:दो|तो))?|छोड़\s*दो|छोड\s*दो)",
    r"(?:ज़रूरत|जरूरत|आवश्यकता)\s*(?:नहीं|नही)",
)

_DIRECT_HUMAN_REQUEST = re.compile(
    r"(?:human|agent|representative|customer\s*care|team|"
    r"ह्यूमन|एजेंट|कस्टमर\s*केयर|इंसान|व्यक्ति|टीम)"
    r".{0,36}(?:connect|transfer|talk|speak|baat|jod|milwa|"
    r"कनेक्ट|ट्रांसफर|बात|जोड़|जोड़|मिलवा)"
    r"|(?:connect|transfer|talk|speak|baat|jod|milwa|"
    r"कनेक्ट|ट्रांसफर|बात|जोड़|जोड़|मिलवा)"
    r".{0,36}(?:human|agent|representative|customer\s*care|team|"
    r"ह्यूमन|एजेंट|कस्टमर\s*केयर|इंसान|व्यक्ति|टीम)",
    re.IGNORECASE,
)

_TRANSFER_OFFER = re.compile(
    r"(?:human|agent|representative|team|ह्यूमन|एजेंट|इंसान|टीम)"
    r".{0,50}(?:connect|transfer|कनेक्ट|ट्रांसफर|जोड़|जोड़)"
    r"|(?:connect|transfer|कनेक्ट|ट्रांसफर|जोड़|जोड़)"
    r".{0,50}(?:human|agent|representative|team|ह्यूमन|एजेंट|इंसान|टीम)",
    re.IGNORECASE,
)

# This exact phrase is used only when Anushka cannot answer from verified
# business data or cannot understand the caller after one clarification. It is
# deliberately separate from a normal transfer offer: the user asked for a
# direct human fallback instead of another loop or a silent call.
_UNANSWERED_HANDOFF = re.compile(
    r"मुझे\s+इस\s+जानकारी\s+की\s+पुष्टि\s+हमारी\s+टीम\s+से\s+करानी\s+होगी"
    r"|i\s+(?:cannot|can.t)\s+(?:verify|answer|understand).{0,80}(?:team|human)",
    re.IGNORECASE,
)

_AFFIRMATIVE = re.compile(
    r"^(?:yes|yeah|yep|yup|ok|okay|sure|haan|han|haa|ha|"
    r"bilkul|zaroor|जरूर|ज़रूर|हाँ|हां|हा|जी|ठीक\s*है|बिल्कुल)"
    r"(?:\s+(?:please|जी|कर\s*दो|करा\s*दो|connect\s*कर\s*दो|"
    r"कनेक्ट\s*कर\s*दो|जोड़\s*दो|जोड़\s*दो))*$",
    re.IGNORECASE,
)


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "").casefold()
    text = re.sub(r"[^\w\u0900-\u097f]+", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def _message_text(message: Any) -> str:
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            item.get("text", "")
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        )
    return ""


def _latest_text(messages: list[Any], role: str) -> str:
    for message in reversed(messages):
        if isinstance(message, dict) and message.get("role") == role:
            text = _message_text(message).strip()
            if text:
                return text
    return ""


def transfer_consent_decision(messages: list[Any]) -> tuple[str, str]:
    """Return (allow|deny|clarify, latest_user_text)."""

    latest_user = _latest_text(messages, "user")
    normalized_user = _normalize(latest_user)
    latest_assistant = _latest_text(messages, "assistant")

    if not normalized_user:
        return "clarify", latest_user
    if any(re.search(pattern, normalized_user, re.IGNORECASE) for pattern in _NEGATIVE_PATTERNS):
        return "deny", latest_user
    if _DIRECT_HUMAN_REQUEST.search(normalized_user):
        return "allow", latest_user
    if _UNANSWERED_HANDOFF.search(latest_assistant):
        return "allow", latest_user
    if _TRANSFER_OFFER.search(latest_assistant) and _AFFIRMATIVE.fullmatch(normalized_user):
        return "allow", latest_user
    return "clarify", latest_user


def reinforce_transfer_decline_context(context: Any) -> bool:
    """Rewrite a fuzzy refusal into an unambiguous refusal for the LLM.

    Deepgram can render ``रहने दो`` as ``रहने तो``.  When that happens directly
    after a transfer offer, preserving the raw transcript is useful, but passing
    the fuzzy wording to the LLM makes it ask the same question again.  The
    realtime transcript is stored separately, so only the conversational LLM
    context is clarified here.
    """

    messages = getattr(context, "messages", None)
    if not isinstance(messages, list):
        return False
    latest_assistant = _latest_text(messages, "assistant")
    latest_user = _latest_text(messages, "user")
    normalized_user = _normalize(latest_user)
    if not _TRANSFER_OFFER.search(latest_assistant):
        return False
    if not any(
        re.search(pattern, normalized_user, re.IGNORECASE)
        for pattern in _NEGATIVE_PATTERNS
    ):
        return False

    for message in reversed(messages):
        if isinstance(message, dict) and message.get("role") == "user":
            message["content"] = (
                "नहीं, रहने दीजिए। ह्यूमन एजेंट से कनेक्ट नहीं करना है।"
            )
            logger.info(
                "Normalized fuzzy transfer refusal for LLM; original=%r",
                latest_user,
            )
            return True
    return False


def install_transfer_consent_guard(custom_tool_manager_class: type) -> None:
    """Wrap Dograh's transfer handler exactly once."""

    if getattr(custom_tool_manager_class, "_sekol_transfer_consent_guard", False):
        return

    original_factory = custom_tool_manager_class._create_transfer_call_handler

    def guarded_factory(self: Any, tool: Any, function_name: str):
        original_handler = original_factory(self, tool, function_name)

        async def guarded_handler(function_call_params: Any) -> None:
            from pipecat.frames.frames import (
                FunctionCallResultProperties,
                TTSSpeakFrame,
            )
            from pipecat.utils.enums import EndTaskReason

            messages = list(getattr(self._engine.context, "messages", []) or [])
            decision, latest_user = transfer_consent_decision(messages)
            if decision == "allow":
                logger.info(
                    "Sekol transfer consent guard ALLOWED transfer; latest_user=%r",
                    latest_user,
                )
                await original_handler(function_call_params)
                return

            logger.warning(
                "Sekol transfer consent guard BLOCKED transfer; decision=%s latest_user=%r",
                decision,
                latest_user,
            )
            await function_call_params.result_callback(
                {
                    "status": "blocked",
                    "action": "transfer_not_started",
                    "reason": "customer_declined"
                    if decision == "deny"
                    else "explicit_consent_required",
                },
                properties=FunctionCallResultProperties(run_llm=False),
            )

            if decision == "deny":
                message = "आपके समय के लिए धन्यवाद। नमस्ते!"
                self._engine.set_call_disposition("customer_declined")
            else:
                message = (
                    "माफ़ कीजिए, पुष्टि के लिए बताइए—क्या आप ह्यूमन एजेंट से "
                    "कनेक्ट होना चाहते हैं? कृपया हाँ या नहीं कहें।"
                )

            self._engine.arm_speech_playback()
            await self._engine.task.queue_frame(
                TTSSpeakFrame(
                    message,
                    append_to_context=True,
                    persist_to_logs=True,
                )
            )
            if decision == "deny":
                await self._engine.end_call_with_reason(
                    EndTaskReason.END_CALL.value,
                    abort_immediately=False,
                )

        return guarded_handler

    custom_tool_manager_class._create_transfer_call_handler = guarded_factory
    custom_tool_manager_class._sekol_transfer_consent_guard = True
    logger.info("Installed Sekol deterministic transfer consent guard")


if __name__ == "__main__":
    offer = {
        "role": "assistant",
        "content": "क्या मैं आपको हमारे ह्यूमन एजेंट से कनेक्ट कर दूँ?",
    }
    assert transfer_consent_decision([offer, {"role": "user", "content": "हाँ"}])[0] == "allow"
    assert transfer_consent_decision([offer, {"role": "user", "content": "नहीं"}])[0] == "deny"
    assert transfer_consent_decision([offer, {"role": "user", "content": "ना"}])[0] == "deny"
    assert transfer_consent_decision([offer, {"role": "user", "content": "रहने दो"}])[0] == "deny"
    assert transfer_consent_decision([offer, {"role": "user", "content": "रहने तो"}])[0] == "deny"
    assert transfer_consent_decision([offer, {"role": "user", "content": "rehne to"}])[0] == "deny"
    assert transfer_consent_decision([offer, {"role": "user", "content": "Hello"}])[0] == "clarify"
    assert transfer_consent_decision(
        [{"role": "user", "content": "human agent se baat karwa do"}]
    )[0] == "allow"
    assert transfer_consent_decision([
        {"role": "assistant", "content": "मुझे इस जानकारी की पुष्टि हमारी टीम से करानी होगी।"},
        {"role": "user", "content": "GST plus hai?"},
    ])[0] == "allow"
    class FakeContext:
        messages = [offer, {"role": "user", "content": "रहने तो"}]

    context = FakeContext()
    assert reinforce_transfer_decline_context(context) is True
    assert context.messages[-1]["content"].startswith("नहीं")
    print("transfer consent guard self-test passed")
