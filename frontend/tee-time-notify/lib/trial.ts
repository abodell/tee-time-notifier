import { useEffect, useState } from "react";
import Purchases, { PurchasesIntroPrice } from "react-native-purchases";

/** Used before RevenueCat responds, and if no introductory offer is configured. */
export const DEFAULT_TRIAL_DAYS = 7;

const DAYS_PER_UNIT: Record<string, number> = {
  DAY: 1,
  WEEK: 7,
  MONTH: 30,
  YEAR: 365,
};

export function introPriceToDays(
  introPrice: PurchasesIntroPrice | null | undefined
): number | null {
  if (!introPrice) return null;
  const perUnit = DAYS_PER_UNIT[introPrice.periodUnit];
  if (!perUnit) return null;
  return perUnit * introPrice.periodNumberOfUnits;
}

// Module-level cache so every screen sharing this helper triggers at most
// one Purchases.getOfferings() call per app session, instead of one per screen.
let cachedTrialDays: number | null = null;
let inFlight: Promise<number | null> | null = null;

/**
 * Reads the Pro trial length off RevenueCat's current offering's introductory
 * offer, so trial-length copy always matches what's configured in App Store
 * Connect instead of a hardcoded string that can drift out of sync.
 */
export async function getProTrialDays(): Promise<number> {
  if (cachedTrialDays !== null) return cachedTrialDays;
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const offerings = await Purchases.getOfferings();
        const packages = offerings.current?.availablePackages ?? [];
        for (const pkg of packages) {
          const days = introPriceToDays(pkg.product.introPrice);
          if (days) {
            cachedTrialDays = days;
            return days;
          }
        }
      } catch (e) {
        console.log("[trial] Error fetching offerings for trial length", e);
      }
      return null;
    })();
  }
  const result = await inFlight;
  inFlight = null;
  return result ?? DEFAULT_TRIAL_DAYS;
}

/** Pro trial length in days, starting at DEFAULT_TRIAL_DAYS until RevenueCat responds. */
export function useProTrialDays(): number {
  const [days, setDays] = useState<number>(cachedTrialDays ?? DEFAULT_TRIAL_DAYS);

  useEffect(() => {
    let mounted = true;
    getProTrialDays().then((d) => {
      if (mounted) setDays(d);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return days;
}
