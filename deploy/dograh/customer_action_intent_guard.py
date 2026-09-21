"""Deterministic intent gate for Sekol's CRM customer_action HTTP tool.

The voice LLM may occasionally jump from a tile-size answer into the
appointment flow.  The prompt is still responsible for the conversation, but
the irreversible CRM tool is allowed only when the customer actually asked
for an appointment (or the conversation is already in a legitimate booking
flow).  Catalogue requests are always kept separate.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from typing import Any

logger = logging.getLogger(__name__)

_APPOINTMENT = re.compile(
    r"\b(?:appointment|apointment|appoint|showroom|visit|slot|meeting|book)\b|"
    r"(?:अपॉइंटमेंट|अपॉइन्टमेंट|अपॉइंटमेन्ट|शोरूम|विजिट|मुलाकात|बुक)",
    re.IGNORECASE,
)
_CALLBACK = re.compile(
    r"\b(?:callback|call\s+(?:me\s+)?(?:back|later)|phone\s+later)\b|"
    r"(?:कॉल\s*बैक|बाद\s*में\s*(?:कॉल|फोन)|फिर\s*(?:कॉल|फोन))",
    re.IGNORECASE,
)
_CATALOGUE = re.compile(
    r"\b(?:catalog|catalogue|brochure)\b|(?:कैटलॉग|कैटालॉग|ब्रोशर)",
    re.IGNORECASE,
)


def _text(message: Any) -> str:
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


def _normalize(value: str) -> str:
    return unicodedata.normalize("NFKC", value or "").strip()


def _latest_user(messages: list[Any]) -> str:
    for message in reversed(messages):
        if isinstance(message, dict) and message.get("role") == "user":
            value = _normalize(_text(message))
            if value:
                return value
    return ""


def customer_action_allowed(messages: list[Any], arguments: dict[str, Any]) -> bool:
    """Return whether the requested CRM action has customer intent behind it."""

    action = str(arguments.get("action") or "").strip().lower()
    latest_user = _latest_user(messages)

    # A catalogue request can never become an appointment tool call, even if
    # an earlier message mentioned a showroom or appointment as an option.
    if _CATALOGUE.search(latest_user) and not _APPOINTMENT.search(latest_user):
        return False

    if action == "check":
        # Checking starts the appointment state machine, so the latest customer
        # turn itself must explicitly request an appointment/showroom visit.
        return bool(_APPOINTMENT.search(latest_user))

    if action in {"book", "reschedule"}:
        # Later date/time answers need not repeat "appointment".  Allow them
        # only if recent conversation already contains explicit appointment
        # intent from the customer or an appointment-specific assistant turn.
        recent = " ".join(_normalize(_text(item)) for item in messages[-10:])
        return bool(_APPOINTMENT.search(recent))

    if action == "callback":
        recent = " ".join(_normalize(_text(item)) for item in messages[-8:])
        return bool(_CALLBACK.search(recent))

    return False


def appointment_confirmation_message(action: str, result: Any) -> str | None:
    """Return the immediate spoken confirmation for a committed CRM result."""

    if action not in {"book", "reschedule"} or not isinstance(result, dict):
        return None
    if result.get("status") != "success":
        return None
    data = result.get("data")
    if not isinstance(data, dict) or data.get("success") is not True:
        return None
    if data.get("alreadyBooked") is True:
        return "आपकी अपॉइंटमेंट पहले से इसी समय पर बुक है, धन्यवाद।"
    if action == "reschedule" or data.get("rescheduled") is True:
        return "आपकी अपॉइंटमेंट अपडेट हो गई है, धन्यवाद।"
    return "आपका अपॉइंटमेंट बुक हो गया है, धन्यवाद।"


def install_customer_action_intent_guard(custom_tool_manager_class: type) -> None:
    """Wrap Dograh's HTTP tool factory exactly once."""

    if getattr(custom_tool_manager_class, "_sekol_customer_action_guard", False):
        return

    original_factory = custom_tool_manager_class._create_http_tool_handler

    def guarded_factory(self: Any, tool: Any, function_name: str):
        original_handler = original_factory(self, tool, function_name)
        if function_name != "customer_action":
            return original_handler

        async def guarded_handler(function_call_params: Any) -> None:
            messages = list(getattr(self._engine.context, "messages", []) or [])
            arguments = dict(getattr(function_call_params, "arguments", {}) or {})
            if customer_action_allowed(messages, arguments):
                action = str(arguments.get("action") or "").strip().lower()
                original_callback = function_call_params.result_callback

                async def appointment_result_callback(
                    result: Any, *callback_args: Any, **callback_kwargs: Any
                ) -> None:
                    confirmation = appointment_confirmation_message(action, result)
                    if confirmation is None:
                        await original_callback(
                            result, *callback_args, **callback_kwargs
                        )
                        return

                    # The appointment is already committed.  Do not spend a
                    # second LLM round deciding how to acknowledge it: speak
                    # the fixed confirmation immediately and close gracefully
                    # only after queued audio has played.
                    from pipecat.frames.frames import (
                        FunctionCallResultProperties,
                        TTSSpeakFrame,
                    )
                    from pipecat.utils.enums import EndTaskReason

                    await original_callback(
                        result,
                        properties=FunctionCallResultProperties(run_llm=False),
                    )
                    self._engine.set_call_disposition("appointment_booked")
                    self._engine.arm_speech_playback()
                    await self._engine.task.queue_frame(
                        TTSSpeakFrame(
                            confirmation,
                            append_to_context=True,
                            persist_to_logs=True,
                        )
                    )
                    await self._engine.end_call_with_reason(
                        EndTaskReason.END_CALL.value,
                        abort_immediately=False,
                    )

                function_call_params.result_callback = appointment_result_callback
                await original_handler(function_call_params)
                return

            action = str(arguments.get("action") or "").strip().lower()
            latest_user = _latest_user(messages)
            logger.warning(
                "Sekol customer_action guard BLOCKED action=%s latest_user=%r",
                action,
                latest_user,
            )
            await function_call_params.result_callback(
                {
                    "status": "blocked",
                    "success": False,
                    "code": "CUSTOMER_INTENT_REQUIRED",
                    "instruction": (
                        "The customer did not request an appointment or callback. "
                        "Do not ask for a date or time. Continue the configured "
                        "normal sales flow: after a supported size, give its "
                        "verified regional price and ask the catalogue-or-showroom "
                        "question. A catalogue request is not an appointment."
                    ),
                }
            )

        return guarded_handler

    custom_tool_manager_class._create_http_tool_handler = guarded_factory
    custom_tool_manager_class._sekol_customer_action_guard = True
    logger.info("Installed Sekol customer_action intent guard")


if __name__ == "__main__":
    size_only = [{"role": "user", "content": "मुझे बारह अठारह चाहिए"}]
    catalogue = [{"role": "user", "content": "कैटलॉग शेयर कर दो"}]
    appointment = [{"role": "user", "content": "showroom visit book कर दो"}]
    booking_date = appointment + [
        {"role": "assistant", "content": "किस दिन शोरूम आना चाहेंगे?"},
        {"role": "user", "content": "कल दो बजे"},
    ]
    assert not customer_action_allowed(size_only, {"action": "check"})
    assert not customer_action_allowed(catalogue, {"action": "check"})
    assert customer_action_allowed(appointment, {"action": "check"})
    assert customer_action_allowed(booking_date, {"action": "book"})
    assert appointment_confirmation_message(
        "book",
        {"status": "success", "status_code": 200, "data": {"success": True}},
    ) == "आपका अपॉइंटमेंट बुक हो गया है, धन्यवाद।"
    assert appointment_confirmation_message(
        "book",
        {
            "status": "success",
            "status_code": 200,
            "data": {"success": True, "alreadyBooked": True},
        },
    ) == "आपकी अपॉइंटमेंट पहले से इसी समय पर बुक है, धन्यवाद।"
    assert appointment_confirmation_message(
        "reschedule",
        {"status": "success", "status_code": 200, "data": {"success": True}},
    ) == "आपकी अपॉइंटमेंट अपडेट हो गई है, धन्यवाद।"
    assert not appointment_confirmation_message(
        "book",
        {"status": "success", "status_code": 400, "data": {"success": False}},
    )
    assert not appointment_confirmation_message(
        "check",
        {"status": "success", "status_code": 200, "data": {"success": True}},
    )
    print("customer_action intent guard self-test passed")
