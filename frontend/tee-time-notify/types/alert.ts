export interface Alert {
    id?: number
    user_id: string
    course_id: number
    holes: number
    date_from?: string
    date_to?: string
    start_time?: string
    end_time?: string
    active?: boolean
    created_at?: string
    updated_at?: string
}

export type CreateAlertPayload = Omit<
    Alert,
    "id" | "created_at" | "updated_at"
>;