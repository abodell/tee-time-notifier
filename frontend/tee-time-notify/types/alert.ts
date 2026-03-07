export interface Course {
  name?: string;
  city?: string;
  state?: string;
  provider_url?: string;
  time_zone?: string;
}

export interface Availability {
  tee_time: string;
  price?: number;
}

export interface AlertNotification {
  id: number;
  sent_at: string;
  availability?: Availability;
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
  is_recurring?: boolean;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
  // Relations
  courses?: Course;
  alert_notifications?: AlertNotification[];
}
export type CreateAlertPayload = Omit<
  Alert,
  "id" | "created_at" | "updated_at"
>;