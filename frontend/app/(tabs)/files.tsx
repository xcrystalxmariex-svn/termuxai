import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  SafeAreaView, TextInput, ActivityIndicator, ScrollView,
  KeyboardAvoidingView, Platform, Alert, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/contexts/ThemeContext';
import { getBackendUrl } from '../../src/config';

interface FileItem {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;
  modified: string;
}

interface FileContent {
  path: string;
  name: string;
  content: string;
  language: string;
  size: number;
}

const FILE_ICONS: Record<string, { icon: string; color: string }> = {
  py: { icon: 'logo-python', color: '#3776AB' },
  js: { icon: 'logo-javascript', color: '#F7DF1E' },
  ts: { icon: 'code-slash', color: '#3178C6' },
  tsx: { icon: 'code-slash', color: '#3178C6' },
  json: { icon: 'document-text', color: '#FFD866' },
  md: { icon: 'document-text', color: '#FFFFFF' },
  html: { icon: 'logo-html5', color: '#E34F26' },
  css: { icon: 'color-palette', color: '#1572B6' },
  sh: { icon: 'terminal', color: '#4EAA25' },
  txt: { icon: 'document', color: '#CCCCCC' },
  env: { icon: 'key', color: '#FFD866' },
  yml: { icon: 'settings', color: '#CB171E' },
  yaml: { icon: 'settings', color: '#CB171E' },
  default: { icon: 'document-outline', color: '#AAAAAA' },
};

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return FILE_ICONS[ext] || FILE_ICONS.default;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FilesScreen() {
  const { theme } = useTheme();
  const [currentPath, setCurrentPath] = useState('/app');
  const [parentPath, setParentPath] = useState<string | null>('/');
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingFile, setViewingFile] = useState<FileContent | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIsDir, setNewIsDir] = useState(false);

  const fetchDir = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${getBackendUrl()}/api/files?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setCurrentPath(data.path);
        setParentPath(data.parent);
      }
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDir(currentPath);
  }, []);

  const openItem = async (item: FileItem) => {
    if (item.is_dir) {
      fetchDir(item.path);
    } else {
      setLoading(true);
      try {
        const res = await fetch(`${getBackendUrl()}/api/files/read?path=${encodeURIComponent(item.path)}`);
        if (res.ok) {
          const data = await res.json();
          setViewingFile(data);
          setEditContent(data.content);
          setEditing(false);
        } else {
          const err = await res.json();
          Alert.alert('Error', err.detail || 'Cannot read file');
        }
      } catch (e) {
        Alert.alert('Error', 'Failed to read file');
      } finally {
        setLoading(false);
      }
    }
  };

  const saveFile = async () => {
    if (!viewingFile) return;
    setSaving(true);
    try {
      const res = await fetch(`${getBackendUrl()}/api/files/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: viewingFile.path, content: editContent }),
      });
      if (res.ok) {
        setViewingFile({ ...viewingFile, content: editContent });
        setEditing(false);
        Alert.alert('Saved', 'File saved successfully');
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to save file');
    } finally {
      setSaving(false);
    }
  };

  const createNew = async () => {
    if (!newName.trim()) return;
    const fullPath = `${currentPath}/${newName.trim()}`;
    try {
      if (newIsDir) {
        await fetch(`${getBackendUrl()}/api/files/mkdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: fullPath }),
        });
      } else {
        await fetch(`${getBackendUrl()}/api/files/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: fullPath, content: '' }),
        });
      }
      setShowNewModal(false);
      setNewName('');
      fetchDir(currentPath);
    } catch (e) {
      Alert.alert('Error', 'Failed to create');
    }
  };

  const deleteItem = (item: FileItem) => {
    Alert.alert(
      'Delete',
      `Delete ${item.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await fetch(`${getBackendUrl()}/api/files?path=${encodeURIComponent(item.path)}`, {
                method: 'DELETE',
              });
              fetchDir(currentPath);
            } catch (e) {
              Alert.alert('Error', 'Failed to delete');
            }
          },
        },
      ]
    );
  };

  // File viewer
  if (viewingFile) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
          <TouchableOpacity
            testID="file-back-btn"
            onPress={() => { setViewingFile(null); setEditing(false); }}
            style={styles.headerBtn}
          >
            <Ionicons name="arrow-back" size={20} color={theme.text} />
          </TouchableOpacity>
          <View style={styles.headerFileInfo}>
            <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
              {viewingFile.name}
            </Text>
            <Text style={[styles.headerSub, { color: theme.textDim }]}>
              {viewingFile.language} · {formatSize(viewingFile.size)}
            </Text>
          </View>
          {editing ? (
            <TouchableOpacity
              testID="file-save-btn"
              onPress={saveFile}
              disabled={saving}
              style={[styles.headerActionBtn, { backgroundColor: theme.primary }]}
            >
              <Text style={[styles.headerActionText, { color: theme.background }]}>
                {saving ? '...' : 'Save'}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              testID="file-edit-btn"
              onPress={() => setEditing(true)}
              style={styles.headerBtn}
            >
              <Ionicons name="create-outline" size={20} color={theme.primary} />
            </TouchableOpacity>
          )}
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
        >
          {editing ? (
            <TextInput
              testID="file-editor"
              style={[styles.editor, {
                backgroundColor: theme.background,
                color: theme.success,
                borderColor: theme.border,
              }]}
              value={editContent}
              onChangeText={setEditContent}
              multiline
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
            />
          ) : (
            <ScrollView style={styles.flex} horizontal>
              <ScrollView style={styles.flex}>
                <Text
                  testID="file-content"
                  style={[styles.codeView, { color: theme.text }]}
                  selectable
                >
                  {viewingFile.content}
                </Text>
              </ScrollView>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // Breadcrumb
  const pathParts = currentPath.split('/').filter(Boolean);

  const renderItem = ({ item }: { item: FileItem }) => {
    const icon = item.is_dir
      ? { icon: 'folder', color: theme.warning }
      : getFileIcon(item.name);

    return (
      <TouchableOpacity
        testID={`file-item-${item.name}`}
        style={[styles.fileItem, { borderBottomColor: theme.border + '33' }]}
        onPress={() => openItem(item)}
        onLongPress={() => deleteItem(item)}
      >
        <Ionicons name={icon.icon as any} size={22} color={icon.color} />
        <View style={styles.fileInfo}>
          <Text style={[styles.fileName, { color: theme.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          {!item.is_dir && (
            <Text style={[styles.fileMeta, { color: theme.textDim }]}>
              {formatSize(item.size)}
            </Text>
          )}
        </View>
        {item.is_dir && (
          <Ionicons name="chevron-forward" size={16} color={theme.textDim} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <Ionicons name="folder-open" size={20} color={theme.warning} />
        <Text style={[styles.headerTitle, { color: theme.text }]}>Files</Text>
        <TouchableOpacity
          testID="refresh-files-btn"
          onPress={() => fetchDir(currentPath)}
          style={styles.headerBtn}
        >
          <Ionicons name="refresh" size={20} color={theme.textDim} />
        </TouchableOpacity>
        <TouchableOpacity
          testID="new-file-btn"
          onPress={() => setShowNewModal(true)}
          style={styles.headerBtn}
        >
          <Ionicons name="add-circle-outline" size={22} color={theme.primary} />
        </TouchableOpacity>
      </View>

      {/* Breadcrumb */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.breadcrumb, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}
      >
        <TouchableOpacity
          testID="breadcrumb-root"
          onPress={() => fetchDir('/')}
          style={styles.breadcrumbItem}
        >
          <Text style={[styles.breadcrumbText, { color: theme.primary }]}>/</Text>
        </TouchableOpacity>
        {pathParts.map((part, i) => {
          const path = '/' + pathParts.slice(0, i + 1).join('/');
          const isLast = i === pathParts.length - 1;
          return (
            <TouchableOpacity
              key={path}
              testID={`breadcrumb-${part}`}
              onPress={() => fetchDir(path)}
              style={styles.breadcrumbItem}
            >
              <Ionicons name="chevron-forward" size={12} color={theme.textDim} />
              <Text style={[styles.breadcrumbText, { color: isLast ? theme.text : theme.primary }]}>
                {part}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <FlatList
          data={[
            ...(parentPath !== null ? [{ name: '..', path: parentPath, is_dir: true, size: null, modified: '' }] : []),
            ...items,
          ]}
          renderItem={renderItem}
          keyExtractor={(item) => item.path + item.name}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="folder-open-outline" size={48} color={theme.border} />
              <Text style={[styles.emptyText, { color: theme.textDim }]}>Empty directory</Text>
            </View>
          }
        />
      )}

      {/* New File/Dir Modal */}
      <Modal visible={showNewModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Create New</Text>
            <View style={styles.toggleRow}>
              <TouchableOpacity
                testID="new-file-toggle"
                style={[styles.toggle, { backgroundColor: !newIsDir ? theme.primary : theme.surfaceHighlight }]}
                onPress={() => setNewIsDir(false)}
              >
                <Text style={{ color: !newIsDir ? theme.background : theme.text, fontWeight: '600', fontSize: 13 }}>
                  File
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="new-dir-toggle"
                style={[styles.toggle, { backgroundColor: newIsDir ? theme.primary : theme.surfaceHighlight }]}
                onPress={() => setNewIsDir(true)}
              >
                <Text style={{ color: newIsDir ? theme.background : theme.text, fontWeight: '600', fontSize: 13 }}>
                  Folder
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              testID="new-name-input"
              style={[styles.modalInput, { backgroundColor: theme.surfaceHighlight, color: theme.text, borderColor: theme.border }]}
              placeholder={newIsDir ? 'folder_name' : 'filename.py'}
              placeholderTextColor={theme.textDim}
              value={newName}
              onChangeText={setNewName}
              autoCapitalize="none"
              autoFocus
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                testID="new-cancel-btn"
                onPress={() => { setShowNewModal(false); setNewName(''); }}
                style={[styles.modalBtn, { borderColor: theme.border }]}
              >
                <Text style={{ color: theme.text, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="new-create-btn"
                onPress={createNew}
                style={[styles.modalBtn, { backgroundColor: theme.primary }]}
              >
                <Text style={{ color: theme.background, fontWeight: '700' }}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  headerBtn: {
    padding: 4,
  },
  headerFileInfo: { flex: 1 },
  headerSub: { fontSize: 11, marginTop: 1 },
  headerActionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  headerActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  breadcrumb: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    maxHeight: 40,
  },
  breadcrumbItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  breadcrumbText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingTop: 60,
  },
  emptyText: { fontSize: 14 },
  listContent: { paddingBottom: 24 },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  fileInfo: { flex: 1 },
  fileName: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  fileMeta: { fontSize: 11, marginTop: 2 },
  editor: {
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    lineHeight: 19,
    padding: 12,
    textAlignVertical: 'top',
  },
  codeView: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    lineHeight: 19,
    padding: 12,
    minWidth: '100%' as any,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  toggle: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 16,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  modalBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
});
