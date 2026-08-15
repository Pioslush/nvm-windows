// Database row types. Kept by hand and in sync with supabase/migrations/.

export type EventStatus = "draft" | "published" | "completed";
export type SlotStatus = "open" | "booked" | "blocked";
export type BookingStatus =
  | "pending"
  | "confirmed"
  | "checked_in"
  | "late"
  | "no_show"
  | "cancelled";

export interface Venue {
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
  venue_id: string;
  name: string;
  notes: string | null;
  created_at: string;
}

export interface Event {
  id: string;
  venue_id: string;
  name: string;
  event_date: string;
  load_in_start: string;
  load_in_end: string;
  status: EventStatus;
  created_at: string;
}

export interface Slot {
  id: string;
  event_id: string;
  dock_id: string;
  start_time: string;
  end_time: string;
  status: SlotStatus;
  created_at: string;
}

export interface Vendor {
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
  vendor_id: string;
  status: BookingStatus;
  purpose: string;
  created_at: string;
  checked_in_at: string | null;
  reminded_at: string | null;
}

export interface EventInvite {
  id: string;
  event_id: string;
  vendor_email: string;
  token: string;
  created_at: string;
}

export interface GateListToken {
  id: string;
  event_id: string;
  token: string;
  expires_at: string;
  created_at: string;
}
