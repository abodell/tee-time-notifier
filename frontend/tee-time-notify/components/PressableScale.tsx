import React, { useCallback } from "react";
import { Pressable, PressableProps, StyleProp, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { haptics } from "@/lib/haptics";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Snappy enough to feel instant, damped enough not to wobble. Matches the
// press feel of iOS system controls rather than a bouncy spring.
const SPRING = { damping: 18, stiffness: 420, mass: 0.5 };

type HapticKind = "select" | "press" | "none";

export interface PressableScaleProps extends Omit<PressableProps, "style"> {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** How far it compresses. 0.97 for large cards, ~0.94 for small buttons. */
  scaleTo?: number;
  /** Haptic fired on press-in. Defaults to a light "select" tick. */
  haptic?: HapticKind;
  /** Dim slightly alongside the scale, the way list rows do. */
  dim?: boolean;
}

/**
 * Pressable that springs inward on touch.
 *
 * TouchableOpacity's flat opacity fade reads as dated next to the scale-and-settle
 * that iOS system UI (and every app people compare this one to) uses. Driving it
 * on the UI thread via Reanimated keeps the response immediate even while the JS
 * thread is busy fetching.
 */
export default function PressableScale({
  children,
  style,
  scaleTo = 0.97,
  haptic = "select",
  dim = false,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: PressableScaleProps) {
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * (1 - scaleTo) }],
    opacity: dim ? 1 - pressed.value * 0.12 : 1,
  }));

  const handlePressIn = useCallback(
    (e: any) => {
      pressed.value = withSpring(1, SPRING);
      if (!disabled && haptic !== "none") haptics[haptic]();
      onPressIn?.(e);
    },
    [disabled, haptic, onPressIn]
  );

  const handlePressOut = useCallback(
    (e: any) => {
      pressed.value = withSpring(0, SPRING);
      onPressOut?.(e);
    },
    [onPressOut]
  );

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
