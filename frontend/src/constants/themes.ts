export interface ThemeColors {
  name: string;
  displayName: string;
  background: string;
  surface: string;
  surfaceHighlight: string;
  primary: string;
  secondary: string;
  text: string;
  textDim: string;
  border: string;
  error: string;
  success: string;
  warning: string;
  info: string;
}

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface AppTheme extends ThemeColors {
  terminal: TerminalTheme;
}

export const themes: Record<string, AppTheme> = {
  cyberpunk_void: {
    name: 'cyberpunk_void',
    displayName: 'Cyberpunk Void',
    background: '#050505',
    surface: '#0F0F0F',
    surfaceHighlight: '#1A1A1A',
    primary: '#00FF9C',
    secondary: '#FF0055',
    text: '#E0E0E0',
    textDim: '#808080',
    border: '#333333',
    error: '#FF453A',
    success: '#32D74B',
    warning: '#FFD60A',
    info: '#64D2FF',
    terminal: {
      background: '#050505',
      foreground: '#00FF9C',
      cursor: '#00FF9C',
      cursorAccent: '#050505',
      selectionBackground: 'rgba(0, 255, 156, 0.3)',
      black: '#050505',
      red: '#FF0055',
      green: '#00FF9C',
      yellow: '#FFD60A',
      blue: '#64D2FF',
      magenta: '#FF79C6',
      cyan: '#00FFFF',
      white: '#E0E0E0',
      brightBlack: '#808080',
      brightRed: '#FF4488',
      brightGreen: '#33FFAA',
      brightYellow: '#FFE033',
      brightBlue: '#88DDFF',
      brightMagenta: '#FF99DD',
      brightCyan: '#33FFFF',
      brightWhite: '#FFFFFF',
    },
  },
  monokai_pro: {
    name: 'monokai_pro',
    displayName: 'Monokai Pro',
    background: '#2D2A2E',
    surface: '#403E41',
    surfaceHighlight: '#5B595C',
    primary: '#FFD866',
    secondary: '#FF6188',
    text: '#FCFCFA',
    textDim: '#939293',
    border: '#727072',
    error: '#FF6188',
    success: '#A9DC76',
    warning: '#FC9867',
    info: '#78DCE8',
    terminal: {
      background: '#2D2A2E',
      foreground: '#FCFCFA',
      cursor: '#FFD866',
      cursorAccent: '#2D2A2E',
      selectionBackground: 'rgba(255, 216, 102, 0.3)',
      black: '#2D2A2E',
      red: '#FF6188',
      green: '#A9DC76',
      yellow: '#FFD866',
      blue: '#78DCE8',
      magenta: '#AB9DF2',
      cyan: '#78DCE8',
      white: '#FCFCFA',
      brightBlack: '#727072',
      brightRed: '#FF6188',
      brightGreen: '#A9DC76',
      brightYellow: '#FFD866',
      brightBlue: '#78DCE8',
      brightMagenta: '#AB9DF2',
      brightCyan: '#78DCE8',
      brightWhite: '#FFFFFF',
    },
  },
  dracula: {
    name: 'dracula',
    displayName: 'Dracula',
    background: '#282A36',
    surface: '#44475A',
    surfaceHighlight: '#6272A4',
    primary: '#BD93F9',
    secondary: '#FF79C6',
    text: '#F8F8F2',
    textDim: '#6272A4',
    border: '#6272A4',
    error: '#FF5555',
    success: '#50FA7B',
    warning: '#F1FA8C',
    info: '#8BE9FD',
    terminal: {
      background: '#282A36',
      foreground: '#F8F8F2',
      cursor: '#BD93F9',
      cursorAccent: '#282A36',
      selectionBackground: 'rgba(189, 147, 249, 0.3)',
      black: '#21222C',
      red: '#FF5555',
      green: '#50FA7B',
      yellow: '#F1FA8C',
      blue: '#BD93F9',
      magenta: '#FF79C6',
      cyan: '#8BE9FD',
      white: '#F8F8F2',
      brightBlack: '#6272A4',
      brightRed: '#FF6E6E',
      brightGreen: '#69FF94',
      brightYellow: '#FFFFA5',
      brightBlue: '#D6ACFF',
      brightMagenta: '#FF92DF',
      brightCyan: '#A4FFFF',
      brightWhite: '#FFFFFF',
    },
  },
};

export const themeKeys = Object.keys(themes) as Array<keyof typeof themes>;

export const defaultTheme = 'cyberpunk_void';
