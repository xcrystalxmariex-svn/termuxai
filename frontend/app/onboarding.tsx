import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, Animated,
  SafeAreaView, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/contexts/ThemeContext';
import { themes, themeKeys } from '../src/constants/themes';
import { getBackendUrl } from '../src/config';

const { width } = Dimensions.get('window');

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', icon: 'logo-electron', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o' },
  { id: 'anthropic', label: 'Anthropic', icon: 'flask', endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-4-20250514' },
  { id: 'google', label: 'Google Gemini', icon: 'diamond', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' },
  { id: 'openai_compatible', label: 'OpenAI Compatible', icon: 'git-network', endpoint: '', model: '' },
  { id: 'generic', label: 'Generic HTTP', icon: 'globe', endpoint: '', model: '' },
];

export default function Onboarding() {
  const router = useRouter();
  const { setThemeName, theme, themeName } = useTheme();
  const [step, setStep] = useState(0);
  const [selectedTheme, setSelectedTheme] = useState(themeName);
  const [provider, setProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState(PROVIDERS[0].endpoint);
  const [model, setModel] = useState(PROVIDERS[0].model);
  const [agentName, setAgentName] = useState('TermuxAI');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const currentTheme = themes[selectedTheme] || theme;

  const selectProvider = (p: typeof PROVIDERS[0]) => {
    setProvider(p.id);
    setEndpoint(p.endpoint);
    setModel(p.model);
  };

  const handleFinish = async () => {
    if (!apiKey.trim()) {
      setError('API Key is required');
      return;
    }
    if (!endpoint.trim()) {
      setError('Endpoint URL is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const backendUrl = getBackendUrl();
      const response = await fetch(`${backendUrl}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          api_key: apiKey,
          endpoint,
          model,
          agent_name: agentName || 'TermuxAI',
          system_prompt: systemPrompt,
          theme: selectedTheme,
          auto_execute: false,
        }),
      });
      if (!response.ok) throw new Error('Failed to save config');
      setThemeName(selectedTheme);
      router.replace('/(tabs)/terminal');
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const renderStep0 = () => (
    <View style={styles.stepContainer}>
      <View style={styles.headerSection}>
        <Ionicons name="terminal" size={56} color={currentTheme.primary} />
        <Text style={[styles.title, { color: currentTheme.text }]}>TermuxAI</Text>
        <Text style={[styles.subtitle, { color: currentTheme.textDim }]}>
          AI-Powered Terminal Environment
        </Text>
      </View>
      <Text style={[styles.sectionTitle, { color: currentTheme.text }]}>Choose Your Theme</Text>
      {themeKeys.map((key) => {
        const t = themes[key];
        const isSelected = selectedTheme === key;
        return (
          <TouchableOpacity
            key={key}
            testID={`theme-${key}`}
            style={[
              styles.themeCard,
              { backgroundColor: t.surface, borderColor: isSelected ? t.primary : t.border },
              isSelected && { borderWidth: 2 },
            ]}
            onPress={() => setSelectedTheme(key)}
          >
            <View style={styles.themePreview}>
              <View style={[styles.colorDot, { backgroundColor: t.primary }]} />
              <View style={[styles.colorDot, { backgroundColor: t.secondary }]} />
              <View style={[styles.colorDot, { backgroundColor: t.success }]} />
              <View style={[styles.colorDot, { backgroundColor: t.info }]} />
              <View style={[styles.colorDot, { backgroundColor: t.warning }]} />
            </View>
            <View style={styles.themeInfo}>
              <Text style={[styles.themeName, { color: t.text }]}>{t.displayName}</Text>
              <Text style={[styles.themeDesc, { color: t.textDim }]}>
                {key === 'cyberpunk_void' ? 'Neon green on black' :
                 key === 'monokai_pro' ? 'Warm and vibrant' : 'Purple twilight'}
              </Text>
            </View>
            {isSelected && <Ionicons name="checkmark-circle" size={24} color={t.primary} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderStep1 = () => (
    <View style={styles.stepContainer}>
      <Text style={[styles.sectionTitle, { color: currentTheme.text }]}>AI Provider</Text>
      <Text style={[styles.hint, { color: currentTheme.textDim }]}>
        Select your AI provider and enter credentials
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.providerScroll}>
        {PROVIDERS.map((p) => (
          <TouchableOpacity
            key={p.id}
            testID={`provider-${p.id}`}
            style={[
              styles.providerChip,
              { backgroundColor: provider === p.id ? currentTheme.primary : currentTheme.surface,
                borderColor: currentTheme.border },
            ]}
            onPress={() => selectProvider(p)}
          >
            <Ionicons
              name={p.icon as any}
              size={16}
              color={provider === p.id ? currentTheme.background : currentTheme.text}
            />
            <Text style={[
              styles.providerLabel,
              { color: provider === p.id ? currentTheme.background : currentTheme.text },
            ]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.inputGroup}>
        <Text style={[styles.label, { color: currentTheme.textDim }]}>API Key *</Text>
        <TextInput
          testID="api-key-input"
          style={[styles.input, { backgroundColor: currentTheme.surfaceHighlight, color: currentTheme.text, borderColor: currentTheme.border }]}
          placeholder="Enter your API key"
          placeholderTextColor={currentTheme.textDim}
          value={apiKey}
          onChangeText={setApiKey}
          secureTextEntry
          autoCapitalize="none"
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={[styles.label, { color: currentTheme.textDim }]}>Endpoint URL *</Text>
        <TextInput
          testID="endpoint-input"
          style={[styles.input, { backgroundColor: currentTheme.surfaceHighlight, color: currentTheme.text, borderColor: currentTheme.border }]}
          placeholder="https://api.example.com/v1/chat"
          placeholderTextColor={currentTheme.textDim}
          value={endpoint}
          onChangeText={setEndpoint}
          autoCapitalize="none"
          keyboardType="url"
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={[styles.label, { color: currentTheme.textDim }]}>Model Name</Text>
        <TextInput
          testID="model-input"
          style={[styles.input, { backgroundColor: currentTheme.surfaceHighlight, color: currentTheme.text, borderColor: currentTheme.border }]}
          placeholder="e.g. gpt-4o"
          placeholderTextColor={currentTheme.textDim}
          value={model}
          onChangeText={setModel}
          autoCapitalize="none"
        />
      </View>
    </View>
  );

  const renderStep2 = () => (
    <View style={styles.stepContainer}>
      <Text style={[styles.sectionTitle, { color: currentTheme.text }]}>Customize Your Agent</Text>
      <Text style={[styles.hint, { color: currentTheme.textDim }]}>
        Give your AI assistant a name and personality (optional)
      </Text>

      <View style={styles.inputGroup}>
        <Text style={[styles.label, { color: currentTheme.textDim }]}>Agent Name</Text>
        <TextInput
          testID="agent-name-input"
          style={[styles.input, { backgroundColor: currentTheme.surfaceHighlight, color: currentTheme.text, borderColor: currentTheme.border }]}
          placeholder="TermuxAI"
          placeholderTextColor={currentTheme.textDim}
          value={agentName}
          onChangeText={setAgentName}
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={[styles.label, { color: currentTheme.textDim }]}>System Prompt</Text>
        <TextInput
          testID="system-prompt-input"
          style={[styles.input, styles.textArea, { backgroundColor: currentTheme.surfaceHighlight, color: currentTheme.text, borderColor: currentTheme.border }]}
          placeholder="Custom instructions for your AI agent..."
          placeholderTextColor={currentTheme.textDim}
          value={systemPrompt}
          onChangeText={setSystemPrompt}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />
      </View>

      {error ? (
        <View style={[styles.errorBox, { backgroundColor: currentTheme.error + '20' }]}>
          <Text style={[styles.errorText, { color: currentTheme.error }]}>{error}</Text>
        </View>
      ) : null}
    </View>
  );

  const steps = [renderStep0, renderStep1, renderStep2];
  const isLast = step === steps.length - 1;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: currentTheme.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        {/* Progress */}
        <View style={styles.progressRow}>
          {steps.map((_, i) => (
            <View
              key={i}
              style={[
                styles.progressDot,
                { backgroundColor: i <= step ? currentTheme.primary : currentTheme.border },
                i <= step && { width: 24 },
              ]}
            />
          ))}
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {steps[step]()}
        </ScrollView>

        {/* Navigation */}
        <View style={[styles.navRow, { borderTopColor: currentTheme.border }]}>
          {step > 0 ? (
            <TouchableOpacity
              testID="back-btn"
              style={[styles.navBtn, { borderColor: currentTheme.border }]}
              onPress={() => setStep(step - 1)}
            >
              <Ionicons name="arrow-back" size={20} color={currentTheme.text} />
              <Text style={[styles.navBtnText, { color: currentTheme.text }]}>Back</Text>
            </TouchableOpacity>
          ) : <View style={styles.navBtn} />}

          <TouchableOpacity
            testID={isLast ? 'finish-setup-btn' : 'next-btn'}
            style={[styles.navBtnPrimary, { backgroundColor: currentTheme.primary }]}
            onPress={isLast ? handleFinish : () => setStep(step + 1)}
            disabled={saving}
          >
            <Text style={[styles.navBtnPrimaryText, { color: currentTheme.background }]}>
              {saving ? 'Saving...' : isLast ? 'Start Building' : 'Next'}
            </Text>
            {!isLast && <Ionicons name="arrow-forward" size={20} color={currentTheme.background} />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  progressDot: {
    height: 4,
    width: 12,
    borderRadius: 2,
  },
  stepContainer: {
    paddingHorizontal: 24,
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: 32,
    marginTop: 16,
  },
  title: {
    fontSize: 36,
    fontWeight: '900',
    marginTop: 12,
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
    letterSpacing: 1,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    marginBottom: 20,
  },
  themeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  themePreview: {
    flexDirection: 'row',
    gap: 4,
    marginRight: 12,
  },
  colorDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  themeInfo: { flex: 1 },
  themeName: { fontSize: 16, fontWeight: '600' },
  themeDesc: { fontSize: 12, marginTop: 2 },
  providerScroll: {
    marginBottom: 20,
  },
  providerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 1,
    gap: 6,
  },
  providerLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  textArea: {
    minHeight: 120,
    paddingTop: 12,
  },
  errorBox: {
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  errorText: {
    fontSize: 14,
    fontWeight: '500',
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
  },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    minWidth: 80,
  },
  navBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  navBtnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    gap: 8,
  },
  navBtnPrimaryText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
