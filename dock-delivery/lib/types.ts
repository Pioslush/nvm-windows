// Database row types. Kept by hand and in sync with supabase/migrations/.

export type SlotStatus = "open" | "booked" | "blocked";
export type BookingStatus =
  | "pending"
  | "confirmed"
  | "checked_in"
  | "late"
  | "no_show"
  | "cancelled";

export interface Facility {
  id: string;
  name: string;
  city: string;
  timezone: string;
  address: string | null;
  require_approval: boolean;
  cancellation_cutoff_hours: number;
  created_by: string;
  stripe_customer_id: string | null;
  created_at: string;
}

export interface Dock {
  id: string;
  facility_id: string;
  name: string;
  notes: string | null;
  created_at: string;
}

export interface DockAvailability {
  id: string;
  dock_id: string;
  day_of_week: number; // 0=Sunday .. 6=Saturday
  start_time: string; // "HH:MM:SS"
  end_time: string;
  slot_interval_minutes: number;
  created_at: string;
}

export interface Slot {
  id: string;
  dock_id: string;
  start_time: string;
  end_time: string;
  status: SlotStatus;
  created_at: string;
}

export interface Carrier {
  id: string;
  company_name: string;
  contact_name: string;
  phone: string;
  email: string;
  vehicle_type: string;
  license_plate: string | null;
  user_id: string;
  created_at: string;
}

export interface Booking {
  id: string;
  slot_id: string;
  carrier_id: string;
  status: BookingStatus;
  purpose: string;
  created_at: string;
  checked_in_at: string | null;
  reminded_at: string | null;
}

export interface FacilityInvite {
  id: string;
  facility_id: string;
  carrier_email: string;
  token: string;
  created_at: string;
}

export interface DockManifestToken {
  id: string;
  facility_id: string;
  token: string;
  expires_at: string;
  created_at: string;
}
