from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, PlainTextResponse
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, List
import json
import os
import asyncio
import logging

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Data directory for JSON storage
DATA_DIR = Path(os.environ.get('DATA_DIR', Path.home() / 'termuxai' / 'data'))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# JSON file storage helpers
def read_json(name: str) -> dict | list:
    path = DATA_DIR / f"{name}.json"
    if path.exists():
        try:
            return json.loads(path.read_text())
        except:
            return {}
    return {}

def write_json(name: str, data):
    (DATA_DIR / f"{name}.json").write_text(json.dumps(data, default=str, indent=2))

# App and router
app = FastAPI(title="TermuxAI Backend")
api = APIRouter(prefix="/api")

# Models
class ConfigCreate(BaseModel):
    provider: str = ""
    api_key: str = ""
    endpoint: str = ""
    model: str = ""
    agent_name: str = "TermuxAI"
    system_prompt: str = ""
    theme: str = "cyberpunk_void"
    auto_execute: bool = False

class ChatMessage(BaseModel):
    content: str

class TerminalCommand(BaseModel):
    command: str

class FileWrite(BaseModel):
    path: str
    content: str

# Terminal session for WebSocket
class TerminalSession:
    def __init__(self):
        self.clients: set = set()
        self.history: List[str] = []
        self.max_history = 1000
        self.process = None
        
    async def broadcast(self, message: str):
        self.history.append(message)
        if len(self.history) > self.max_history:
            self.history = self.history[-self.max_history:]
        disconnected = set()
        for ws in self.clients:
            try:
                await ws.send_text(message)
            except:
                disconnected.add(ws)
        self.clients -= disconnected

terminal = TerminalSession()

# API Routes
@api.get("/")
def root():
    return {"message": "TermuxAI API", "version": "1.0.0"}

@api.get("/health")
def health():
    return {"status": "ok", "storage": "json", "terminal_active": len(terminal.clients) > 0}

@api.get("/config")
def get_config():
    config = read_json("config")
    if not config:
        return JSONResponse(status_code=404, content={"detail": "No configuration found"})
    config["has_api_key"] = bool(config.get("api_key"))
    # Don't expose actual API key
    if "api_key" in config:
        config["api_key"] = "***" if config["api_key"] else ""
    return config

@api.post("/config")
def save_config(data: ConfigCreate):
    existing = read_json("config") or {}
    now = datetime.now(timezone.utc).isoformat()
    
    new_config = data.dict()
    # Preserve existing API key if not provided
    if new_config.get("api_key") in ["", "UNCHANGED", "***"]:
        new_config["api_key"] = existing.get("api_key", "")
    
    new_config["updated_at"] = now
    new_config["created_at"] = existing.get("created_at", now)
    
    write_json("config", new_config)
    
    # Return without exposing API key
    new_config["has_api_key"] = bool(new_config.get("api_key"))
    new_config["api_key"] = "***" if new_config["api_key"] else ""
    return new_config

@api.get("/chat/history")
def get_chat_history():
    history = read_json("chat_history")
    return history if isinstance(history, list) else []

@api.delete("/chat/history")
def clear_chat_history():
    write_json("chat_history", [])
    return {"message": "Chat history cleared"}

@api.post("/chat")
async def chat(msg: ChatMessage):
    config = read_json("config")
    if not config or not config.get("api_key"):
        return JSONResponse(status_code=400, content={"detail": "AI not configured. Add API key in settings."})
    
    # Load history
    history = read_json("chat_history")
    if not isinstance(history, list):
        history = []
    
    # Add user message
    user_msg = {
        "role": "user",
        "content": msg.content,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    history.append(user_msg)
    
    # Call AI provider
    try:
        response = await call_ai(config, history)
        assistant_msg = {
            "role": "assistant",
            "content": response,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        history.append(assistant_msg)
        write_json("chat_history", history)
        return assistant_msg
    except Exception as e:
        logger.error(f"AI call failed: {e}")
        return JSONResponse(status_code=500, content={"detail": str(e)})

async def call_ai(config: dict, history: list) -> str:
    """Call AI provider API"""
    import httpx
    
    provider = config.get("provider", "")
    api_key = config.get("api_key", "")
    endpoint = config.get("endpoint", "")
    model = config.get("model", "")
    system_prompt = config.get("system_prompt", "")
    
    # Build messages
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    
    # Add recent history (last 20 messages)
    for m in history[-20:]:
        messages.append({"role": m["role"], "content": m["content"]})
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        if provider in ["openai", "openai_compatible"]:
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            payload = {"model": model, "messages": messages, "max_tokens": 4096}
            res = await client.post(endpoint, json=payload, headers=headers)
            res.raise_for_status()
            return res.json()["choices"][0]["message"]["content"]
            
        elif provider == "anthropic":
            headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"}
            # Anthropic format
            chat_msgs = [{"role": m["role"], "content": m["content"]} for m in messages if m["role"] != "system"]
            payload = {"model": model, "messages": chat_msgs, "max_tokens": 4096}
            if system_prompt:
                payload["system"] = system_prompt
            res = await client.post(endpoint, json=payload, headers=headers)
            res.raise_for_status()
            return res.json()["content"][0]["text"]
            
        elif provider == "google":
            url = f"{endpoint}/models/{model}:generateContent?key={api_key}"
            contents = []
            for m in messages:
                if m["role"] != "system":
                    role = "user" if m["role"] == "user" else "model"
                    contents.append({"role": role, "parts": [{"text": m["content"]}]})
            payload = {"contents": contents}
            if system_prompt:
                payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}
            res = await client.post(url, json=payload)
            res.raise_for_status()
            return res.json()["candidates"][0]["content"]["parts"][0]["text"]
        
        else:
            raise Exception(f"Unknown provider: {provider}")

# Terminal WebSocket
@app.websocket("/api/ws/terminal")
async def websocket_terminal(websocket: WebSocket):
    await websocket.accept()
    terminal.clients.add(websocket)
    
    # Send history
    if terminal.history:
        try:
            await websocket.send_text(''.join(terminal.history[-500:]))
        except:
            pass
    
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "input":
                    # Echo input and execute (simplified - real PTY needs more setup)
                    cmd = msg.get("data", "")
                    await terminal.broadcast(cmd)
                elif msg.get("type") == "resize":
                    pass  # Handle resize if needed
            except json.JSONDecodeError:
                await terminal.broadcast(data)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        terminal.clients.discard(websocket)

# File browser API
@api.get("/files")
def list_files(path: str = "/"):
    try:
        p = Path(path).resolve()
        if not p.exists():
            return JSONResponse(status_code=404, content={"detail": "Path not found"})
        if not p.is_dir():
            return JSONResponse(status_code=400, content={"detail": "Not a directory"})
        
        items = []
        for entry in sorted(p.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
            if entry.name.startswith('.') and entry.name not in ['.env', '.gitignore']:
                continue
            try:
                stat = entry.stat()
                items.append({
                    "name": entry.name,
                    "path": str(entry),
                    "is_dir": entry.is_dir(),
                    "size": stat.st_size if entry.is_file() else None,
                })
            except:
                continue
        
        return {"path": str(p), "parent": str(p.parent) if str(p) != "/" else None, "items": items}
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

@api.get("/files/read")
def read_file(path: str):
    try:
        p = Path(path).resolve()
        if not p.exists():
            return JSONResponse(status_code=404, content={"detail": "File not found"})
        if not p.is_file():
            return JSONResponse(status_code=400, content={"detail": "Not a file"})
        if p.stat().st_size > 512 * 1024:
            return JSONResponse(status_code=400, content={"detail": "File too large"})
        
        content = p.read_text(encoding='utf-8', errors='replace')
        return {"path": str(p), "name": p.name, "content": content}
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

@api.post("/files/write")
def write_file(req: FileWrite):
    try:
        p = Path(req.path).resolve()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(req.content, encoding='utf-8')
        return {"message": "File saved", "path": str(p)}
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

@api.delete("/files")
def delete_file(path: str):
    try:
        p = Path(path).resolve()
        if not p.exists():
            return JSONResponse(status_code=404, content={"detail": "Not found"})
        if p.is_dir():
            import shutil
            shutil.rmtree(p)
        else:
            p.unlink()
        return {"message": "Deleted", "path": path}
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

# Include router
app.include_router(api)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
