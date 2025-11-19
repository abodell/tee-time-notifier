import {
  MD3LightTheme as DefaultLightTheme,
  MD3DarkTheme as DefaultDarkTheme,
  configureFonts,
} from "react-native-paper";
import { Platform } from "react-native";

// ------------------------------------------------------------------
// SPICY APPLE THEME 🍎🌶️
// ------------------------------------------------------------------

// 1. Typography (System Fonts)
const fontConfig = {
  displayLarge: { fontFamily: "System", fontWeight: "700" as const },
  displayMedium: { fontFamily: "System", fontWeight: "700" as const },
  displaySmall: { fontFamily: "System", fontWeight: "700" as const },
  headlineLarge: { fontFamily: "System", fontWeight: "700" as const },
  headlineMedium: { fontFamily: "System", fontWeight: "700" as const },
  headlineSmall: { fontFamily: "System", fontWeight: "600" as const },
  titleLarge: { fontFamily: "System", fontWeight: "600" as const },
  titleMedium: { fontFamily: "System", fontWeight: "600" as const },
  titleSmall: { fontFamily: "System", fontWeight: "500" as const },
  bodyLarge: { fontFamily: "System", fontWeight: "400" as const },
  bodyMedium: { fontFamily: "System", fontWeight: "400" as const },
  bodySmall: { fontFamily: "System", fontWeight: "400" as const },
  labelLarge: { fontFamily: "System", fontWeight: "500" as const },
  labelMedium: { fontFamily: "System", fontWeight: "500" as const },
  labelSmall: { fontFamily: "System", fontWeight: "500" as const },
};

// 2. Colors & Gradients

// Light Mode: "Porcelain & Electric Blue"
// Background: Pure White
// Surface: Pure White
const lightColors = {
  ...DefaultLightTheme.colors,
  primary: "#2F80ED", // Electric Blue
  onPrimary: "#FFFFFF",
  primaryContainer: "#D6E4FF",
  onPrimaryContainer: "#001D3D",
  secondary: "#5E5CE6", // Indigo
  onSecondary: "#FFFFFF",
  secondaryContainer: "#E0E0FF",
  onSecondaryContainer: "#050533",
  background: "#FFFFFF", // Pure White
  surface: "#F5F5F5", // Slight contrast (White Smoke)
  surfaceVariant: "#F1F5F9", // Cool Grey 100
  onSurface: "#1E293B", // Slate 800
  onSurfaceVariant: "#64748B", // Slate 500
  outline: "rgba(47, 128, 237, 0.15)", // Subtle blueish border
  outlineVariant: "rgba(148, 163, 184, 0.2)",
  elevation: {
    level0: "transparent",
    level1: "#FFFFFF",
    level2: "#FFFFFF",
    level3: "#FFFFFF",
    level4: "#FFFFFF",
    level5: "#FFFFFF",
  },
};

// Dark Mode: "Midnight & Neon Cyan"
// Background: Pure Black
// Surface: Dark Grey
const darkColors = {
  ...DefaultDarkTheme.colors,
  primary: "#56CCF2", // Neon Cyan
  onPrimary: "#002B36",
  primaryContainer: "#004E64",
  onPrimaryContainer: "#E0F7FA",
  secondary: "#5E5CE6", // Indigo
  onSecondary: "#FFFFFF",
  secondaryContainer: "#2C2C54",
  onSecondaryContainer: "#E0E0FF",
  background: "#000000", // Pure Black
  surface: "#1C1C1E", // iOS Dark Surface
  surfaceVariant: "#334155", // Slate 700
  onSurface: "#F8FAFC", // Slate 50
  onSurfaceVariant: "#94A3B8", // Slate 400
  outline: "rgba(86, 204, 242, 0.2)", // Subtle cyan border
  outlineVariant: "rgba(51, 65, 85, 0.4)",
  elevation: {
    level0: "transparent",
    level1: "#1C1C1E",
    level2: "#1C1C1E",
    level3: "#1C1C1E",
    level4: "#1C1C1E",
    level5: "#1C1C1E",
  },
};

// 3. Theme Definitions
export const PaperLightTheme = {
  ...DefaultLightTheme,
  fonts: configureFonts({ config: fontConfig }),
  colors: lightColors,
  roundness: 12,
};

export const PaperDarkTheme = {
  ...DefaultDarkTheme,
  fonts: configureFonts({ config: fontConfig }),
  colors: darkColors,
  roundness: 12,
};

// 4. Custom Gradients
export const Colors = {
  light: {
    gradients: {
      primary: ["#2F80ED", "#56CCF2"], // Blue -> Cyan
      success: ["#34C759", "#30D158"],
      danger: ["#FF3B30", "#FF453A"],
      dark: ["#2C3E50", "#4CA1AF"],
      background: ["#F8FAFC", "#FFFFFF"], // Subtle top-down fade
    },
  },
  dark: {
    gradients: {
      primary: ["#0A84FF", "#5E5CE6"], // Blue -> Indigo
      success: ["#30D158", "#34C759"],
      danger: ["#FF453A", "#FF3B30"],
      dark: ["#1C1C1E", "#2C2C2E"],
      background: ["#0F172A", "#020617"], // Slate 900 -> Slate 950
    },
  },
};