"""Load simple local .env values without overriding process/container settings."""
import os
from pathlib import Path


def load_local_env():
    path = Path(__file__).resolve().parent.parent / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        if name.strip().replace("_", "").isalnum():
            os.environ.setdefault(name.strip(), value.strip().strip("'\""))
