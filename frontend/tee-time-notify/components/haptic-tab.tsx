import { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import { haptics } from '@/lib/haptics';

export function HapticTab(props: BottomTabBarButtonProps) {
  return (
    <PlatformPressable
      {...props}
      onPressIn={(ev) => {
        // Fires on press-in rather than press so the tap feels acknowledged
        // before the screen swaps.
        haptics.select();
        props.onPressIn?.(ev);
      }}
    />
  );
}
