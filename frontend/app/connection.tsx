import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  SafeAreaView, ScrollView, Linking, Platform, Clipboard,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/contexts/ThemeContext';
import { setBackendUrl, checkBackendHealth } from '../src/config';

const DEFAULT_LOCAL_URL = 'http://localhost:8080';
const FDROID_TERMUX = 'https://f-droid.org/en/packages/com.termux/';

const REPO_RAW = "https://raw.githubusercontent.com/xcrystalxmariex-svn/termuxai/fix/termux-compat/backend";

const STEP1_DEPS = `pkg update -y && pkg upgrade -y && pkg install -y python tmux curl
pip install --upgrade pip
pip install fastapi uvicorn httpx python-dotenv pydantic starlette websockets`;

const STEP2_SETUP = `mkdir -p ~/termuxai/data && cd ~/termuxai

cat > start.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock 2>/dev/null || true
tmux kill-session -t termuxai 2>/dev/null || true
cd ~/termuxai
tmux new-session -d -s termuxai 'while true; do python -m uvicorn server:app --host 0.0.0.0 --port 8080; sleep 3; done'
echo "Server started on http://localhost:8080"
EOF
chmod +x start.sh

cat > stop.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
tmux kill-session -t termuxai 2>/dev/null || true
termux-wake-unlock 2>/dev/null || true
EOF
chmod +x stop.sh

cat > .env << 'EOF'
STORAGE_TYPE=json
DATA_DIR=/data/data/com.termux/files/home/termuxai/data
EOF`;

const STEP3_SERVER = `cd ~/termuxai
curl -sSL ${REPO_RAW}/server.py -o server.py
curl -sSL ${REPO_RAW}/requirements.txt -o requirements.txt
echo "Downloaded latest server.py from GitHub!"`;

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
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
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
    const ok = await checkBackendHealth(url);
    if (ok) {
      setStatus('connected');
      setStatusMsg('Backend connected!');
      await setBackendUrl(url);
      setTimeout(() => router.replace('/onboarding'), 1000);
    } else {
      setStatus('disconnected');
      setStatusMsg(mode === 'local' ? 'Backend not running. Follow setup steps below.' : 'Cannot reach remote server');
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    if (Platform.OS === 'web') navigator.clipboard?.writeText(text);
    else Clipboard.setString(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const renderStep = (num: number, title: string, desc: string, code: string, codeId: string) => {
    const isExpanded = expandedStep === num;
    return (
      <View style={styles.step} key={num}>
        <TouchableOpacity style={styles.stepHeader} onPress={() => setExpandedStep(isExpanded ? null : num)}>
          <View style={[styles.stepNum, { backgroundColor: theme.primary }]}><Text style={{ color: theme.background }}>{num}</Text></View>
          <View style={{ flex: 1 }}><Text style={{ color: theme.text, fontWeight: '700' }}>{title}</Text></View>
          <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color={theme.textDim} />
        </TouchableOpacity>
        {isExpanded && (
          <View style={[styles.codeContainer, { backgroundColor: theme.background, borderColor: theme.border }]}>
            <ScrollView horizontal><Text style={{ color: theme.success, fontSize: 11 }}>{code}</Text></ScrollView>
            <TouchableOpacity style={[styles.copyBtn, { backgroundColor: theme.primary }]} onPress={() => copyToClipboard(code, codeId)}>
              <Text style={{ color: theme.background }}>{copied === codeId ? 'Copied!' : 'Copy'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={{ fontSize: 24, color: theme.text, fontWeight: 'bold', textAlign: 'center' }}>TermuxAI Setup</Text>
        <View style={{ padding: 12, marginVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border }}>
          <Text style={{ color: status === 'connected' ? theme.success : theme.error }}>{statusMsg}</Text>
        </View>
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          {renderStep(1, 'Install Deps', 'Python & packages', STEP1_DEPS, 's1')}
          {renderStep(2, 'Scripts', 'Start/Stop scripts', STEP2_SETUP, 's2')}
          {renderStep(3, 'Download Server', 'Pull latest from GitHub', STEP3_SERVER, 's3')}
          {renderStep(4, 'Launch', 'Run start.sh', STEP4_START, 's4')}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 16, marginBottom: 16 },
  step: { marginBottom: 12 },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNum: { width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  codeContainer: { marginTop: 8, padding: 10, borderRadius: 8, borderWidth: 1 },
  copyBtn: { marginTop: 8, padding: 8, borderRadius: 6, alignItems: 'center' },
});
