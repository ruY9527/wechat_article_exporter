# -*- coding: utf-8 -*-
"""带焦点校验的点击：每次操作前确认前台窗口，避免误点到别的窗口"""
import time

import uiauto as u
import winfocus as wf

CHROME = None


def set_target(hwnd):
    global CHROME
    CHROME = hwnd


def guard(hwnd=None):
    h = hwnd or CHROME
    if wf.foreground() != h:
        if not wf.focus(h):
            raise RuntimeError("focus lost")
        time.sleep(0.35)
    return h


def click(x, y, hwnd=None, wait=0.4):
    guard(hwnd)
    u.move(x, y)
    time.sleep(0.15)
    guard(hwnd)          # 移动后再确认
    u.click()
    time.sleep(wait)


def dclick(x, y, hwnd=None, wait=0.5):
    click(x, y, hwnd, wait=0.08)
    u.click()
    time.sleep(wait)


def paste(text, hwnd=None, wait=0.6):
    guard(hwnd)
    u.paste_text(text, wait=wait)


def keys(*ks, hwnd=None, wait=0.3):
    guard(hwnd)
    u.hotkey(*ks)
    time.sleep(wait)


def press(k, hwnd=None, times=1, wait=0.3):
    guard(hwnd)
    u.press(k, times=times)
    time.sleep(wait)
