export interface Course {
  name?: string;
  city?: string;
  state?: string;
}

export interface Alert {
  id?: number;
  user_id: string;
  course_id: number;
  holes: number;
  date_from?: string;
  date_to?: string;
  start_time?: string;
  end_time?: string;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
  // add this:
  courses?: Course; // nested relation from Supabase join
}
export type CreateAlertPayload = Omit<
    Alert,
    "id" | "created_at" | "updated_at"
>;