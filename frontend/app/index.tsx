import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { initBackendUrl, checkBackendHealth, getBackendUrl } from '../src/config';

export default function Index() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkSetup();
  }, []);

  const checkSetup = async () => {
    const url = await initBackendUrl();

    // Check if backend is reachable
    const healthy = await checkBackendHealth(url);
    if (!healthy) {
      router.replace('/connection');
      return;
    }

    // Check if config exists (onboarding completed)
    try {
      const response = await fetch(`${url}/api/config`);
      if (response.ok) {
        const config = await response.json();
        if (config.has_api_key) {
          router.replace('/(tabs)/terminal');
          return;
        }
      }
    } catch (e) {
      // Config not found
    }
    router.replace('/onboarding');
  };

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#00FF9C" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
