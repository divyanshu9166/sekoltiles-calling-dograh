"""Install a tiny error-only notification hook; no changes on successful paths."""
from pathlib import Path

ANCHOR = '        context = _safe_log_context({**failure.context, **extra_context})\n'
HOOK = (
    ANCHOR
    + '        from api.services.pipecat.provider_alert_events import notify_provider_failure\n'
    + '        notify_provider_failure(failure, context)\n'
)


def patched_source(source):
    if "notify_provider_failure(failure, context)" in source:
        return source
    if source.count(ANCHOR) != 1 or "def log_failure(" not in source:
        raise RuntimeError("Unsupported Dograh failure logger; no changes applied")
    result = source.replace(ANCHOR, HOOK, 1)
    compile(result, "failure.py", "exec")
    return result


if __name__ == "__main__":
    path = Path("/app/api/errors/failure.py")
    path.write_text(patched_source(path.read_text()))
