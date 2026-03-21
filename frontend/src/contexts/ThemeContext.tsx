import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { themes, defaultTheme, AppTheme } from '../constants/themes';

interface ThemeContextType {
  theme: AppTheme;
  themeName: string;
  setThemeName: (name: string) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: themes[defaultTheme],
  themeName: defaultTheme,
  setThemeName: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeNameState] = useState(defaultTheme);

  useEffect(() => {
    AsyncStorage.getItem('theme').then((stored) => {
      if (stored && themes[stored]) {
        setThemeNameState(stored);
      }
    });
  }, []);

  const setThemeName = (name: string) => {
    if (themes[name]) {
      setThemeNameState(name);
      AsyncStorage.setItem('theme', name);
    }
  };

  return (
    <ThemeContext.Provider value={{ theme: themes[themeName], themeName, setThemeName }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
