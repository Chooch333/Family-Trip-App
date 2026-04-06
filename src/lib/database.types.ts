export type Database = {
  public: {
    Tables: {
      trips: { Row: Trip; Insert: Omit<Trip, "id" | "created_at" | "updated_at">; Update: Partial<Omit<Trip, "id">>; };
      trip_members: { Row: TripMember; Insert: Omit<TripMember, "id" | "joined_at">; Update: Partial<Omit<TripMember, "id">>; };
      days: { Row: Day; Insert: Omit<Day, "id" | "created_at">; Update: Partial<Omit<Day, "id">>; };
      stops: { Row: Stop; Insert: Omit<Stop, "id" | "created_at" | "updated_at">; Update: Partial<Omit<Stop, "id">>; };
      votes: { Row: Vote; Insert: Omit<Vote, "id" | "created_at">; Update: Partial<Omit<Vote, "id">>; };
      proposals: { Row: Proposal; Insert: Omit<Proposal, "id" | "created_at">; Update: Partial<Omit<Proposal, "id">>; };
      ai_conversations: { Row: AIConversation; Insert: Omit<AIConversation, "id" | "created_at" | "updated_at">; Update: Partial<Omit<AIConversation, "id">>; };
      journal_entries: { Row: JournalEntry; Insert: Omit<JournalEntry, "id" | "created_at">; Update: Partial<Omit<JournalEntry, "id">>; };
    };
  };
};

export interface Trip {
  id: string; name: string; description: string | null; start_date: string | null;
  end_date: string | null; cover_color: string; invite_code: string;
  created_by: string | null; created_at: string; updated_at: string;
}

export interface TripMember {
  id: string; trip_id: string; display_name: string; avatar_color: string;
  avatar_initial: string; role: "organizer" | "member"; is_online: boolean;
  last_seen_at: string; session_token: string | null; joined_at: string;
}

export interface Day {
  id: string; trip_id: string; day_number: number; date: string | null;
  title: string | null; color: string; created_at: string;
}

export interface StopPhoto { url: string; attribution?: string; }

export interface Stop {
  id: string; trip_id: string; day_id: string; name: string;
  description: string | null; latitude: number | null; longitude: number | null;
  google_place_id: string | null; photos: StopPhoto[]; start_time: string | null;
  duration_minutes: number; sort_order: number; cost_estimate: number | null;
  cost_currency: string; notes: string | null; transit_note: string | null;
  transit_minutes: number | null; tags: string[]; version_owner: string | null;
  master_stop_id: string | null; created_by: string | null;
  created_at: string; updated_at: string;
}

export interface Vote {
  id: string; stop_id: string; member_id: string; vote: 1 | -1; created_at: string;
}

export interface Proposal {
  id: string; trip_id: string; proposed_by: string;
  action: "add_stop" | "remove_stop" | "move_stop" | "edit_stop";
  stop_data: Record<string, unknown>; target_day_id: string | null;
  target_sort_order: number | null; affected_stop_id: string | null;
  status: "pending" | "approved" | "declined"; reviewed_by: string | null;
  review_note: string | null; reviewed_at: string | null; created_at: string;
}

export interface AIMessage { role: "user" | "assistant"; content: string; timestamp: string; }

export interface AIConversation {
  id: string; trip_id: string; member_id: string; messages: AIMessage[];
  created_at: string; updated_at: string;
}

export interface JournalEntry {
  id: string; trip_id: string; stop_id: string | null; member_id: string;
  entry_type: "text" | "photo" | "voice"; content: string | null;
  media_url: string | null; captured_at: string; created_at: string;
}

export interface StopWithVotes extends Stop { votes: Vote[]; vote_count: number; }
export interface DayWithStops extends Day { stops: StopWithVotes[]; }
export interface TripFull extends Trip { members: TripMember[]; days: DayWithStops[]; pending_proposals: Proposal[]; }
