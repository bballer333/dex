"""Shared safe file operations for concurrent writers."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

# Per-path threading locks (Windows cross-thread locking — fcntl is POSIX-only).
_thread_locks: dict[str, threading.Lock] = {}
_thread_locks_meta = threading.Lock()


def _get_thread_lock(path: Path) -> threading.Lock:
    key = str(path.resolve())
    with _thread_locks_meta:
        if key not in _thread_locks:
            _thread_locks[key] = threading.Lock()
        return _thread_locks[key]


@contextmanager
def file_lock(lock_path: Path, timeout_seconds: float = 5.0, poll_seconds: float = 0.05) -> Iterator[None]:
    """Acquire an advisory lock for a file path with timeout.

    POSIX: uses fcntl.flock (cross-process).
    Windows: uses a per-path threading.Lock (cross-thread within one process).
    """
    lock_path.parent.mkdir(parents=True, exist_ok=True)

    if sys.platform == "win32":
        thread_lock = _get_thread_lock(lock_path)
        start = time.monotonic()
        while not thread_lock.acquire(blocking=False):
            if time.monotonic() - start >= timeout_seconds:
                raise TimeoutError(f"Could not acquire lock within {timeout_seconds}s: {lock_path}")
            time.sleep(poll_seconds)
        try:
            yield
        finally:
            thread_lock.release()
    else:
        import fcntl

        fd = lock_path.open("a+", encoding="utf-8")
        start = time.monotonic()
        try:
            while True:
                try:
                    fcntl.flock(fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() - start >= timeout_seconds:
                        raise TimeoutError(f"Could not acquire lock within {timeout_seconds}s: {lock_path}")
                    time.sleep(poll_seconds)
            yield
        finally:
            try:
                fcntl.flock(fd.fileno(), fcntl.LOCK_UN)
            finally:
                fd.close()


def atomic_write_text(path: Path, content: str, encoding: str = "utf-8") -> None:
    """Atomically write text file by replace-on-rename in the same directory."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", delete=False, dir=path.parent, encoding=encoding) as tmp:
        tmp.write(content)
        tmp.flush()
        os.fsync(tmp.fileno())
        temp_name = tmp.name
    os.replace(temp_name, path)


def atomic_write_json(path: Path, data: dict) -> None:
    """Atomically persist JSON data."""
    payload = json.dumps(data, indent=2) + "\n"
    atomic_write_text(path, payload)
