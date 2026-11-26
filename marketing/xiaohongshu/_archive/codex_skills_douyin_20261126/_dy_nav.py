# -*- coding: utf-8 -*-
import ctypes, time
import uiauto as u, forcefg, winlist
from ctypes import wintypes
ctypes.windll.shcore.SetProcessDpiAwareness(2)
user32 = ctypes.WinDLL("user32")
out=[]
for h,t,r in winlist.list_chrome():
    out.append(f'{h} {r} {t}')
open('_dy_winlist.txt','w',encoding='utf-8').write('\n'.join(out))
print('\n'.join(out))
