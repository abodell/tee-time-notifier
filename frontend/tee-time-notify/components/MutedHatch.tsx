import React, { useState } from "react";
import { View, LayoutChangeEvent, StyleSheet } from "react-native";
import Svg, { Line } from "react-native-svg";

interface Props {
  isDark: boolean;
}

const SPACING = 9;

/**
 * Faint diagonal hatch, borrowed from "cart path closed" course signage —
 * reads as "set aside" through texture alone, no color or badge needed.
 * Lines are drawn individually (not via <Pattern>) since patternTransform
 * rotation is unreliable across react-native-svg's Android/iOS backends.
 */
export default function MutedHatch({ isDark }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  const { width, height } = size;
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  if (width > 0 && height > 0) {
    // Diagonal lines (45°) swept across the card, each offset by SPACING.
    const span = width + height;
    for (let x = -height; x < span; x += SPACING) {
      lines.push({ x1: x, y1: height, x2: x + height, y2: 0 });
    }
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {width > 0 && height > 0 && (
        <Svg width={width} height={height}>
          {lines.map((line, i) => (
            <Line
              key={i}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke={isDark ? "#FFFFFF" : "#000000"}
              strokeWidth={1.2}
              strokeOpacity={isDark ? 0.08 : 0.05}
            />
          ))}
        </Svg>
      )}
    </View>
  );
}
