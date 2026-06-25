"""Pytest bootstrap for deterministic vault-path tests."""

import os
from pathlib import Path

import pytest

FIXTURE_VAULT = Path(__file__).resolve().parent / "fixtures" / "vault"
os.environ.setdefault("VAULT_PATH", str(FIXTURE_VAULT))

for relative in (
    # Legacy numbered-prefix structure (kept for any tests still referencing old paths)
    "05-Areas/Meetings",
    "05-Areas/Meetings/Daily_Log",
    # New PARA structure (post-Obsidian migration)
    "Inbox/Meetings",
    "Inbox/Ideas",
    "Inbox/Daily_Plans",
    "Projects",
    "Planning",
    "People/Internal",
    "People/External",
    "People/Companies",
    "Career/Evidence",
    "Archive/Intel/Meeting_Intel",
    "Archive/Intel/Meeting_Intel/raw",
    "Archive/Intel/Meeting_Intel/summaries",
    "Archive/Intel/Meeting_Intel/Daily_Log",
    "Archive/Learnings",
    "System/.dex",
):
    (FIXTURE_VAULT / relative).mkdir(parents=True, exist_ok=True)


@pytest.fixture
def fixture_vault() -> Path:
    """Return the path to the minimal PARA fixture vault."""
    return FIXTURE_VAULT
