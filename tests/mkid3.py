#!/usr/bin/env python3
"""Builds an MP3 with a hand-crafted ID3v2.4 tag to exercise the tag parser. Usage: mkid3.py raw.mp3 cover.jpg out.mp3"""
import sys, struct
def ss(n):  # syncsafe
    return bytes([(n>>21)&0x7f,(n>>14)&0x7f,(n>>7)&0x7f,n&0x7f])
def frame(fid, data, flags=0):
    return fid.encode() + ss(len(data)) + struct.pack('>H', flags) + data
raw, cover, out = sys.argv[1:4]
img = open(cover,'rb').read()
frames = b''
frames += frame('TIT2', b'\x01' + '﻿Été — Señorita ♫'.encode('utf-16-le') + b'\x00\x00')
frames += frame('TPE1', b'\x03' + 'DJ Ünïcode'.encode() + b'\x00' + b'Guest Star')
frames += frame('TALB', b'\x00' + 'Café Sessions'.encode('latin-1'))
frames += frame('TRCK', b'\x00' + b'4/10')
frames += frame('TDRC', b'\x03' + b'2023-06-01')
frames += frame('TCON', b'\x00' + b'(17)')
frames += frame('USLT', b'\x03' + b'eng' + b'\x00' + 'First line of the song\nSecond line ✨\n\nChorus line'.encode())
# APIC with data-length-indicator flag (0x0001): 4 syncsafe bytes precede the payload
apic = b'\x00' + b'image/jpeg\x00' + b'\x03' + b'front\x00' + img
frames += frame('APIC', ss(len(apic)) + apic, flags=0x0001)
# an "other" picture type that must not win over the front cover
frames += frame('APIC', b'\x00' + b'image/png\x00' + b'\x00' + b'\x00' + b'\x89PNG\r\n\x1a\n' + b'\x00'*32)
frames += b'\x00' * 256  # padding
tag = b'ID3' + bytes([4, 0, 0]) + ss(len(frames)) + frames
open(out, 'wb').write(tag + open(raw, 'rb').read())
