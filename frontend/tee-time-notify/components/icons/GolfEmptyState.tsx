import React, { useEffect } from "react";
import Svg, {
  Path,
  Circle,
  Ellipse,
  Line,
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  G,
} from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

interface Props {
  isDark?: boolean;
  width?: number;
  height?: number;
}

export default function GolfEmptyState({ isDark = false, width = 164, height = 104 }: Props) {
  const flagWave = useSharedValue(0);
  const ballFloat = useSharedValue(0);

  useEffect(() => {
    flagWave.value = withRepeat(
      withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
      -1,
      true
    );
    ballFloat.value = withRepeat(
      withTiming(1, { duration: 3000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true
    );
  }, []);

  const animatedFlag = useAnimatedProps(() => {
    const w = flagWave.value;
    return {
      d: `M 130 22 L ${148 + w * 8} ${30 + w * 1.5} L 130 ${46 - w * 1.5} Z`,
    };
  });

  const animatedBallCy = useAnimatedProps(() => ({
    cy: 108 - ballFloat.value * 3,
  }));

  const animatedHighlightCy = useAnimatedProps(() => ({
    cy: 108 - ballFloat.value * 3 - 4,
  }));

  const animatedShadow = useAnimatedProps(() => ({
    ry: 2.5 - ballFloat.value * 0.7,
    opacity: 0.18 - ballFloat.value * 0.05,
  }));

  // Light mode uses soft muted greens; dark uses near-invisible dark tones
  const hillFar   = isDark ? "rgba(20,50,30,0.55)"  : "rgba(200,240,210,0.6)";
  const hillMid   = isDark ? "rgba(18,55,30,0.7)"   : "rgba(180,230,195,0.75)";
  const hillNear1 = isDark ? "#0e3320"               : "#bbf7d0";
  const hillNear2 = isDark ? "#0a2418"               : "#86efac";
  const treeColor = isDark ? "rgba(8,28,16,0.9)"    : "rgba(20,80,40,0.5)";
  const poleColor = isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.25)";
  const flagColor = isDark ? "rgba(74,222,128,0.55)" : "rgba(22,163,74,0.7)";
  const greenFill = isDark ? "rgba(21,80,50,0.5)"   : "rgba(52,211,153,0.35)";
  const cupFill   = isDark ? "rgba(0,0,0,0.6)"       : "rgba(0,0,0,0.25)";
  const sandFill  = isDark ? "rgba(60,50,35,0.5)"   : "rgba(254,243,199,0.7)";
  const waterFill = isDark ? "rgba(10,30,55,0.65)"  : "rgba(125,211,252,0.5)";
  const shimmer   = isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.4)";

  return (
    <Svg width={width} height={height} viewBox="0 0 220 140">
      <Defs>
        <LinearGradient id="h1" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={hillNear1} />
          <Stop offset="1" stopColor={hillNear2} />
        </LinearGradient>

        <RadialGradient id="ball" cx="33%" cy="28%" r="72%">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={isDark ? "0.9" : "1"} />
          <Stop offset="0.55" stopColor="#e8eaed" stopOpacity={isDark ? "0.7" : "0.9"} />
          <Stop offset="1" stopColor="#b0b5bc" stopOpacity={isDark ? "0.5" : "0.8"} />
        </RadialGradient>

        <RadialGradient id="cup" cx="50%" cy="25%" r="70%">
          <Stop offset="0" stopColor={cupFill} />
          <Stop offset="1" stopColor="rgba(0,0,0,0)" />
        </RadialGradient>
      </Defs>

      <G>
        {/* ── Far hill ── */}
        <Path
          d="M -10 92 C 20 68 55 58 90 62 C 125 66 158 78 200 86 L 230 90 L 230 145 L -10 145 Z"
          fill={hillFar}
        />

        {/* ── Mid hill ── */}
        <Path
          d="M -10 102 C 25 80 60 70 100 72 C 138 74 165 84 200 94 L 230 98 L 230 145 L -10 145 Z"
          fill={hillMid}
        />

        {/* ── Treeline — left cluster ── */}
        {([
          [10, 80], [20, 76], [30, 78], [40, 74], [50, 77], [60, 75],
        ] as [number, number][]).map(([x, y], i) => (
          <G key={`tl${i}`}>
            <Path d={`M ${x} ${y} L ${x-6} ${y+11} L ${x+6} ${y+11} Z`} fill={treeColor} />
            <Path d={`M ${x} ${y+5} L ${x-8} ${y+17} L ${x+8} ${y+17} Z`} fill={treeColor} />
          </G>
        ))}

        {/* ── Treeline — right cluster ── */}
        {([
          [168, 80], [178, 76], [188, 79], [198, 74], [208, 77], [218, 81],
        ] as [number, number][]).map(([x, y], i) => (
          <G key={`tr${i}`}>
            <Path d={`M ${x} ${y} L ${x-6} ${y+11} L ${x+6} ${y+11} Z`} fill={treeColor} />
            <Path d={`M ${x} ${y+5} L ${x-8} ${y+17} L ${x+8} ${y+17} Z`} fill={treeColor} />
          </G>
        ))}

        {/* ── Foreground fairway ── */}
        <Path
          d="M -10 118 C 20 96 55 84 100 82 C 140 80 168 90 200 102 L 230 108 L 230 145 L -10 145 Z"
          fill="url(#h1)"
          opacity={isDark ? 0.65 : 0.8}
        />

        {/* Subtle mow stripe */}
        <Path
          d="M 0 130 C 40 116 85 110 125 112 L 125 118 C 85 116 40 122 0 136 Z"
          fill={isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.1)"}
        />

        {/* ── Water hazard ── */}
        <Ellipse cx="46" cy="100" rx="26" ry="7" fill={waterFill} />
        <Line x1="34" y1="98" x2="44" y2="98" stroke={shimmer} strokeWidth="1" strokeLinecap="round" />
        <Line x1="49" y1="102" x2="60" y2="102" stroke={shimmer} strokeWidth="0.8" strokeLinecap="round" />

        {/* ── Bunker ── */}
        <Ellipse cx="95" cy="113" rx="18" ry="6" fill={sandFill} />

        {/* ── Putting green ── */}
        <Ellipse cx="140" cy="96" rx="30" ry="11" fill={greenFill} />
        <Ellipse
          cx="140" cy="96" rx="30" ry="11"
          fill="none"
          stroke={isDark ? "rgba(74,222,128,0.12)" : "rgba(22,163,74,0.2)"}
          strokeWidth="1"
        />

        {/* ── Hole cup ── */}
        <Ellipse cx="130" cy="96" rx="5.5" ry="2" fill="url(#cup)" />
        <Ellipse
          cx="130" cy="95.5" rx="5.5" ry="1.8"
          fill="none"
          stroke={isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.15)"}
          strokeWidth="0.7"
        />

        {/* ── Flag pole ── */}
        <Line
          x1="130" y1="95" x2="130" y2="22"
          stroke={poleColor}
          strokeWidth="1.6"
          strokeLinecap="round"
        />

        {/* ── Animated pennant ── */}
        <AnimatedPath animatedProps={animatedFlag} fill={flagColor} />
        <AnimatedPath animatedProps={animatedFlag} fill="rgba(255,255,255,0.1)" />

        {/* ── Tee peg ── */}
        <Path
          d="M 80 120 L 78.5 128 L 81.5 128 Z"
          fill={isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)"}
        />
        <Ellipse
          cx="80" cy="119.5" rx="3.5" ry="1"
          fill={isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.15)"}
        />

        {/* Ball shadow */}
        <AnimatedEllipse
          animatedProps={animatedShadow}
          cx="80" cy="118" rx="8"
          fill="rgba(0,0,0,0.35)"
        />

        {/* Ball */}
        <AnimatedCircle animatedProps={animatedBallCy} cx="80" r="10.5" fill="url(#ball)" />

        {/* Dimples */}
        <AnimatedCircle animatedProps={animatedBallCy} cx="76" r="2.8" fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth="1.2" />
        <AnimatedCircle animatedProps={animatedBallCy} cx="84" r="2.8" fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth="1.2" />
        <AnimatedCircle animatedProps={animatedBallCy} cx="80" r="2.8" fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="1.2" />

        {/* Specular highlight */}
        <AnimatedCircle
          animatedProps={animatedHighlightCy}
          cx="76" r="2.2"
          fill={isDark ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.5)"}
        />
      </G>
    </Svg>
  );
}
