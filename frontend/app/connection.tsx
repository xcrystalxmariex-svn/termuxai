import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  SafeAreaView, ScrollView, Linking, Platform, Clipboard,
  ActivityIndicator, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/contexts/ThemeContext';
import { setBackendUrl, checkBackendHealth, getBackendUrl } from '../src/config';

const DEFAULT_LOCAL_URL = 'http://localhost:8080';
const FDROID_TERMUX = 'https://f-droid.org/en/packages/com.termux/';

// Step 1: Dependencies (handles pydantic rust issue with --only-binary)
const STEP1_DEPS = `pkg update -y && pkg upgrade -y && pkg install -y python tmux curl
pip install --upgrade pip
pip cache purge
pip install --only-binary :all: pydantic
pip install fastapi uvicorn httpx python-dotenv`;

// Step 2: Create directory and files
const STEP2_SETUP = `mkdir -p ~/termuxai/data && cd ~/termuxai

# Create start.sh
cat > start.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
echo "Starting TermuxAI server..."
termux-wake-lock 2>/dev/null || true
tmux kill-session -t termuxai 2>/dev/null || true
cd ~/termuxai
tmux new-session -d -s termuxai 'while true; do python -m uvicorn server:app --host 0.0.0.0 --port 8080; echo "Restarting in 3s..."; sleep 3; done'
echo ""
echo "Server started on http://localhost:8080"
echo "View logs: tmux attach -t termuxai"
echo "Detach from logs: Ctrl+B then D"
EOF
chmod +x start.sh

# Create stop.sh
cat > stop.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
tmux kill-session -t termuxai 2>/dev/null || true
termux-wake-unlock 2>/dev/null || true
echo "Server stopped."
EOF
chmod +x stop.sh

# Create status.sh
cat > status.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
if tmux has-session -t termuxai 2>/dev/null; then
    echo "TermuxAI: RUNNING"
    curl -s http://localhost:8080/api/health 2>/dev/null || echo "API: Starting..."
else
    echo "TermuxAI: STOPPED"
    echo "Start with: cd ~/termuxai && ./start.sh"
fi
EOF
chmod +x status.sh

# Create .env
cat > .env << 'EOF'
STORAGE_TYPE=json
DATA_DIR=/data/data/com.termux/files/home/termuxai/data
DB_NAME=termuxai
EOF

echo "Scripts created! Now paste server.py content."`;

// Step 3: Minimal server.py that works
const STEP3_SERVER = `cd ~/termuxai && cat > server.py << 'PYEOF'
from fastapi import FastAPI, APIRouter
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime, timezone
import json
import os

# JSON file storage
DATA_DIR = Path(os.environ.get('DATA_DIR', Path.home() / 'termuxai' / 'data'))
DATA_DIR.mkdir(parents=True, exist_ok=True)

def read_json(name):
    p = DATA_DIR / f"{name}.json"
    if p.exists():
        try: return json.loads(p.read_text())
        except: return {}
    return {}

def write_json(name, data):
    (DATA_DIR / f"{name}.json").write_text(json.dumps(data, default=str, indent=2))

app = FastAPI()
api = APIRouter(prefix="/api")

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

@api.get("/")
def root():
    return {"message": "TermuxAI API", "version": "1.0.0"}

@api.get("/health")
def health():
    return {"status": "ok", "storage": "json"}

@api.get("/config")
def get_config():
    c = read_json("config")
    if not c:
        return JSONResponse(status_code=404, content={"detail": "No config"})
    c["has_api_key"] = bool(c.get("api_key"))
    return c

@api.post("/config")
def save_config(data: ConfigCreate):
    c = read_json("config") or {}
    now = datetime.now(timezone.utc).isoformat()
    new_data = data.dict()
    if new_data.get("api_key") in ["", "UNCHANGED"]:
        new_data["api_key"] = c.get("api_key", "")
    new_data["updated_at"] = now
    new_data["created_at"] = c.get("created_at", now)
    write_json("config", new_data)
    new_data["has_api_key"] = bool(new_data.get("api_key"))
    return new_data

@api.get("/chat/history")
def get_history():
    return read_json("chat_history") or []

@api.delete("/chat/history")
def clear_history():
    write_json("chat_history", [])
    return {"message": "Cleared"}

@api.post("/chat")
def chat(msg: ChatMessage):
    # Simple echo for now - add AI provider calls as needed
    return {"role": "assistant", "content": f"Received: {msg.content}"}

app.include_router(api)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], allow_credentials=True)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
PYEOF
echo "server.py created!"`;

// Step 4: Start command
const STEP4_START = `cd ~/termuxai && ./start.sh`;

export default function ConnectionScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [mode, setMode] = useState<'local' | 'remote'>('local');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [status, setStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [statusMsg, setStatusMsg] = useState('Checking for backend...');
  const [copied, setCopied] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<number | null>(1);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    startPolling();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [mode, remoteUrl]);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    const url = mode === 'local' ? DEFAULT_LOCAL_URL : remoteUrl;
    if (mode === 'remote' && !remoteUrl) {
      setStatus('disconnected');
      setStatusMsg('Enter a remote server URL');
      return;
    }
    checkConnection(url);
    pollRef.current = setInterval(() => checkConnection(url), 3000);
  };

  const checkConnection = async (url: string) => {
    setStatus('checking');
    setStatusMsg('Checking connection...');
    const ok = await checkBackendHealth(url);
    if (ok) {
      setStatus('connected');
      setStatusMsg('Backend connected!');
      await setBackendUrl(url);
      setTimeout(async () => {
        try {
          const res = await fetch(`${url}/api/config`);
          if (res.ok) {
            const config = await res.json();
            router.replace(config.has_api_key ? '/(tabs)/terminal' : '/onboarding');
          } else {
            router.replace('/onboarding');
          }
        } catch {
          router.replace('/onboarding');
        }
      }, 1000);
    } else {
      setStatus('disconnected');
      setStatusMsg(mode === 'local' ? 'Backend not running. Follow setup steps below.' : 'Cannot reach remote server');
    }
  };

  const connectRemote = () => {
    if (!remoteUrl.trim()) return;
    let url = remoteUrl.trim();
    if (!url.startsWith('http')) url = 'https://' + url;
    setRemoteUrl(url);
    checkConnection(url);
  };

  const copyToClipboard = (text: string, id: string) => {
    if (Platform.OS === 'web') {
      navigator.clipboard?.writeText(text);
    } else {
      Clipboard.setString(text);
    }
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const statusColor = status === 'connected' ? theme.success : status === 'checking' ? theme.warning : theme.error;

  const renderStep = (num: number, title: string, desc: string, code: string, codeId: string) => {
    const isExpanded = expandedStep === num;
    return (
      <View style={styles.step} key={num}>
        <TouchableOpacity
          style={styles.stepHeader}
          onPress={() => setExpandedStep(isExpanded ? null : num)}
        >
          <View style={[styles.stepNum, { backgroundColor: theme.primary }]}>
            <Text style={[styles.stepNumText, { color: theme.background }]}>{num}</Text>
          </View>
          <View style={styles.stepInfo}>
            <Text style={[styles.stepTitle, { color: theme.text }]}>{title}</Text>
            <Text style={[styles.stepDesc, { color: theme.textDim }]} numberOfLines={isExpanded ? undefined : 1}>
              {desc}
            </Text>
          </View>
          <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color={theme.textDim} />
        </TouchableOpacity>

        {isExpanded && (
          <View style={[styles.codeContainer, { backgroundColor: theme.background, borderColor: theme.border }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text style={[styles.codeText, { color: theme.success }]}>{code}</Text>
            </ScrollView>
            <TouchableOpacity
              style={[styles.copyBtn, { backgroundColor: copied === codeId ? theme.success : theme.primary }]}
              onPress={() => copyToClipboard(code, codeId)}
            >
              <Ionicons name={copied === codeId ? 'checkmark' : 'copy'} size={16} color={theme.background} />
              <Text style={[styles.copyBtnText, { color: theme.background }]}>
                {copied === codeId ? 'Copied!' : 'Copy'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.headerSection}>
          <Ionicons name="terminal" size={48} color={theme.primary} />
          <Text style={[styles.title, { color: theme.text }]}>TermuxAI</Text>
          <Text style={[styles.subtitle, { color: theme.textDim }]}>Connect to Backend</Text>
        </View>

        {/* Status */}
        <View style={[styles.statusBar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: theme.text }]}>{statusMsg}</Text>
          {status === 'checking' && <ActivityIndicator size="small" color={theme.primary} />}
        </View>

        {/* Mode Selector */}
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modeBtn, { backgroundColor: mode === 'local' ? theme.primary : theme.surface, borderColor: theme.border }]}
            onPress={() => setMode('local')}
          >
            <Ionicons name="phone-portrait" size={18} color={mode === 'local' ? theme.background : theme.text} />
            <Text style={[styles.modeBtnText, { color: mode === 'local' ? theme.background : theme.text }]}>Local</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, { backgroundColor: mode === 'remote' ? theme.primary : theme.surface, borderColor: theme.border }]}
            onPress={() => setMode('remote')}
          >
            <Ionicons name="cloud" size={18} color={mode === 'remote' ? theme.background : theme.text} />
            <Text style={[styles.modeBtnText, { color: mode === 'remote' ? theme.background : theme.text }]}>Remote</Text>
          </TouchableOpacity>
        </View>

        {mode === 'local' ? (
          <View>
            {/* Install Termux */}
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Prerequisites</Text>
              <Text style={[styles.cardDesc, { color: theme.textDim }]}>
                Install Termux from F-Droid (NOT Play Store - that version is outdated)
              </Text>
              <TouchableOpacity
                style={[styles.linkBtn, { backgroundColor: theme.primary }]}
                onPress={() => Linking.openURL(FDROID_TERMUX)}
              >
                <Ionicons name="download" size={16} color={theme.background} />
                <Text style={[styles.linkBtnText, { color: theme.background }]}>Get Termux from F-Droid</Text>
              </TouchableOpacity>
            </View>

            {/* Setup Steps */}
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Setup Steps</Text>
              <Text style={[styles.cardDesc, { color: theme.textDim }]}>
                Run each step in Termux. Tap to expand and copy.
              </Text>

              {renderStep(1, 'Install Dependencies', 'Python, tmux, and pip packages', STEP1_DEPS, 'step1')}
              {renderStep(2, 'Create Scripts', 'Setup directory and management scripts', STEP2_SETUP, 'step2')}
              {renderStep(3, 'Create Server', 'The FastAPI server code', STEP3_SERVER, 'step3')}
              {renderStep(4, 'Start Server', 'Launch the server', STEP4_START, 'step4')}
            </View>

            {/* Management */}
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Server Commands</Text>
              <View style={styles.cmdRow}>
                <Ionicons name="play-circle" size={16} color={theme.success} />
                <Text style={[styles.cmdText, { color: theme.text }]}>cd ~/termuxai && ./start.sh</Text>
              </View>
              <View style={styles.cmdRow}>
                <Ionicons name="stop-circle" size={16} color={theme.error} />
                <Text style={[styles.cmdText, { color: theme.text }]}>cd ~/termuxai && ./stop.sh</Text>
              </View>
              <View style={styles.cmdRow}>
                <Ionicons name="information-circle" size={16} color={theme.info} />
                <Text style={[styles.cmdText, { color: theme.text }]}>cd ~/termuxai && ./status.sh</Text>
              </View>
              <View style={styles.cmdRow}>
                <Ionicons name="eye" size={16} color={theme.warning} />
                <Text style={[styles.cmdText, { color: theme.text }]}>tmux attach -t termuxai</Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Remote Server</Text>
            <TextInput
              style={[styles.urlInput, { backgroundColor: theme.surfaceHighlight, color: theme.text, borderColor: theme.border }]}
              placeholder="https://your-server.example.com"
              placeholderTextColor={theme.textDim}
              value={remoteUrl}
              onChangeText={setRemoteUrl}
              autoCapitalize="none"
              keyboardType="url"
            />
            <TouchableOpacity style={[styles.connectBtn, { backgroundColor: theme.primary }]} onPress={connectRemote}>
              <Ionicons name="link" size={18} color={theme.background} />
              <Text style={[styles.connectBtnText, { color: theme.background }]}>Connect</Text>
            </TouchableOpacity>
            <View style={[styles.tunnelBox, { backgroundColor: theme.background, borderColor: theme.border }]}>
              <Text style={[styles.tunnelTitle, { color: theme.text }]}>Tunneling Options:</Text>
              <Text style={[styles.tunnelText, { color: theme.textDim }]}>
                {'\u2022'} ngrok: ngrok http 8080{'\n'}
                {'\u2022'} serveo: ssh -R 80:localhost:8080 serveo.net{'\n'}
                {'\u2022'} Cloudflare Tunnel (free)
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  headerSection: { alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 28, fontWeight: '900', marginTop: 8, letterSpacing: 2 },
  subtitle: { fontSize: 14, marginTop: 4 },
  statusBar: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 16, gap: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { flex: 1, fontSize: 14, fontWeight: '500' },
  modeRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  modeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 10, borderWidth: 1, gap: 6 },
  modeBtnText: { fontSize: 14, fontWeight: '700' },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 16 },
  cardTitle: { fontSize: 17, fontWeight: '700', marginBottom: 8 },
  cardDesc: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 8, gap: 8 },
  linkBtnText: { fontSize: 14, fontWeight: '600' },
  step: { marginBottom: 12 },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNum: { width: 26, height: 26, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },
  stepNumText: { fontSize: 13, fontWeight: '800' },
  stepInfo: { flex: 1 },
  stepTitle: { fontSize: 14, fontWeight: '700' },
  stepDesc: { fontSize: 12, marginTop: 2 },
  codeContainer: { marginTop: 10, borderRadius: 8, borderWidth: 1, padding: 12 },
  codeText: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 16 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10, paddingVertical: 10, borderRadius: 6, gap: 6 },
  copyBtnText: { fontSize: 13, fontWeight: '600' },
  cmdRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cmdText: { fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  urlInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginBottom: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  connectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 10, gap: 8, marginBottom: 16 },
  connectBtnText: { fontSize: 15, fontWeight: '700' },
  tunnelBox: { borderRadius: 8, borderWidth: 1, padding: 12 },
  tunnelTitle: { fontSize: 13, fontWeight: '700', marginBottom: 6 },
  tunnelText: { fontSize: 12, lineHeight: 20, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
