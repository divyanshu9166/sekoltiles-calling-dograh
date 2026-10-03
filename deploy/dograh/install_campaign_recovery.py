"""Install only the authenticated campaign recovery route in Dograh."""
from pathlib import Path

HOOK = "\nfrom api.services.telephony.campaign_recovery import install_campaign_recovery_routes\ninstall_campaign_recovery_routes(router, _validate_api_key)\n"


def patched_source(source):
    if HOOK.strip() in source:
        return source
    if "async def _validate_api_key(" not in source or 'router = APIRouter(prefix="/public/agent")' not in source:
        raise RuntimeError("Unsupported Dograh public_agent source; no changes applied")
    result = source + HOOK
    compile(result, "public_agent.py", "exec")
    return result


if __name__ == "__main__":
    path = Path("/app/api/routes/public_agent.py")
    path.write_text(patched_source(path.read_text()))
