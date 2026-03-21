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

// Full embedded setup script - no curl required!
const SETUP_SCRIPT = `#!/data/data/com.termux/files/usr/bin/bash
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

# Step 4: Download server.py from GitHub (or paste manually)
echo "[4/5] Creating server file..."
cat > server.py << 'SERVEREOF'
# TermuxAI Server - Paste the full server.py content here
# Or download from: https://raw.githubusercontent.com/YOUR_REPO/main/backend/server.py
from fastapi import FastAPI
app = FastAPI()

@app.get("/api/")
def root():
    return {"message": "TermuxAI API", "version": "1.0.0"}

@app.get("/api/health")
def health():
    return {"status": "ok"}
SERVEREOF

# Create .env for local JSON storage
cat > .env << 'ENVEOF'
STORAGE_TYPE=json
DATA_DIR=/data/data/com.termux/files/home/termuxai/data
DB_NAME=termuxai
ENVEOF

# Step 5: Create management scripts
echo "[5/5] Creating management scripts..."

# Start script
cat > start.sh << 'STARTEOF'
#!/data/data/com.termux/files/usr/bin/bash
echo "Starting TermuxAI server..."
termux-wake-lock 2>/dev/null || true
tmux kill-session -t termuxai 2>/dev/null || true
tmux new-session -d -s termuxai "cd ~/termuxai && while true; do python -m uvicorn server:app --host 0.0.0.0 --port 8080 --reload; sleep 3; done"
echo "Server started! URL: http://localhost:8080"
echo "View logs: tmux attach -t termuxai"
STARTEOF
chmod +x start.sh

# Stop script
cat > stop.sh << 'STOPEOF'
#!/data/data/com.termux/files/usr/bin/bash
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
    curl -s http://localhost:8080/api/ 2>/dev/null && echo "API: OK" || echo "API: Starting..."
else
    echo "TermuxAI: STOPPED - Run ./start.sh"
fi
STATUSEOF
chmod +x status.sh

echo ""
echo "======================================"
echo "  Setup Complete!"
echo "======================================"
echo ""
echo "Commands:"
echo "  cd ~/termuxai && ./start.sh  # Start server"
echo "  cd ~/termuxai && ./stop.sh   # Stop server"
echo "  cd ~/termuxai && ./status.sh # Check status"
echo ""
./start.sh`;

// Simpler quick start command for users who have packages installed
const QUICK_START = `pkg install -y python tmux && pip install fastapi uvicorn httpx python-dotenv && mkdir -p ~/termuxai && cd ~/termuxai`;

export default function ConnectionScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [mode, setMode] = useState<'local' | 'remote'>('local');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [status, setStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [statusMsg, setStatusMsg] = useState('Checking for backend...');
  const [copied, setCopied] = useState<string | null>(null);
  const [showFullScript, setShowFullScript] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isWeb = Platform.OS === 'web';

  useEffect(() => {
    startPolling();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [mode]);

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
            if (config.has_api_key) {
              router.replace('/(tabs)/terminal');
            } else {
              router.replace('/onboarding');
            }
          } else {
            router.replace('/onboarding');
          }
        } catch {
          router.replace('/onboarding');
        }
      }, 1000);
    } else {
      setStatus('disconnected');
      setStatusMsg(mode === 'local'
        ? 'Backend not running on this device'
        : 'Cannot reach remote server');
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

  const statusColor = status === 'connected' ? theme.success
    : status === 'checking' ? theme.warning : theme.error;

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
            testID="mode-local-btn"
            style={[styles.modeBtn, {
              backgroundColor: mode === 'local' ? theme.primary : theme.surface,
              borderColor: theme.border,
            }]}
            onPress={() => setMode('local')}
          >
            <Ionicons name="phone-portrait" size={18} color={mode === 'local' ? theme.background : theme.text} />
            <Text style={[styles.modeBtnText, { color: mode === 'local' ? theme.background : theme.text }]}>
              Local Device
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="mode-remote-btn"
            style={[styles.modeBtn, {
              backgroundColor: mode === 'remote' ? theme.primary : theme.surface,
              borderColor: theme.border,
            }]}
            onPress={() => setMode('remote')}
          >
            <Ionicons name="cloud" size={18} color={mode === 'remote' ? theme.background : theme.text} />
            <Text style={[styles.modeBtnText, { color: mode === 'remote' ? theme.background : theme.text }]}>
              Remote Server
            </Text>
          </TouchableOpacity>
        </View>

        {mode === 'local' ? (
          <View>
            {/* Local Setup Instructions */}
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Setup Instructions</Text>

              {/* Step 1 */}
              <View style={styles.step}>
                <View style={[styles.stepNum, { backgroundColor: theme.primary }]}>
                  <Text style={[styles.stepNumText, { color: theme.background }]}>1</Text>
                </View>
                <View style={styles.stepContent}>
                  <Text style={[styles.stepTitle, { color: theme.text }]}>Install Termux</Text>
                  <Text style={[styles.stepDesc, { color: theme.textDim }]}>
                    Get Termux from F-Droid (NOT Play Store - that version is outdated)
                  </Text>
                  <TouchableOpacity
                    testID="install-termux-btn"
                    style={[styles.linkBtn, { backgroundColor: theme.primary + '22' }]}
                    onPress={() => Linking.openURL(FDROID_TERMUX)}
                  >
                    <Ionicons name="download" size={16} color={theme.primary} />
                    <Text style={[styles.linkBtnText, { color: theme.primary }]}>Get Termux from F-Droid</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Step 2 */}
              <View style={styles.step}>
                <View style={[styles.stepNum, { backgroundColor: theme.primary }]}>
                  <Text style={[styles.stepNumText, { color: theme.background }]}>2</Text>
                </View>
                <View style={styles.stepContent}>
                  <Text style={[styles.stepTitle, { color: theme.text }]}>Install Dependencies</Text>
                  <Text style={[styles.stepDesc, { color: theme.textDim }]}>
                    Open Termux and run this command:
                  </Text>
                  <View style={[styles.codeBox, { backgroundColor: theme.background, borderColor: theme.border }]}>
                    <Text style={[styles.codeText, { color: theme.success }]} numberOfLines={3}>
                      {QUICK_START}
                    </Text>
                    <TouchableOpacity
                      testID="copy-deps-btn"
                      style={[styles.copyBtn, { backgroundColor: copied === 'deps' ? theme.success : theme.primary }]}
                      onPress={() => copyToClipboard(QUICK_START, 'deps')}
                    >
                      <Ionicons name={copied === 'deps' ? 'checkmark' : 'copy'} size={16} color={theme.background} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* Step 3 */}
              <View style={styles.step}>
                <View style={[styles.stepNum, { backgroundColor: theme.primary }]}>
                  <Text style={[styles.stepNumText, { color: theme.background }]}>3</Text>
                </View>
                <View style={styles.stepContent}>
                  <Text style={[styles.stepTitle, { color: theme.text }]}>Get Setup Script</Text>
                  <Text style={[styles.stepDesc, { color: theme.textDim }]}>
                    Copy the full setup script and paste it into Termux:
                  </Text>
                  <TouchableOpacity
                    testID="view-script-btn"
                    style={[styles.actionBtn, { backgroundColor: theme.info + '22', borderColor: theme.info }]}
                    onPress={() => setShowFullScript(true)}
                  >
                    <Ionicons name="code-slash" size={16} color={theme.info} />
                    <Text style={[styles.actionBtnText, { color: theme.info }]}>View Full Setup Script</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID="copy-script-btn"
                    style={[styles.actionBtn, { backgroundColor: copied === 'script' ? theme.success + '22' : theme.primary + '22', borderColor: copied === 'script' ? theme.success : theme.primary }]}
                    onPress={() => copyToClipboard(SETUP_SCRIPT, 'script')}
                  >
                    <Ionicons name={copied === 'script' ? 'checkmark' : 'copy'} size={16} color={copied === 'script' ? theme.success : theme.primary} />
                    <Text style={[styles.actionBtnText, { color: copied === 'script' ? theme.success : theme.primary }]}>
                      {copied === 'script' ? 'Copied!' : 'Copy Full Script'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Step 4 */}
              <View style={styles.step}>
                <View style={[styles.stepNum, { backgroundColor: theme.primary }]}>
                  <Text style={[styles.stepNumText, { color: theme.background }]}>4</Text>
                </View>
                <View style={styles.stepContent}>
                  <Text style={[styles.stepTitle, { color: theme.text }]}>Wait for Connection</Text>
                  <Text style={[styles.stepDesc, { color: theme.textDim }]}>
                    This screen auto-detects when the server starts on port 8080. You'll be redirected automatically.
                  </Text>
                </View>
              </View>
            </View>

            {/* Management Info */}
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Server Management</Text>
              <View style={styles.mgmtRow}>
                <Ionicons name="play-circle" size={16} color={theme.success} />
                <Text style={[styles.mgmtText, { color: theme.textDim }]}>
                  Start: <Text style={{ color: theme.text }}>cd ~/termuxai && ./start.sh</Text>
                </Text>
              </View>
              <View style={styles.mgmtRow}>
                <Ionicons name="stop-circle" size={16} color={theme.error} />
                <Text style={[styles.mgmtText, { color: theme.textDim }]}>
                  Stop: <Text style={{ color: theme.text }}>cd ~/termuxai && ./stop.sh</Text>
                </Text>
              </View>
              <View style={styles.mgmtRow}>
                <Ionicons name="information-circle" size={16} color={theme.info} />
                <Text style={[styles.mgmtText, { color: theme.textDim }]}>
                  Status: <Text style={{ color: theme.text }}>cd ~/termuxai && ./status.sh</Text>
                </Text>
              </View>
              <View style={styles.mgmtRow}>
                <Ionicons name="layers" size={16} color={theme.warning} />
                <Text style={[styles.mgmtText, { color: theme.textDim }]}>
                  Logs: <Text style={{ color: theme.text }}>tmux attach -t termuxai</Text>
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <View>
            {/* Remote Mode */}
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Remote Server</Text>
              <Text style={[styles.stepDesc, { color: theme.textDim, marginBottom: 12 }]}>
                Connect to a backend running on another device via Cloudflare Tunnel, serveo, ngrok, or a cloud server.
              </Text>
              <TextInput
                testID="remote-url-input"
                style={[styles.urlInput, { backgroundColor: theme.surfaceHighlight, color: theme.text, borderColor: theme.border }]}
                placeholder="https://your-server.example.com"
                placeholderTextColor={theme.textDim}
                value={remoteUrl}
                onChangeText={setRemoteUrl}
                autoCapitalize="none"
                keyboardType="url"
              />
              <TouchableOpacity
                testID="connect-remote-btn"
                style={[styles.connectBtn, { backgroundColor: theme.primary }]}
                onPress={connectRemote}
              >
                <Ionicons name="link" size={18} color={theme.background} />
                <Text style={[styles.connectBtnText, { color: theme.background }]}>Connect</Text>
              </TouchableOpacity>

              <View style={[styles.tunnelInfo, { backgroundColor: theme.background, borderColor: theme.border }]}>
                <Text style={[styles.tunnelTitle, { color: theme.text }]}>Tunneling Options:</Text>
                <Text style={[styles.tunnelText, { color: theme.textDim }]}>
                  {'\u2022'} Cloudflare Tunnel (free, permanent){'\n'}
                  {'\u2022'} serveo.net: ssh -R 80:localhost:8080 serveo.net{'\n'}
                  {'\u2022'} ngrok: ngrok http 8080{'\n'}
                  {'\u2022'} localtunnel: lt --port 8080
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Full Script Modal */}
      <Modal
        visible={showFullScript}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowFullScript(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.8)' }]}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Setup Script</Text>
              <TouchableOpacity onPress={() => setShowFullScript(false)}>
                <Ionicons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.scriptScroll}>
              <Text style={[styles.scriptText, { color: theme.success }]}>{SETUP_SCRIPT}</Text>
            </ScrollView>
            <TouchableOpacity
              style={[styles.modalCopyBtn, { backgroundColor: theme.primary }]}
              onPress={() => {
                copyToClipboard(SETUP_SCRIPT, 'modal');
                setTimeout(() => setShowFullScript(false), 500);
              }}
            >
              <Ionicons name="copy" size={18} color={theme.background} />
              <Text style={[styles.modalCopyBtnText, { color: theme.background }]}>Copy Script</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  headerSection: { alignItems: 'center', marginBottom: 24 },
  title: { fontSize: 32, fontWeight: '900', marginTop: 8, letterSpacing: 2 },
  subtitle: { fontSize: 14, marginTop: 4 },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 20,
    gap: 10,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { flex: 1, fontSize: 14, fontWeight: '500' },
  modeRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  modeBtnText: { fontSize: 14, fontWeight: '700' },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  step: { flexDirection: 'row', marginBottom: 20, gap: 12 },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  stepNumText: { fontSize: 14, fontWeight: '800' },
  stepContent: { flex: 1 },
  stepTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  stepDesc: { fontSize: 13, lineHeight: 18 },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    gap: 6,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  linkBtnText: { fontSize: 13, fontWeight: '600' },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    gap: 8,
  },
  codeText: {
    flex: 1,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
  },
  copyBtn: {
    padding: 8,
    borderRadius: 6,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    marginTop: 8,
  },
  actionBtnText: { fontSize: 13, fontWeight: '600' },
  mgmtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  mgmtText: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flex: 1,
  },
  urlInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    marginBottom: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  connectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
    marginBottom: 16,
  },
  connectBtnText: { fontSize: 15, fontWeight: '700' },
  tunnelInfo: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  tunnelTitle: { fontSize: 13, fontWeight: '700', marginBottom: 6 },
  tunnelText: {
    fontSize: 12,
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    borderRadius: 16,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  scriptScroll: {
    padding: 16,
    maxHeight: 400,
  },
  scriptText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
  },
  modalCopyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 8,
    margin: 16,
    marginTop: 0,
    borderRadius: 10,
  },
  modalCopyBtnText: { fontSize: 15, fontWeight: '700' },
});
