# -*- coding: utf-8 -*-
"""用 SeBackupPrivilege 以备份语义复制被独占锁定的文件"""
import ctypes
import os
import shutil
import sys
from ctypes import wintypes

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)

TOKEN_ADJUST_PRIVILEGES = 0x0020
TOKEN_QUERY = 0x0008
SE_PRIVILEGE_ENABLED = 0x00000002
SE_BACKUP_NAME = "SeBackupPrivilege"
SE_RESTORE_NAME = "SeRestorePrivilege"


class LUID(ctypes.Structure):
    _fields_ = [("LowPart", wintypes.DWORD), ("HighPart", wintypes.LONG)]


class LUID_AND_ATTRIBUTES(ctypes.Structure):
    _fields_ = [("Luid", LUID), ("Attributes", wintypes.DWORD)]


class TOKEN_PRIVILEGES(ctypes.Structure):
    _fields_ = [("PrivilegeCount", wintypes.DWORD),
                ("Privileges", LUID_AND_ATTRIBUTES * 1)]


def enable_privilege(name):
    h = wintypes.HANDLE()
    if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(),
                                     TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY,
                                     ctypes.byref(h)):
        return f"OpenProcessToken failed {ctypes.get_last_error()}"
    luid = LUID()
    if not advapi32.LookupPrivilegeValueW(None, name, ctypes.byref(luid)):
        return f"LookupPrivilegeValue failed {ctypes.get_last_error()}"
    tp = TOKEN_PRIVILEGES()
    tp.PrivilegeCount = 1
    tp.Privileges[0].Luid = luid
    tp.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED
    if not advapi32.AdjustTokenPrivileges(h, False, ctypes.byref(tp), 0, None, None):
        return f"AdjustTokenPrivileges failed {ctypes.get_last_error()}"
    err = ctypes.get_last_error()
    return "ok" if err == 0 else f"AdjustTokenPrivileges err={err} (not held)"


GENERIC_READ = 0x80000000
FILE_SHARE_READ = 0x00000001
FILE_SHARE_WRITE = 0x00000002
FILE_SHARE_DELETE = 0x00000004
OPEN_EXISTING = 3
FILE_ATTRIBUTE_NORMAL = 0x80
FILE_FLAG_BACKUP_SEMANTICS = 0x02000000

kernel32.CreateFileW.restype = wintypes.HANDLE
kernel32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                 wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD,
                                 wintypes.HANDLE]


def copy_locked(src, dst):
    print("backup priv:", enable_privilege(SE_BACKUP_NAME))

    h = kernel32.CreateFileW(src, GENERIC_READ,
                             FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                             None, OPEN_EXISTING,
                             FILE_ATTRIBUTE_NORMAL | FILE_FLAG_BACKUP_SEMANTICS, None)
    if h == wintypes.HANDLE(-1).value or h is None:
        return f"CreateFile failed err={ctypes.get_last_error()}"

    os.makedirs(os.path.dirname(dst), exist_ok=True)
    buf = ctypes.create_string_buffer(1024 * 1024)
    read = wintypes.DWORD()
    total = 0
    with open(dst, "wb") as f:
        while True:
            if not kernel32.ReadFile(h, buf, len(buf), ctypes.byref(read), None):
                kernel32.CloseHandle(h)
                return f"ReadFile failed err={ctypes.get_last_error()} after {total}"
            if read.value == 0:
                break
            f.write(buf.raw[:read.value])
            total += read.value
    kernel32.CloseHandle(h)
    return f"ok {total} bytes"


if __name__ == "__main__":
    print(copy_locked(sys.argv[1], sys.argv[2]))
