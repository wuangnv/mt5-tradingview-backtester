"""Per-process Windows limits applied before importing the native engine."""

import ctypes
import os
from ctypes import wintypes


_job_handle = None


def constrain_process(memory_mb: int):
    if os.name != "nt":
        raise RuntimeError("isolated engine resource limits are verified on Windows only")
    if type(memory_mb) is not int or not 256 <= memory_mb <= 4096:
        raise ValueError("engine memory budget must be 256..4096 MiB")
    size = ctypes.c_size_t

    class Basic(ctypes.Structure):
        _fields_ = [("process_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong),
                    ("flags", wintypes.DWORD), ("min_ws", size), ("max_ws", size),
                    ("process_count", wintypes.DWORD), ("affinity", size),
                    ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]

    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_ulonglong) for name in ("read", "write", "other", "read_bytes", "write_bytes", "other_bytes")]

    class Extended(ctypes.Structure):
        _fields_ = [("basic", Basic), ("io", IO), ("process_memory", size), ("job_memory", size),
                    ("peak_process", size), ("peak_job", size)]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    global _job_handle
    _job_handle = kernel.CreateJobObjectW(None, None)
    if not _job_handle:
        raise ctypes.WinError(ctypes.get_last_error())
    limits = Extended()
    limits.basic.flags = 0x100 | 0x8 | 0x2000  # process memory, active process count, kill on close
    limits.basic.process_count = 1
    limits.process_memory = memory_mb * 1024 * 1024
    if not kernel.SetInformationJobObject(_job_handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
        raise ctypes.WinError(ctypes.get_last_error())
    if not kernel.AssignProcessToJobObject(_job_handle, kernel.GetCurrentProcess()):
        raise ctypes.WinError(ctypes.get_last_error())


def source_hash():
    import hashlib
    import json
    from pathlib import Path
    root = Path(__file__).resolve().parent
    paths = [root / name for name in ("adapter.py", "limits.py", "run.py", "pyproject.toml", "uv.lock")]
    return hashlib.sha256(json.dumps({path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}, sort_keys=True).encode()).hexdigest()
