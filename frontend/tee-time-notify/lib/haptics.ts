import * as Haptics from "expo-haptics";

/**
 * Semantic haptics — named by what happened, not by which generator fires.
 * Keeps feedback consistent across screens: the same kind of moment always
 * feels the same, which is what makes an app read as "tight" rather than
 * randomly buzzy.
 *
 * Every call is fire-and-forget and swallows errors: haptics are unavailable
 * on simulators and some Android hardware, and a missing taptic engine should
 * never surface as an unhandled rejection.
 */

const safe = (fn: () => Promise<void>) => {
  fn().catch(() => {});
};

export const haptics = {
  /** Light tap — selecting, expanding, toggling, opening a sheet. */
  select: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),

  /** Medium tap — a committed press: primary buttons, starting a drag. */
  press: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),

  /** Something was created or completed — alert saved, purchase went through. */
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),

  /** Something failed — request error, validation block. */
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),

  /** Destructive or gated — deleting, hitting a plan limit. */
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
