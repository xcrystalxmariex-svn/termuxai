import asyncio
import os
import signal
import json
import logging
import uuid
import httpx
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Simplified JSON DB
class _JDB:
    def __init__(self, data_dir):
        self._dir = Path(data_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
    def __getattr__(self, name):
        return _JDoc(self._dir / f"{name}.json")

class _JDoc:
    def __init__(self, path):
        self._path = path
    def _read(self):
        if self._path.exists():
            try: return json.loads(self._path.read_text())
            except: return []
        return []
    def _write(self, data):
        self._path.write_text(json.dumps(data, default=str, indent=2))
    async def find_one(self, filt=None, proj=None):
        data = self._read()
        if not filt: return data[0] if data else None
        for d in data:
            if all(d.get(k) == v for k, v in filt.items()): return d
        return None
    async def insert_one(self, doc):
        data = self._read()
        data.append(doc)
        self._write(data)
    async def update_one(self, filt, update, upsert=False):
        data = self._read()
        found = False
        for i, d in enumerate(data):
            if all(d.get(k) == v for k, v in filt.items()):
                if '$set' in update: data[i].update(update['$set'])
                found = True; break
        if not found and upsert: data.append(update.get('$set', {}))
        self._write(data)
    def find(self, filt=None):
        return self
    def sort(self, k, d=1): return self
    def limit(self, n): return self
    async def to_list(self, n=0): return self._read()

db = _JDB(os.environ.get('DATA_DIR', str(ROOT_DIR / 'data')))

class TerminalSession:
    def __init__(self):
        self.proc = None
        self.clients = set()
        self.history = []
        self._running = False
    async def start(self):
        if self._running: return
        self.proc = await asyncio.create_subprocess_shell(
            "/data/data/com.termux/files/usr/bin/bash --login",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env={"TERM": "xterm-256color", "HOME": os.environ.get('HOME', '/data/data/com.termux/files/home')}
        )
        self._running = True
        asyncio.create_task(self._read_loop())
    async def _read_loop(self):
        while self._running and self.proc.stdout:
            data = await self.proc.stdout.read(4096)
            if not data: break
            text = data.decode('utf-8', errors='replace')
            self.history.append(text)
            for ws in list(self.clients):
                try: await ws.send_text(text)
                except: self.clients.remove(ws)
    def write(self, data):
        if self.proc and self.proc.stdin:
            self.proc.stdin.write(data.encode())
    def get_history(self, n=5000): return "".join(self.history)[-n:]

terminal = TerminalSession()
app = FastAPI()
api = APIRouter(prefix="/api")

@api.post("/chat")
async def chat(msg: BaseModel):
    # AI logic placeholder - keeping it lean for the commit
    return {"role": "assistant", "content": "Termux compatibility mode active."}

@api.get("/health")
async def health(): return {"status": "ok", "terminal": terminal._running}

@api.websocket("/ws/terminal")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    terminal.clients.add(ws)
    await ws.send_text(terminal.get_history())
    try:
        while True:
            data = await ws.receive_text()
            terminal.write(data)
    except WebSocketDisconnect:
        terminal.clients.remove(ws)

app.include_router(api)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
