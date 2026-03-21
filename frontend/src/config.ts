import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:8080';

let _cachedUrl: string = '';
let _initialized = false;

export async function initBackendUrl(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem('backend_url');
    if (saved) {
      _cachedUrl = saved;
      _initialized = true;
      return saved;
    }
  } catch {}
  _cachedUrl = DEFAULT_URL;
  _initialized = true;
  return DEFAULT_URL;
}

export async function setBackendUrl(url: string): Promise<void> {
  _cachedUrl = url;
  await AsyncStorage.setItem('backend_url', url);
}

export function getBackendUrl(): string {
  return _cachedUrl || DEFAULT_URL;
}

export async function checkBackendHealth(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${url}/api/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}
