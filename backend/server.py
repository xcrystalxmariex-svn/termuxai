from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import JSONResponse, HTMLResponse, PlainTextResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
import json
import pty
import fcntl
import struct
import termios
import select
import signal
import asyncio
import threading
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')


# ===== JSON File Storage (MongoDB-compatible async interface) =====

class _JDoc:
    def __init__(self, path):
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _read(self):
        if self._path.exists():
            try:
                return json.loads(self._path.read_text())
            except Exception:
                return []
        return []

    def _write(self, data):
        self._path.write_text(json.dumps(data, default=str, indent=2))

    def _match(self, doc, filt):
        return all(doc.get(k) == v for k, v in filt.items()) if filt else True

    def _clean(self, doc):
        return {k: v for k, v in doc.items() if k != '_id'}

    async def find_one(self, filt=None, proj=None):
        filt = filt or {}
        for d in self._read():
            if self._match(d, filt):
                return self._clean(d)
        return None

    async def insert_one(self, doc):
        with self._lock:
            data = self._read()
            data.append(self._clean(doc))
            self._write(data)

    async def update_one(self, filt, update, upsert=False):
        with self._lock:
            data = self._read()
            filt = filt or {}
            for i, d in enumerate(data):
                if self._match(d, filt):
                    if '$set' in update:
                        data[i].update(update['$set'])
                    self._write(data)
                    return
            if upsert and '$set' in update:
                data.append(update['$set'])
                self._write(data)

    async def delete_many(self, filt=None):
        with self._lock:
            if not filt:
                self._write([])
            else:
                data = [d for d in self._read() if not self._match(d, filt)]
                self._write(data)

    def find(self, filt=None, proj=None):
        filt = filt or {}
        return _JCursor([self._clean(d) for d in self._read() if self._match(d, filt)])


class _JCursor:
    def __init__(self, data):
        self._data = data

    def sort(self, key, direction=1):
        self._data.sort(key=lambda x: x.get(key, ''), reverse=(direction == -1))
        return self

    def limit(self, n):
        self._data = self._data[:n]
        return self

    async def to_list(self, length=None):
        return self._data[:length] if length else self._data


class _JDB:
    def __init__(self, data_dir):
        self._dir = Path(data_dir)
        self._dir.mkdir(parents=True, exist_ok=True)

    def __getattr__(self, name):
        return _JDoc(self._dir / f"{name}.json")


# ===== Auto-detect storage backend =====
STORAGE_TYPE = 'json'
client = None

try:
    mongo_url = os.environ.get('MONGO_URL', '')
    if mongo_url:
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(mongo_url)
        db = client[os.environ.get('DB_NAME', 'termuxai')]
        STORAGE_TYPE = 'mongodb'
    else:
        raise KeyError("No MONGO_URL")
except (ImportError, KeyError, Exception):
    data_dir = os.environ.get('DATA_DIR', str(ROOT_DIR / 'data'))
    db = _JDB(data_dir)
    STORAGE_TYPE = 'json'

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ===== Models =====

class AppConfigCreate(BaseModel):
    provider: str
    api_key: str
    endpoint: str
    model: str
    agent_name: Optional[str] = "TermuxAI"
    system_prompt: Optional[str] = ""
    theme: str = "cyberpunk_void"
    auto_execute: bool = False


class ChatMessageCreate(BaseModel):
    content: str


class TerminalExecuteRequest(BaseModel):
    command: str


class FileWriteRequest(BaseModel):
    path: str
    content: str


class MkdirRequest(BaseModel):
    path: str


# ===== Terminal Session =====

class TerminalSession:
    def __init__(self):
        self.master_fd = None
        self.pid = None
        self.clients: set = set()
        self.history_buffer: List[str] = []
        self.max_history = 2000
        self._running = False
        self._read_task = None
        self._save_task = None

    def start(self):
        if self._running:
            return
        self.master_fd, slave_fd = pty.openpty()
        winsize = struct.pack('HHHH', 30, 120, 0, 0)
        fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)

        self.pid = os.fork()
        if self.pid == 0:
            os.close(self.master_fd)
            os.setsid()
            fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
            os.dup2(slave_fd, 0)
            os.dup2(slave_fd, 1)
            os.dup2(slave_fd, 2)
            if slave_fd > 2:
                os.close(slave_fd)
            env = os.environ.copy()
            env['TERM'] = 'xterm-256color'
            env['HOME'] = '/root'
            os.execvpe('/bin/bash', ['/bin/bash', '--login'], env)
        else:
            os.close(slave_fd)
            flags = fcntl.fcntl(self.master_fd, fcntl.F_GETFL)
            fcntl.fcntl(self.master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
            self._running = True

    async def start_reading(self):
        if self._read_task is None or self._read_task.done():
            self._read_task = asyncio.create_task(self._read_loop())
        if self._save_task is None or self._save_task.done():
            self._save_task = asyncio.create_task(self._periodic_save())

    async def restore_session(self):
        """Restore terminal buffer from MongoDB on startup"""
        try:
            saved = await db.terminal_session.find_one({}, {"_id": 0})
            if saved and saved.get("buffer"):
                self.history_buffer = saved["buffer"][-self.max_history:]
                logger.info(f"Restored terminal session ({len(self.history_buffer)} chunks)")
        except Exception as e:
            logger.error(f"Failed to restore session: {e}")

    async def _periodic_save(self):
        """Save terminal buffer to MongoDB every 30 seconds"""
        while self._running:
            try:
                await asyncio.sleep(30)
                if self.history_buffer:
                    await db.terminal_session.update_one(
                        {},
                        {"$set": {
                            "buffer": self.history_buffer[-self.max_history:],
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        }},
                        upsert=True,
                    )
            except Exception as e:
                logger.error(f"Failed to save session: {e}")

    async def save_now(self):
        """Force save terminal buffer immediately"""
        try:
            if self.history_buffer:
                await db.terminal_session.update_one(
                    {},
                    {"$set": {
                        "buffer": self.history_buffer[-self.max_history:],
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }},
                    upsert=True,
                )
        except Exception:
            pass

    async def _read_loop(self):
        loop = asyncio.get_event_loop()
        while self._running:
            try:
                data = await loop.run_in_executor(None, self._read)
                if data:
                    text = data.decode('utf-8', errors='replace')
                    self.history_buffer.append(text)
                    if len(self.history_buffer) > self.max_history:
                        self.history_buffer = self.history_buffer[-self.max_history:]
                    disconnected = set()
                    for ws in self.clients:
                        try:
                            await ws.send_text(text)
                        except Exception:
                            disconnected.add(ws)
                    self.clients -= disconnected
            except Exception:
                if self._running:
                    await asyncio.sleep(0.01)

    def _read(self):
        try:
            r, _, _ = select.select([self.master_fd], [], [], 0.1)
            if r:
                return os.read(self.master_fd, 4096)
        except (OSError, ValueError):
            pass
        return None

    def write(self, data: str):
        if self.master_fd is not None:
            try:
                os.write(self.master_fd, data.encode('utf-8'))
            except OSError:
                pass

    def resize(self, rows: int, cols: int):
        if self.master_fd is not None:
            try:
                winsize = struct.pack('HHHH', rows, cols, 0, 0)
                fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
            except OSError:
                pass

    def get_history(self, chars=5000):
        history = ''.join(self.history_buffer)
        return history[-chars:] if len(history) > chars else history

    def stop(self):
        self._running = False
        if self.pid:
            try:
                os.kill(self.pid, signal.SIGTERM)
                os.waitpid(self.pid, os.WNOHANG)
            except Exception:
                pass
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except Exception:
                pass


terminal = TerminalSession()


# ===== AI Provider =====

async def call_ai_provider(config: dict, messages: list) -> str:
    provider = config['provider']
    api_key = config['api_key']
    endpoint = config['endpoint']
    model = config['model']

    try:
        async with httpx.AsyncClient(timeout=90.0) as http_client:
            if provider in ['openai', 'openai_compatible']:
                headers = {
                    'Authorization': f'Bearer {api_key}',
                    'Content-Type': 'application/json'
                }
                payload = {
                    'model': model,
                    'messages': messages,
                    'max_tokens': 4096
                }
                response = await http_client.post(endpoint, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
                return data['choices'][0]['message']['content']

            elif provider == 'anthropic':
                headers = {
                    'x-api-key': api_key,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json'
                }
                system_msg = None
                chat_msgs = []
                for m in messages:
                    if m['role'] == 'system':
                        system_msg = m['content']
                    else:
                        chat_msgs.append({'role': m['role'], 'content': m['content']})
                payload = {
                    'model': model,
                    'messages': chat_msgs,
                    'max_tokens': 4096
                }
                if system_msg:
                    payload['system'] = system_msg
                response = await http_client.post(endpoint, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
                return data['content'][0]['text']

            elif provider == 'google':
                url = f"{endpoint}/models/{model}:generateContent?key={api_key}"
                system_msg = None
                contents = []
                for m in messages:
                    if m['role'] == 'system':
                        system_msg = m['content']
                    else:
                        role = 'user' if m['role'] == 'user' else 'model'
                        contents.append({'role': role, 'parts': [{'text': m['content']}]})
                payload = {'contents': contents}
                if system_msg:
                    payload['systemInstruction'] = {'parts': [{'text': system_msg}]}
                response = await http_client.post(url, json=payload)
                response.raise_for_status()
                data = response.json()
                return data['candidates'][0]['content']['parts'][0]['text']

            elif provider == 'generic':
                headers = {'Content-Type': 'application/json'}
                if api_key:
                    headers['Authorization'] = f'Bearer {api_key}'
                payload = {'messages': messages}
                if model:
                    payload['model'] = model
                response = await http_client.post(endpoint, json=payload, headers=headers)
                response.raise_for_status()
                try:
                    data = response.json()
                    if 'choices' in data:
                        return data['choices'][0]['message']['content']
                    elif 'content' in data:
                        if isinstance(data['content'], list):
                            return data['content'][0]['text']
                        return data['content']
                    else:
                        return json.dumps(data)
                except Exception:
                    return response.text
            else:
                raise Exception(f"Unknown provider: {provider}")

    except httpx.HTTPStatusError as e:
        raise Exception(f"AI API error ({e.response.status_code}): {e.response.text[:500]}")
    except Exception as e:
        if "AI API error" in str(e):
            raise
        raise Exception(f"AI provider error: {str(e)}")


def parse_code_blocks(text: str) -> List[str]:
    commands = []
    in_block = False
    current_block = []
    for line in text.split('\n'):
        stripped = line.strip()
        if stripped.startswith('```bash') or stripped.startswith('```shell') or stripped.startswith('```sh'):
            in_block = True
            current_block = []
        elif stripped == '```' and in_block:
            in_block = False
            if current_block:
                commands.append('\n'.join(current_block))
        elif in_block:
            current_block.append(line)
    return commands


# ===== API Routes =====

@api_router.get("/")
async def root():
    return {"message": "TermuxAI API", "version": "1.0.0"}


@api_router.get("/config")
async def get_config():
    config = await db.config.find_one({}, {"_id": 0})
    if not config:
        return JSONResponse(status_code=404, content={"detail": "No configuration found"})
    return {
        "id": config.get("id", ""),
        "provider": config.get("provider", ""),
        "endpoint": config.get("endpoint", ""),
        "model": config.get("model", ""),
        "agent_name": config.get("agent_name", "TermuxAI"),
        "system_prompt": config.get("system_prompt", ""),
        "theme": config.get("theme", "cyberpunk_void"),
        "auto_execute": config.get("auto_execute", False),
        "has_api_key": bool(config.get("api_key", "")),
        "created_at": config.get("created_at", ""),
        "updated_at": config.get("updated_at", ""),
    }


@api_router.post("/config")
async def save_config(config_data: AppConfigCreate):
    now = datetime.now(timezone.utc).isoformat()
    existing = await db.config.find_one({}, {"_id": 0})
    config_dict = config_data.dict()
    config_dict["updated_at"] = now

    # Preserve existing API key if not provided or placeholder
    if existing and config_dict.get("api_key") in ["", "UNCHANGED", "EXISTING_KEY_PLACEHOLDER"]:
        config_dict["api_key"] = existing.get("api_key", "")

    if existing:
        config_dict["id"] = existing.get("id", str(uuid.uuid4()))
        config_dict["created_at"] = existing.get("created_at", now)
        await db.config.update_one({}, {"$set": config_dict})
    else:
        config_dict["id"] = str(uuid.uuid4())
        config_dict["created_at"] = now
        await db.config.insert_one(config_dict)

    return {
        "id": config_dict["id"],
        "provider": config_dict["provider"],
        "endpoint": config_dict["endpoint"],
        "model": config_dict["model"],
        "agent_name": config_dict["agent_name"],
        "system_prompt": config_dict["system_prompt"],
        "theme": config_dict["theme"],
        "auto_execute": config_dict["auto_execute"],
        "has_api_key": bool(config_dict["api_key"]),
        "created_at": config_dict["created_at"],
        "updated_at": config_dict["updated_at"],
    }


@api_router.post("/chat")
async def chat(message: ChatMessageCreate):
    config = await db.config.find_one({}, {"_id": 0})
    if not config:
        return JSONResponse(status_code=400, content={"detail": "AI not configured"})

    user_msg_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    user_msg = {"id": user_msg_id, "role": "user", "content": message.content, "timestamp": now}
    await db.chat_history.insert_one({**user_msg})

    terminal_history = terminal.get_history(3000) if terminal._running else "(Terminal not active)"
    agent_name = config.get("agent_name", "TermuxAI")
    custom_prompt = config.get("system_prompt", "")

    system_content = f"""You are {agent_name}, an AI coding assistant with full access to a Linux terminal.

{custom_prompt}

CURRENT TERMINAL OUTPUT (last activity):
```
{terminal_history}
```

When you want to run a command in the terminal, put it in a bash code block:
```bash
command here
```

Be concise. Help with coding, debugging, installations, and system tasks."""

    recent_msgs = await db.chat_history.find({}, {"_id": 0}).sort("timestamp", -1).limit(20).to_list(20)
    recent_msgs.reverse()

    messages = [{"role": "system", "content": system_content}]
    for msg in recent_msgs:
        messages.append({"role": msg["role"], "content": msg["content"]})

    try:
        ai_response = await call_ai_provider(config, messages)
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

    executed_commands = []
    if config.get("auto_execute", False):
        commands = parse_code_blocks(ai_response)
        for cmd in commands:
            terminal.write(cmd + '\n')
            executed_commands.append(cmd)
            await asyncio.sleep(0.2)

    assistant_msg_id = str(uuid.uuid4())
    assistant_msg = {
        "id": assistant_msg_id,
        "role": "assistant",
        "content": ai_response,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "executed_commands": executed_commands if executed_commands else None,
    }
    await db.chat_history.insert_one({**assistant_msg})

    return {
        "id": assistant_msg_id,
        "role": "assistant",
        "content": ai_response,
        "timestamp": assistant_msg["timestamp"],
        "executed_commands": executed_commands if executed_commands else None,
    }


@api_router.get("/chat/history")
async def get_chat_history():
    messages = await db.chat_history.find({}, {"_id": 0}).sort("timestamp", 1).to_list(200)
    return messages


@api_router.delete("/chat/history")
async def clear_chat_history():
    await db.chat_history.delete_many({})
    return {"message": "Chat history cleared"}


@api_router.post("/terminal/execute")
async def execute_terminal_command(req: TerminalExecuteRequest):
    if not terminal._running:
        terminal.start()
        await terminal.start_reading()
        await asyncio.sleep(0.5)
    terminal.write(req.command + '\n')
    return {"message": "Command sent", "command": req.command}


@api_router.get("/terminal/history")
async def get_terminal_history():
    history = terminal.get_history(5000) if terminal._running else ""
    return {"history": history}


@api_router.post("/terminal/save-session")
async def save_terminal_session():
    await terminal.save_now()
    return {"message": "Session saved"}


# ===== File Browser API =====

SAFE_ROOT = "/"

def safe_resolve(path: str) -> Path:
    """Resolve path safely"""
    resolved = Path(path).resolve()
    blocked = ['/proc', '/sys', '/dev']
    for b in blocked:
        if str(resolved).startswith(b):
            raise ValueError("Access denied to system directory")
    return resolved


@api_router.get("/files")
async def list_files(path: str = "/"):
    try:
        resolved = safe_resolve(path)
        if not resolved.exists():
            return JSONResponse(status_code=404, content={"detail": "Path not found"})
        if not resolved.is_dir():
            return JSONResponse(status_code=400, content={"detail": "Not a directory"})

        items = []
        try:
            entries = sorted(resolved.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        except PermissionError:
            return JSONResponse(status_code=403, content={"detail": "Permission denied"})

        for entry in entries:
            if entry.name.startswith('.') and entry.name not in ['.env', '.gitignore']:
                continue
            try:
                stat = entry.stat()
                items.append({
                    "name": entry.name,
                    "path": str(entry),
                    "is_dir": entry.is_dir(),
                    "size": stat.st_size if entry.is_file() else None,
                    "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                })
            except (PermissionError, OSError):
                continue

        parent = str(resolved.parent) if str(resolved) != "/" else None

        return {"path": str(resolved), "parent": parent, "items": items}
    except ValueError as e:
        return JSONResponse(status_code=403, content={"detail": str(e)})


@api_router.get("/files/read")
async def read_file(path: str):
    try:
        resolved = safe_resolve(path)
        if not resolved.exists():
            return JSONResponse(status_code=404, content={"detail": "File not found"})
        if not resolved.is_file():
            return JSONResponse(status_code=400, content={"detail": "Not a file"})
        if resolved.stat().st_size > 1024 * 512:
            return JSONResponse(status_code=400, content={"detail": "File too large (>512KB)"})

        try:
            content = resolved.read_text(encoding='utf-8', errors='replace')
        except Exception:
            content = resolved.read_text(encoding='latin-1')

        ext = resolved.suffix.lower()
        lang_map = {
            '.py': 'python', '.js': 'javascript', '.ts': 'typescript',
            '.tsx': 'tsx', '.jsx': 'jsx', '.json': 'json', '.md': 'markdown',
            '.html': 'html', '.css': 'css', '.sh': 'bash', '.yml': 'yaml',
            '.yaml': 'yaml', '.toml': 'toml', '.rs': 'rust', '.go': 'go',
            '.java': 'java', '.c': 'c', '.cpp': 'cpp', '.h': 'c',
            '.rb': 'ruby', '.php': 'php', '.sql': 'sql', '.xml': 'xml',
            '.env': 'bash', '.txt': 'text', '.log': 'text',
        }

        return {
            "path": str(resolved),
            "name": resolved.name,
            "content": content,
            "language": lang_map.get(ext, 'text'),
            "size": resolved.stat().st_size,
        }
    except ValueError as e:
        return JSONResponse(status_code=403, content={"detail": str(e)})


@api_router.post("/files/write")
async def write_file(req: FileWriteRequest):
    try:
        resolved = safe_resolve(req.path)
        resolved.parent.mkdir(parents=True, exist_ok=True)
        resolved.write_text(req.content, encoding='utf-8')
        return {
            "message": "File saved",
            "path": str(resolved),
        }
    except ValueError as e:
        return JSONResponse(status_code=403, content={"detail": str(e)})
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})


@api_router.post("/files/mkdir")
async def create_directory(req: MkdirRequest):
    try:
        resolved = safe_resolve(req.path)
        resolved.mkdir(parents=True, exist_ok=True)
        return {
            "message": "Directory created",
            "path": str(resolved),
        }
    except ValueError as e:
        return JSONResponse(status_code=403, content={"detail": str(e)})


@api_router.delete("/files")
async def delete_file(path: str):
    try:
        resolved = safe_resolve(path)
        if not resolved.exists():
            return JSONResponse(status_code=404, content={"detail": "Not found"})

        if resolved.is_dir():
            import shutil
            shutil.rmtree(resolved)
        else:
            resolved.unlink()

        return {"message": "Deleted", "path": path}
    except ValueError as e:
        return JSONResponse(status_code=403, content={"detail": str(e)})
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})


# ===== Termux Setup & Download Endpoints =====

@api_router.get("/download/server.py", response_class=PlainTextResponse)
async def download_server():
    """Serve server.py for Termux setup"""
    server_path = ROOT_DIR / 'server.py'
    return PlainTextResponse(content=server_path.read_text())


@api_router.get("/termux-setup", response_class=PlainTextResponse)
async def termux_setup(request: Request):
    """Serve automated Termux setup script"""
    host = request.headers.get("host", "localhost:8001")
    scheme = request.headers.get("x-forwarded-proto", "http")
    base_url = f"{scheme}://{host}"

    script = f"""#!/data/data/com.termux/files/usr/bin/bash
set -e
echo ""
echo "======================================"
echo "  TermuxAI Auto-Setup Script"
echo "======================================"
echo ""

# Step 1: Update and install packages
echo "[1/5] Installing system packages..."
pkg update -y && pkg upgrade -y
pkg install -y python tmux

# Step 2: Install Python dependencies
echo "[2/5] Installing Python packages..."
pip install --upgrade pip
pip install fastapi uvicorn httpx python-dotenv

# Step 3: Create project directory
echo "[3/5] Creating project structure..."
mkdir -p ~/termuxai/data
cd ~/termuxai

# Step 4: Download server.py
echo "[4/5] Downloading server..."
curl -sSL {base_url}/api/download/server.py -o server.py

# Create .env for local JSON storage
cat > .env << 'ENVEOF'
STORAGE_TYPE=json
DATA_DIR=/data/data/com.termux/files/home/termuxai/data
DB_NAME=termuxai
ENVEOF

# Step 5: Create management scripts
echo "[5/5] Creating management scripts..."

# Start script with tmux + wake-lock + auto-restart
cat > start.sh << 'STARTEOF'
#!/data/data/com.termux/files/usr/bin/bash
echo "Starting TermuxAI server..."
termux-wake-lock 2>/dev/null || true
# Kill existing session if any
tmux kill-session -t termuxai 2>/dev/null || true
# Start server in tmux with auto-restart loop
tmux new-session -d -s termuxai "cd ~/termuxai && while true; do echo '=== TermuxAI Server Starting ===' && python -m uvicorn server:app --host 0.0.0.0 --port 8080 --reload; echo ''; echo 'Server stopped. Restarting in 3s...'; sleep 3; done"
echo ""
echo "TermuxAI server started!"
echo "  View logs:  tmux attach -t termuxai"
echo "  Stop:       ~/termuxai/stop.sh"
echo "  URL:        http://localhost:8080"
echo ""
STARTEOF
chmod +x start.sh

# Stop script
cat > stop.sh << 'STOPEOF'
#!/data/data/com.termux/files/usr/bin/bash
echo "Stopping TermuxAI server..."
tmux kill-session -t termuxai 2>/dev/null || true
termux-wake-unlock 2>/dev/null || true
echo "Server stopped."
STOPEOF
chmod +x stop.sh

# Status script
cat > status.sh << 'STATUSEOF'
#!/data/data/com.termux/files/usr/bin/bash
if tmux has-session -t termuxai 2>/dev/null; then
    echo "TermuxAI: RUNNING"
    echo "  View: tmux attach -t termuxai"
    echo "  Stop: ~/termuxai/stop.sh"
    curl -s http://localhost:8080/api/ 2>/dev/null && echo "  API: OK" || echo "  API: Starting..."
else
    echo "TermuxAI: STOPPED"
    echo "  Start: ~/termuxai/start.sh"
fi
STATUSEOF
chmod +x status.sh

# Auto-start on Termux boot (optional - needs Termux:Boot)
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/termuxai << 'BOOTEOF'
#!/data/data/com.termux/files/usr/bin/bash
cd ~/termuxai && ./start.sh
BOOTEOF
chmod +x ~/.termux/boot/termuxai

echo ""
echo "======================================"
echo "  Setup Complete!"
echo "======================================"
echo ""
echo "  Start server:  cd ~/termuxai && ./start.sh"
echo "  Stop server:   cd ~/termuxai && ./stop.sh"
echo "  Check status:  cd ~/termuxai && ./status.sh"
echo ""
echo "  Auto-start on boot: Install Termux:Boot app"
echo ""
echo "Starting server now..."
cd ~/termuxai && ./start.sh
"""
    return PlainTextResponse(content=script)


@api_router.get("/health")
async def health_check():
    """Health check endpoint for connection detection"""
    return {
        "status": "ok",
        "storage": STORAGE_TYPE,
        "terminal_active": terminal._running,
        "version": "1.0.0",
    }


@api_router.get("/download/project.tar.gz")
async def download_project():
    """Download entire project as tar.gz for APK building"""
    import tarfile
    import io

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz') as tar:
        base = Path('/app')
        files_to_include = [
            'backend/server.py',
            'backend/.env',
            'backend/requirements.txt',
            'frontend/app.json',
            'frontend/eas.json',
            'frontend/package.json',
            'frontend/tsconfig.json',
            'frontend/.env',
            'frontend/eslint.config.js',
            'frontend/metro.config.js',
            'frontend/app/_layout.tsx',
            'frontend/app/index.tsx',
            'frontend/app/onboarding.tsx',
            'frontend/app/connection.tsx',
            'frontend/app/(tabs)/_layout.tsx',
            'frontend/app/(tabs)/terminal.tsx',
            'frontend/app/(tabs)/agent.tsx',
            'frontend/app/(tabs)/files.tsx',
            'frontend/app/(tabs)/settings.tsx',
            'frontend/src/constants/themes.ts',
            'frontend/src/contexts/ThemeContext.tsx',
            'frontend/src/config.ts',
        ]
        for f in files_to_include:
            full = base / f
            if full.exists():
                tar.add(str(full), arcname=f'termuxai/{f}')

    buf.seek(0)
    from starlette.responses import Response
    return Response(
        content=buf.read(),
        media_type='application/gzip',
        headers={'Content-Disposition': 'attachment; filename=termuxai-project.tar.gz'},
    )


# ===== Terminal HTML (for web iframe) =====

@api_router.get("/terminal-html", response_class=HTMLResponse)
async def terminal_html(request: Request):
    """Serve terminal HTML for web iframe fallback"""
    config = await db.config.find_one({}, {"_id": 0})
    theme_name = config.get("theme", "cyberpunk_void") if config else "cyberpunk_void"

    terminal_themes = {
        "cyberpunk_void": {"background":"#050505","foreground":"#00FF9C","cursor":"#00FF9C","cursorAccent":"#050505","selectionBackground":"rgba(0,255,156,0.3)","black":"#050505","red":"#FF0055","green":"#00FF9C","yellow":"#FFD60A","blue":"#64D2FF","magenta":"#FF79C6","cyan":"#00FFFF","white":"#E0E0E0","brightBlack":"#808080","brightRed":"#FF4488","brightGreen":"#33FFAA","brightYellow":"#FFE033","brightBlue":"#88DDFF","brightMagenta":"#FF99DD","brightCyan":"#33FFFF","brightWhite":"#FFFFFF"},
        "monokai_pro": {"background":"#2D2A2E","foreground":"#FCFCFA","cursor":"#FFD866","cursorAccent":"#2D2A2E","selectionBackground":"rgba(255,216,102,0.3)","black":"#2D2A2E","red":"#FF6188","green":"#A9DC76","yellow":"#FFD866","blue":"#78DCE8","magenta":"#AB9DF2","cyan":"#78DCE8","white":"#FCFCFA","brightBlack":"#727072","brightRed":"#FF6188","brightGreen":"#A9DC76","brightYellow":"#FFD866","brightBlue":"#78DCE8","brightMagenta":"#AB9DF2","brightCyan":"#78DCE8","brightWhite":"#FFFFFF"},
        "dracula": {"background":"#282A36","foreground":"#F8F8F2","cursor":"#BD93F9","cursorAccent":"#282A36","selectionBackground":"rgba(189,147,249,0.3)","black":"#21222C","red":"#FF5555","green":"#50FA7B","yellow":"#F1FA8C","blue":"#BD93F9","magenta":"#FF79C6","cyan":"#8BE9FD","white":"#F8F8F2","brightBlack":"#6272A4","brightRed":"#FF6E6E","brightGreen":"#69FF94","brightYellow":"#FFFFA5","brightBlue":"#D6ACFF","brightMagenta":"#FF92DF","brightCyan":"#A4FFFF","brightWhite":"#FFFFFF"},
    }
    t = terminal_themes.get(theme_name, terminal_themes["cyberpunk_void"])
    bg = t["background"]
    theme_json = json.dumps(t)

    html = f"""<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{width:100%;height:100%;overflow:hidden;background:{bg}}}
#terminal{{width:100%;height:100%}}
.xterm{{padding:4px}}
.xterm-viewport::-webkit-scrollbar{{width:6px}}
.xterm-viewport::-webkit-scrollbar-thumb{{background:#555;border-radius:3px}}
#status{{position:fixed;top:4px;right:8px;color:{t["foreground"]};font-size:11px;font-family:monospace;opacity:0.6;z-index:999}}
</style>
</head><body>
<div id="terminal"></div>
<div id="status">Loading...</div>
<script>
var THEME={theme_json};
var statusEl=document.getElementById('status');
function setStatus(s){{if(statusEl)statusEl.textContent=s}}
function loadScript(url){{
  return new Promise(function(resolve,reject){{
    var s=document.createElement('script');
    s.src=url;s.onload=resolve;s.onerror=reject;
    document.head.appendChild(s);
  }});
}}
function loadCSS(url){{
  var l=document.createElement('link');
  l.rel='stylesheet';l.href=url;
  document.head.appendChild(l);
}}
loadCSS('https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css');
setStatus('Loading xterm...');
loadScript('https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js').then(function(){{
  return loadScript('https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js');
}}).then(function(){{
  setStatus('Initializing...');
  var term=new Terminal({{
    cursorBlink:true,fontSize:14,fontFamily:'Menlo,Monaco,Consolas,monospace',
    theme:THEME,allowProposedApi:true,scrollback:5000,
    rows:24,cols:80
  }});
  var fitAddon=null;
  try{{fitAddon=new FitAddon.FitAddon();term.loadAddon(fitAddon)}}catch(e){{}}
  term.open(document.getElementById('terminal'));
  if(fitAddon)try{{fitAddon.fit()}}catch(e){{}}
  var proto=location.protocol==='https:'?'wss:':'ws:';
  var wsUrl=proto+'//'+location.host+'/api/ws/terminal';
  setStatus('Connecting...');
  var ws;
  function connect(){{
    ws=new WebSocket(wsUrl);
    ws.onopen=function(){{
      setStatus('Connected');
      setTimeout(function(){{if(statusEl)statusEl.style.display='none'}},2000);
      var dims={{rows:term.rows,cols:term.cols}};
      ws.send(JSON.stringify({{type:'resize',rows:dims.rows,cols:dims.cols}}));
    }};
    ws.onmessage=function(e){{term.write(e.data)}};
    ws.onclose=function(){{
      setStatus('Reconnecting...');
      if(statusEl)statusEl.style.display='block';
      term.write('\\r\\n\\x1b[33m[Reconnecting...]\\x1b[0m\\r\\n');
      setTimeout(connect,2000);
    }};
    ws.onerror=function(){{setStatus('Connection error')}};
  }}
  connect();
  term.onData(function(data){{
    if(ws&&ws.readyState===1)ws.send(JSON.stringify({{type:'input',data:data}}));
  }});
  window.addEventListener('resize',function(){{
    if(fitAddon)try{{fitAddon.fit()}}catch(e){{}}
    if(ws&&ws.readyState===1)ws.send(JSON.stringify({{type:'resize',rows:term.rows,cols:term.cols}}));
  }});
  window.addEventListener('message',function(e){{
    try{{
      var msg=JSON.parse(e.data);
      if(msg.type==='write'&&ws&&ws.readyState===1){{
        ws.send(JSON.stringify({{type:'input',data:msg.data}}));
      }}
    }}catch(x){{}}
  }});
}}).catch(function(err){{
  setStatus('Failed to load terminal: '+err);
  document.getElementById('terminal').innerHTML='<pre style="color:{t["foreground"]};padding:20px">Failed to load xterm.js. Check network connection.</pre>';
}});
</script>
</body></html>"""
    return HTMLResponse(content=html)


# ===== WebSocket =====

@app.websocket("/api/ws/terminal")
async def websocket_terminal(websocket: WebSocket):
    await websocket.accept()
    if not terminal._running:
        terminal.start()
        await terminal.start_reading()
        await asyncio.sleep(0.3)

    terminal.clients.add(websocket)
    history = ''.join(terminal.history_buffer)
    if history:
        try:
            await websocket.send_text(history)
        except Exception:
            pass

    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get('type') == 'input':
                    terminal.write(msg['data'])
                elif msg.get('type') == 'resize':
                    terminal.resize(msg.get('rows', 30), msg.get('cols', 120))
            except json.JSONDecodeError:
                terminal.write(data)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        terminal.clients.discard(websocket)


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    logger.info(f"TermuxAI backend starting... (storage: {STORAGE_TYPE})")
    await terminal.restore_session()


@app.on_event("shutdown")
async def shutdown():
    await terminal.save_now()
    terminal.stop()
    if client:
        client.close()
