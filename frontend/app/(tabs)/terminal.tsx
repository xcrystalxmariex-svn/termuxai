import React, { useRef, useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/contexts/ThemeContext';
import { getBackendUrl } from '../../src/config';

const SPECIAL_KEYS = [
  { label: 'ESC', data: '\x1b', isModifier: false },
  { label: 'TAB', data: '\t', isModifier: false },
  { label: 'CTRL', data: null, isModifier: true },
  { label: '|', data: '|', isModifier: false },
  { label: '/', data: '/', isModifier: false },
  { label: '-', data: '-', isModifier: false },
  { label: '~', data: '~', isModifier: false },
];

const ARROW_KEYS = [
  { label: '\u2191', data: '\x1b[A' },
  { label: '\u2193', data: '\x1b[B' },
  { label: '\u2190', data: '\x1b[D' },
  { label: '\u2192', data: '\x1b[C' },
];

const CTRL_SHORTCUTS = [
  { label: 'C', data: '\x03' },
  { label: 'D', data: '\x04' },
  { label: 'Z', data: '\x1a' },
  { label: 'L', data: '\x0c' },
  { label: 'A', data: '\x01' },
  { label: 'E', data: '\x05' },
];

function WebTerminal() {
  const { theme } = useTheme();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const backendUrl = getBackendUrl();
  const terminalUrl = `${backendUrl}/api/terminal-html?t=${Date.now()}`;

  return (
    <View style={styles.terminalContainer}>
      <iframe
        ref={iframeRef as any}
        src={terminalUrl}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          backgroundColor: theme.terminal.background,
        } as any}
        allow="clipboard-read; clipboard-write"
      />
    </View>
  );
}

function NativeTerminal() {
  const { theme } = useTheme();
  const webViewRef = useRef<any>(null);
  const backendUrl = getBackendUrl();

  // Dynamic import for native only
  const [WebViewComponent, setWebViewComponent] = useState<any>(null);

  useEffect(() => {
    try {
      const { WebView } = require('react-native-webview');
      setWebViewComponent(() => WebView);
    } catch (e) {
      // WebView not available
    }
  }, []);

  const wsUrl = backendUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/api/ws/terminal';

  const terminalHtml = `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:${theme.terminal.background}}
#terminal{width:100%;height:100%}
.xterm{padding:4px}
.xterm-viewport::-webkit-scrollbar{width:6px}
.xterm-viewport::-webkit-scrollbar-thumb{background:${theme.border};border-radius:3px}
</style>
</head><body>
<div id="terminal"></div>
<script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js"><\/script>
<script>
var term=new Terminal({
  cursorBlink:true,fontSize:14,fontFamily:'monospace',
  theme:${JSON.stringify(theme.terminal)},
  allowProposedApi:true,scrollback:5000
});
var fitAddon=new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal'));
fitAddon.fit();
var ws;
function connect(){
  ws=new WebSocket('${wsUrl}');
  ws.onopen=function(){
    ws.send(JSON.stringify({type:'resize',rows:term.rows,cols:term.cols}));
  };
  ws.onmessage=function(e){term.write(e.data)};
  ws.onclose=function(){
    term.write('\\r\\n\\x1b[33m[Reconnecting...]\\x1b[0m\\r\\n');
    setTimeout(connect,2000);
  };
  ws.onerror=function(){};
}
connect();
term.onData(function(data){
  if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'input',data:data}));
});
window.addEventListener('resize',function(){
  fitAddon.fit();
  if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'resize',rows:term.rows,cols:term.cols}));
});
document.addEventListener('message',function(e){
  try{
    var msg=JSON.parse(e.data);
    if(msg.type==='write'&&ws&&ws.readyState===1){
      ws.send(JSON.stringify({type:'input',data:msg.data}));
    }
  }catch(x){}
});
window.addEventListener('message',function(e){
  try{
    var msg=JSON.parse(e.data);
    if(msg.type==='write'&&ws&&ws.readyState===1){
      ws.send(JSON.stringify({type:'input',data:msg.data}));
    }
  }catch(x){}
});
<\/script>
</body></html>`;

  if (!WebViewComponent) {
    return (
      <View style={[styles.terminalContainer, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: theme.textDim, fontSize: 14 }}>Loading terminal...</Text>
      </View>
    );
  }

  return (
    <View style={styles.terminalContainer}>
      <WebViewComponent
        ref={webViewRef}
        testID="terminal-webview"
        source={{ html: terminalHtml }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        originWhitelist={['*']}
        style={[styles.webview, { backgroundColor: theme.terminal.background }]}
        scrollEnabled={false}
        bounces={false}
        mixedContentMode="always"
      />
    </View>
  );
}

export default function TerminalScreen() {
  const { theme } = useTheme();
  const [ctrlMode, setCtrlMode] = useState(false);
  const iframeRef = useRef<any>(null);
  const isWeb = Platform.OS === 'web';

  const sendToTerminal = useCallback((data: string) => {
    if (isWeb) {
      // Post message to iframe
      try {
        const iframe = document.querySelector('iframe');
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage(JSON.stringify({ type: 'write', data }), '*');
        }
      } catch (e) {
        // ignore
      }
    }
  }, [isWeb]);

  const handleKeyPress = (key: typeof SPECIAL_KEYS[0]) => {
    if (key.isModifier) {
      setCtrlMode(!ctrlMode);
      return;
    }
    if (key.data) {
      sendToTerminal(key.data);
    }
  };

  const handleCtrlKey = (key: typeof CTRL_SHORTCUTS[0]) => {
    sendToTerminal(key.data);
    setCtrlMode(false);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <Ionicons name="terminal" size={20} color={theme.primary} />
        <Text style={[styles.headerTitle, { color: theme.text }]}>Terminal</Text>
        <View style={[styles.statusDot, { backgroundColor: theme.success }]} />
      </View>

      {isWeb ? <WebTerminal /> : <NativeTerminal />}

      {/* Special Keys Toolbar */}
      {ctrlMode ? (
        <View style={[styles.toolbar, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
          <Text style={[styles.ctrlLabel, { color: theme.primary }]}>CTRL+</Text>
          {CTRL_SHORTCUTS.map((k) => (
            <TouchableOpacity
              key={k.label}
              testID={`ctrl-${k.label.toLowerCase()}-btn`}
              style={[styles.keyBtn, { backgroundColor: theme.surfaceHighlight }]}
              onPress={() => handleCtrlKey(k)}
            >
              <Text style={[styles.keyText, { color: theme.primary }]}>{k.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            testID="ctrl-cancel-btn"
            style={[styles.keyBtn, { backgroundColor: theme.error + '33' }]}
            onPress={() => setCtrlMode(false)}
          >
            <Ionicons name="close" size={16} color={theme.error} />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.toolbar, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
          {SPECIAL_KEYS.map((k, i) => (
            <TouchableOpacity
              key={i}
              testID={`key-${k.label.toLowerCase()}-btn`}
              style={[
                styles.keyBtn,
                { backgroundColor: k.isModifier ? theme.primary + '22' : theme.surfaceHighlight },
              ]}
              onPress={() => handleKeyPress(k)}
            >
              <Text style={[styles.keyText, { color: k.isModifier ? theme.primary : theme.text }]}>
                {k.label}
              </Text>
            </TouchableOpacity>
          ))}
          <View style={styles.arrowGroup}>
            {ARROW_KEYS.map((k, i) => (
              <TouchableOpacity
                key={i}
                testID={`arrow-${i}-btn`}
                style={[styles.arrowBtn, { backgroundColor: theme.surfaceHighlight }]}
                onPress={() => sendToTerminal(k.data)}
              >
                <Text style={[styles.keyText, { color: theme.text }]}>{k.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    letterSpacing: 0.5,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  terminalContainer: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderTopWidth: 1,
    gap: 4,
  },
  ctrlLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginRight: 4,
  },
  keyBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 36,
    alignItems: 'center',
  },
  keyText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  arrowGroup: {
    flexDirection: 'row',
    gap: 2,
    marginLeft: 'auto',
  },
  arrowBtn: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 32,
    alignItems: 'center',
  },
});
