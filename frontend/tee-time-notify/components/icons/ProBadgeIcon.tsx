import React from "react";
import Svg, { Circle, Defs, LinearGradient, Stop, Path } from "react-native-svg";

interface ProBadgeIconProps {
  isDark?: boolean;
  size?: number;
}

/**
 * A premium circular badge styled like a golf ball — gradient green fill
 * with a subtle dimple pattern and specular highlight.
 */
export default function ProBadgeIcon({ isDark = false, size = 36 }: ProBadgeIconProps) {
  const gradTop = isDark ? "#4ade80" : "#22c55e";
  const gradBottom = isDark ? "#15803d" : "#14532d";

  // Dimple grid — three rings radiating from center (18, 18)
  const cx = 18;
  const cy = 18;

  const rings: { r: number; count: number; offset: number; dr: number }[] = [
    { r: 4.8,  count: 6,  offset: 0,    dr: 1.7 },
    { r: 8.8,  count: 9,  offset: 20,   dr: 1.55 },
    { r: 12.4, count: 12, offset: 0,    dr: 1.4 },
  ];

  const dimples: { cx: number; cy: number; r: number }[] = [];
  rings.forEach(({ r, count, offset, dr }) => {
    for (let i = 0; i < count; i++) {
      const deg = offset + (360 / count) * i;
      const rad = (deg * Math.PI) / 180;
      dimples.push({ cx: cx + r * Math.cos(rad), cy: cy + r * Math.sin(rad), r: dr });
    }
  });

  return (
    <Svg width={size} height={size} viewBox="0 0 36 36">
      <Defs>
        <LinearGradient id="pb_grad" x1="0.3" y1="0" x2="0.7" y2="1">
          <Stop offset="0" stopColor={gradTop} stopOpacity="1" />
          <Stop offset="1" stopColor={gradBottom} stopOpacity="1" />
        </LinearGradient>
      </Defs>

      {/* Main sphere */}
      <Circle cx="18" cy="18" r="16" fill="url(#pb_grad)" />

      {/* Subtle inner rim for depth */}
      <Circle
        cx="18"
        cy="18"
        r="14.8"
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth="1"
      />

      {/* Dimples */}
      {dimples.map((d, i) => (
        <Circle
          key={i}
          cx={d.cx}
          cy={d.cy}
          r={d.r}
          fill="rgba(0,0,0,0.18)"
        />
      ))}

      {/* Specular highlight (upper-left) */}
      <Circle cx="12" cy="11" r="5" fill="rgba(255,255,255,0.14)" />
      <Circle cx="11" cy="10" r="2.5" fill="rgba(255,255,255,0.18)" />
    </Svg>
  );
}
