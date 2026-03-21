import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, SafeAreaView, Switch, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/contexts/ThemeContext';
import { themes, themeKeys } from '../../src/constants/themes';
import { getBackendUrl } from '../../src/config';

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o' },
  { id: 'anthropic', label: 'Anthropic', endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-4-20250514' },
  { id: 'google', label: 'Google Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' },
  { id: 'openai_compatible', label: 'OpenAI Compatible', endpoint: '', model: '' },
  { id: 'generic', label: 'Generic HTTP', endpoint: '', model: '' },
];

export default function SettingsScreen() {
  const { theme, themeName, setThemeName } = useTheme();
  const router = useRouter();
  const [config, setConfig] = useState<any>(null);
  const [provider, setProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [agentName, setAgentName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [autoExecute, setAutoExecute] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const res = await fetch(`${getBackendUrl()}/api/config`);
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        setProvider(data.provider || 'openai');
        setEndpoint(data.endpoint || '');
        setModel(data.model || '');
        setAgentName(data.agent_name || 'TermuxAI');
        setSystemPrompt(data.system_prompt || '');
        setAutoExecute(data.auto_execute || false);
      }
    } catch (e) {
      // ignore
    }
  };

  const selectProvider = (p: typeof PROVIDERS[0]) => {
    setProvider(p.id);
    if (p.endpoint) setEndpoint(p.endpoint);
    if (p.model) setModel(p.model);
    setDirty(true);
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const body: any = {
        provider,
        api_key: apiKey || '',
        endpoint,
        model,
        agent_name: agentName || 'TermuxAI',
        system_prompt: systemPrompt,
        theme: themeName,
        auto_execute: autoExecute,
      };
      const res = await fetch(`${getBackendUrl()}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Save failed');
      setDirty(false);
      setApiKey('');
      Alert.alert('Saved', 'Configuration updated successfully');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleThemeChange = (name: string) => {
    setThemeName(name);
    setDirty(true);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <Ionicons name="settings-sharp" size={20} color={theme.info} />
        <Text style={[styles.headerTitle, { color: theme.text }]}>Settings</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Theme Section */}
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Theme</Text>
          <View style={styles.themeRow}>
            {themeKeys.map((key) => {
              const t = themes[key];
              const isSelected = themeName === key;
              return (
                <TouchableOpacity
                  key={key}
                  testID={`settings-theme-${key}`}
                  style={[
                    styles.themeOption,
                    { backgroundColor: t.surface, borderColor: isSelected ? t.primary : t.border },
                    isSelected && { borderWidth: 2 },
                  ]}
                  onPress={() => handleThemeChange(key)}
                >
                  <View style={[styles.themeCircle, { backgroundColor: t.primary }]} />
                  <Text style={[styles.themeLabel, { color: t.text }]} numberOfLines={1}>
                    {t.displayName}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* AI Provider */}
          <Text style={[styles.sectionTitle, { color: theme.text }]}>AI Provider</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {PROVIDERS.map((p) => (
              <TouchableOpacity
                key={p.id}
                testID={`settings-provider-${p.id}`}
                style={[
                  styles.chip,
                  { backgroundColor: provider === p.id ? theme.primary : theme.surface, borderColor: theme.border },
                ]}
                onPress={() => selectProvider(p)}
              >
                <Text style={[styles.chipText, { color: provider === p.id ? theme.background : theme.text }]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: theme.textDim }]}>API Key</Text>
            <TextInput
              testID="settings-api-key"
              style={[styles.input, { backgroundColor: theme.surfaceHighlight, color: theme.text, borderColor: theme.border }]}
              placeholder={config?.has_api_key ? '••••••• (saved)' : 'Enter API key'}
              placeholderTextColor={theme.textDim}
              value={apiKey}
              onChangeText={(t) => { setApiKey(t); setDirty(true); }}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: theme.textDim }]}>Endpoint</Text>
            <TextInput
              testID="settings-endpoint"
              style={[styles.input, { backgroundColor: theme.surfaceHighlight, color: theme.text, borderColor: theme.border }]}
              placeholder="https://..."
              placeholderTextColor={theme.textDim}
              value={endpoint}
              onChangeText={(t) => { setEndpoint(t); setDirty(true); }}
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: theme.textDim }]}>Model</Text>
            <TextInput
              testID="settings-model"
              style={[styles.input, { backgroundColor: theme.surfaceHighlight, color: theme.text, borderColor: theme.border }]}
              placeholder="gpt-4o"
              placeholderTextColor={theme.textDim}
              value={model}
              onChangeText={(t) => { setModel(t); setDirty(true); }}
              autoCapitalize="none"
            />
          </View>

          {/* Agent */}
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Agent</Text>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: theme.textDim }]}>Name</Text>
            <TextInput
              testID="settings-agent-name"
              style={[styles.input, { backgroundColor: theme.surfaceHighlight, color: theme.text, borderColor: theme.border }]}
              placeholder="TermuxAI"
              placeholderTextColor={theme.textDim}
              value={agentName}
              onChangeText={(t) => { setAgentName(t); setDirty(true); }}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: theme.textDim }]}>System Prompt</Text>
            <TextInput
              testID="settings-system-prompt"
              style={[styles.input, styles.textArea, { backgroundColor: theme.surfaceHighlight, color: theme.text, borderColor: theme.border }]}
              placeholder="Custom instructions..."
              placeholderTextColor={theme.textDim}
              value={systemPrompt}
              onChangeText={(t) => { setSystemPrompt(t); setDirty(true); }}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>

          {/* Auto Execute */}
          <View style={[styles.switchRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.switchInfo}>
              <Text style={[styles.switchLabel, { color: theme.text }]}>Auto-Execute Commands</Text>
              <Text style={[styles.switchHint, { color: theme.textDim }]}>
                AI will run terminal commands automatically
              </Text>
            </View>
            <Switch
              testID="auto-execute-switch"
              value={autoExecute}
              onValueChange={(v) => { setAutoExecute(v); setDirty(true); }}
              trackColor={{ false: theme.border, true: theme.primary + '88' }}
              thumbColor={autoExecute ? theme.primary : theme.textDim}
            />
          </View>

          {/* Save */}
          <TouchableOpacity
            testID="save-settings-btn"
            style={[styles.saveBtn, { backgroundColor: theme.primary, opacity: dirty || apiKey ? 1 : 0.5 }]}
            onPress={saveConfig}
            disabled={saving}
          >
            <Text style={[styles.saveBtnText, { color: theme.background }]}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Text>
          </TouchableOpacity>

          <View style={styles.spacer} />
        </ScrollView>
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
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    marginTop: 16,
  },
  themeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  themeOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  themeCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  themeLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  chipScroll: {
    marginBottom: 16,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  inputGroup: {
    marginBottom: 14,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  textArea: {
    minHeight: 80,
    paddingTop: 11,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginVertical: 12,
  },
  switchInfo: {
    flex: 1,
  },
  switchLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  switchHint: {
    fontSize: 12,
    marginTop: 2,
  },
  saveBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 16,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  spacer: {
    height: 40,
  },
});
