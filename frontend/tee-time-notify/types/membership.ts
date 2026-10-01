export interface MembershipTier {
    id: number;
    name: string;
    description?: string;
    price_cents?: number;
    max_alerts?: number;
    scan_interval_seconds?: number;
    revenuecat_entitlement_id?: string;
}

export interface UserProfileResponse {
    membership_tier_id: number;
    membership_tiers?: MembershipTier;
    pending_downgrade?: boolean;
    cancel_at?: string;
    lifetime_alerts_created?: number;
    free_lifetime_alert_limit?: number;
    is_bonus_active?: boolean;
    bonus_expires_at?: string;
}
