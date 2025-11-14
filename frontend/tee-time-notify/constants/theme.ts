import { MD3LightTheme, MD3DarkTheme } from "react-native-paper";
import { Platform } from "react-native";

const tintColorLight = "#0a7ea4"; // brand blue
const tintColorDark = "#4dd0e1"; // brighter aqua for dark mode

export const Colors = {
  light: {
    text: "#11181C",
    background: "#ffffff",
    surface: "#f8f9fb",
    tint: tintColorLight,
    icon: "#687076",
    tabIconDefault: "#687076",
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: "#EAEAEA",          // high‑contrast white text
    background: "#0d0d0d",    // deep neutral background
    surface: "#1a1a1a",       // slightly raised card tone
    tint: tintColorDark,
    icon: "#a0a4a8",
    tabIconDefault: "#a0a4a8",
    tabIconSelected: tintColorDark,
  },
};

export const PaperLightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: Colors.light.tint,
    background: Colors.light.background,
    surface: Colors.light.surface,
    onBackground: Colors.light.text,
    onSurface: Colors.light.text,
    outline: "#E0E0E0",
  },
};

export const PaperDarkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: Colors.dark.tint,
    background: Colors.dark.background,
    surface: Colors.dark.surface,
    onBackground: Colors.dark.text,
    onSurface: Colors.dark.text,
    outline: "#2a2a2a",
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded:
      "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});