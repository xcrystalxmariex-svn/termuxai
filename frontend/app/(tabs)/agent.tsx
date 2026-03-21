import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  FlatList, SafeAreaView, KeyboardAvoidingView, Platform,
  ActivityIndicator, Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/contexts/ThemeContext';
import { getBackendUrl } from '../../src/config';

interface Message {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  executed_commands?: string[] | null;
}

export default function AgentScreen() {
  const { theme } = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${getBackendUrl()}/api/chat/history`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (e) {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    Keyboard.dismiss();

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`${getBackendUrl()}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to get response');
      }
      const data = await res.json();
      setMessages((prev) => [...prev, data]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: `Error: ${e.message}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const executeCommand = async (command: string) => {
    try {
      await fetch(`${getBackendUrl()}/api/terminal/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
    } catch (e) {
      // ignore
    }
  };

  const renderCodeBlock = (code: string, index: number) => (
    <View key={index} style={[styles.codeBlock, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <View style={[styles.codeHeader, { backgroundColor: theme.surfaceHighlight }]}>
        <Text style={[styles.codeHeaderText, { color: theme.textDim }]}>bash</Text>
        <TouchableOpacity
          testID={`execute-cmd-${index}`}
          style={[styles.execBtn, { backgroundColor: theme.primary + '22' }]}
          onPress={() => executeCommand(code)}
        >
          <Ionicons name="play" size={12} color={theme.primary} />
          <Text style={[styles.execBtnText, { color: theme.primary }]}>Run</Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.codeText, { color: theme.success }]}>{code}</Text>
    </View>
  );

  const parseContent = (content: string) => {
    const parts: { type: 'text' | 'code'; content: string }[] = [];
    const regex = /```(?:bash|shell|sh)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: content.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'code', content: match[1].trim() });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
      parts.push({ type: 'text', content: content.slice(lastIndex) });
    }
    return parts;
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    const parts = isUser ? [{ type: 'text' as const, content: item.content }] : parseContent(item.content);

    return (
      <View
        testID={`message-${item.id}`}
        style={[
          styles.messageBubble,
          isUser
            ? [styles.userBubble, { backgroundColor: theme.primary + '18', borderColor: theme.primary + '44' }]
            : [styles.assistantBubble, { backgroundColor: theme.surface, borderColor: theme.border }],
        ]}
      >
        <View style={styles.messageHeader}>
          <Ionicons
            name={isUser ? 'person' : 'hardware-chip'}
            size={14}
            color={isUser ? theme.primary : theme.secondary}
          />
          <Text style={[styles.roleLabel, { color: isUser ? theme.primary : theme.secondary }]}>
            {isUser ? 'You' : 'Agent'}
          </Text>
        </View>
        {parts.map((part, i) =>
          part.type === 'code' ? (
            renderCodeBlock(part.content, i)
          ) : (
            <Text key={i} style={[styles.messageText, { color: theme.text }]}>
              {part.content.trim()}
            </Text>
          )
        )}
        {item.executed_commands && item.executed_commands.length > 0 && (
          <View style={[styles.executedBadge, { backgroundColor: theme.success + '22' }]}>
            <Ionicons name="checkmark-circle" size={12} color={theme.success} />
            <Text style={[styles.executedText, { color: theme.success }]}>
              Auto-executed {item.executed_commands.length} command(s)
            </Text>
          </View>
        )}
      </View>
    );
  };

  const clearHistory = async () => {
    try {
      await fetch(`${getBackendUrl()}/api/chat/history`, { method: 'DELETE' });
      setMessages([]);
    } catch (e) {
      // ignore
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <Ionicons name="chatbubble-ellipses" size={20} color={theme.secondary} />
        <Text style={[styles.headerTitle, { color: theme.text }]}>AI Agent</Text>
        <TouchableOpacity testID="clear-chat-btn" onPress={clearHistory}>
          <Ionicons name="trash-outline" size={20} color={theme.textDim} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {loadingHistory ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="code-slash" size={48} color={theme.border} />
            <Text style={[styles.emptyText, { color: theme.textDim }]}>
              Ask your AI agent to help with coding,{'\n'}debugging, or terminal operations
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
          />
        )}

        {loading && (
          <View style={[styles.typingBar, { backgroundColor: theme.surface }]}>
            <ActivityIndicator size="small" color={theme.secondary} />
            <Text style={[styles.typingText, { color: theme.textDim }]}>Agent is thinking...</Text>
          </View>
        )}

        <View style={[styles.inputRow, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
          <TextInput
            testID="chat-input"
            style={[styles.chatInput, { backgroundColor: theme.surfaceHighlight, color: theme.text, borderColor: theme.border }]}
            placeholder="Ask your agent..."
            placeholderTextColor={theme.textDim}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={4000}
            onSubmitEditing={sendMessage}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            testID="send-message-btn"
            style={[styles.sendBtn, { backgroundColor: input.trim() ? theme.primary : theme.surfaceHighlight }]}
            onPress={sendMessage}
            disabled={!input.trim() || loading}
          >
            <Ionicons name="arrow-up" size={20} color={input.trim() ? theme.background : theme.textDim} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
  messageList: {
    padding: 12,
    paddingBottom: 4,
  },
  messageBubble: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  userBubble: {
    marginLeft: 24,
  },
  assistantBubble: {
    marginRight: 12,
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  roleLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  codeBlock: {
    borderRadius: 8,
    borderWidth: 1,
    marginVertical: 6,
    overflow: 'hidden',
  },
  codeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  codeHeaderText: {
    fontSize: 11,
    fontWeight: '600',
  },
  execBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    gap: 4,
  },
  execBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  codeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    padding: 10,
    lineHeight: 18,
  },
  executedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  executedText: {
    fontSize: 11,
    fontWeight: '600',
  },
  typingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  typingText: {
    fontSize: 13,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 10,
    borderTopWidth: 1,
    gap: 8,
  },
  chatInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    maxHeight: 100,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
