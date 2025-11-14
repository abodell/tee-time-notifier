import React, { ReactNode, useEffect } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withDelay,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

interface Props {
  children: ReactNode;
  delay?: number;
  visible?: boolean;
  onFadeOutComplete?: () => void;
}

export default function FadeSlideTransition({
  children,
  delay = 0,
  visible = true,
  onFadeOutComplete,
}: Props) {
  const progress = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(visible ? 1 : 0, {
        duration: 400,
        easing: Easing.out(Easing.exp),
      },
      (finished) => {
        if (finished && !visible && onFadeOutComplete) {
          scheduleOnRN(onFadeOutComplete);
        }
      })
    );
  }, [visible]);

  const style = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0, 1], [0, 1]);
    const translateY = interpolate(progress.value, [0, 1], [20, 0]);
    return { opacity, transform: [{ translateY }] };
  });

  return <Animated.View style={style}>{children}</Animated.View>;
}