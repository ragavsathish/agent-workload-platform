"""Dispose task VM checkpoint disks after a benchmark Pi process exits."""

from __future__ import annotations

import os
from pathlib import Path


def dispose(session_file: Path):
    checkpoint = Path(str(session_file.resolve()) + ".gondolin.qcow2")
    lock = Path(str(checkpoint) + ".lock")
    if lock.exists():
        pid = int(lock.read_text(encoding="utf-8").strip())
        if pid < 1:
            raise ValueError(f"invalid task VM owner PID: {lock}")
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            pass
        else:
            raise RuntimeError(f"task VM checkpoint is still owned by PID {pid}")
        lock.unlink()
    if checkpoint.exists():
        checkpoint.unlink()
        return True
    return False
