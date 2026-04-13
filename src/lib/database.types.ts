export interface StopPhoto { url: string; attribution?: string; }
export interface AIMessage { role: "user" | "assistant"; content: string; timestamp: string; }

export type Database = {
  public: {
    Tables: {
      trips: {
        Row: {
          id: string; name: string; description: string | null; start_date: string | null;
          end_date: string | null; cover_color: string; invite_code: string;
          created_by: string | null; created_at: string; updated_at: string;
          destination: string | null; duration: string | null; group_type: string | null;
          group_detail: string | null; interests: string | null; extra_notes: string | null; travel_dates: string | null; cover_image_url: string | null;
          trip_summary: string | null;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string; display_name: string; email: string; avatar_color: string;
          avatar_initial: string; bio: string | null; dietary: string | null;
          mobility: string | null; travel_style: string | null;
          home_location: string | null; created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      trip_members: {
        Row: {
          id: string; trip_id: string; display_name: string; avatar_color: string;
          avatar_initial: string; role: "organizer" | "member"; is_online: boolean;
          last_seen_at: string; session_token: string | null; joined_at: string;
          profile_id: string | null;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      days: {
        Row: {
          id: string; trip_id: string; day_number: number; date: string | null;
          title: string | null; color: string; narrative: string | null; created_at: string;
          vibe_status: string | null; reasoning: string | null;
          accommodation_name: string | null; accommodation_address: string | null;
          accommodation_latitude: number | null; accommodation_longitude: number | null;
          accommodation_notes: string | null;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      stops: {
        Row: {
          id: string; trip_id: string; day_id: string; name: string;
          description: string | null; latitude: number | null; longitude: number | null;
          google_place_id: string | null; photos: StopPhoto[]; start_time: string | null;
          duration_minutes: number; sort_order: number; cost_estimate: number | null;
          cost_currency: string; notes: string | null; transit_note: string | null;
          transit_minutes: number | null; tags: string[]; stop_type: string;
          version_owner: string | null;
          master_stop_id: string | null; created_by: string | null;
          created_at: string; updated_at: string;
          ai_note: string | null; on_bench: boolean | null;
          is_anchor: boolean;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      votes: {
        Row: {
          id: string; stop_id: string; member_id: string; vote: 1 | -1; created_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      proposals: {
        Row: {
          id: string; trip_id: string; proposed_by: string;
          action: "add_stop" | "remove_stop" | "move_stop" | "edit_stop";
          stop_data: Record<string, unknown>; target_day_id: string | null;
          target_sort_order: number | null; affected_stop_id: string | null;
          status: "pending" | "approved" | "declined"; reviewed_by: string | null;
          review_note: string | null; reviewed_at: string | null; created_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      profile_memories: {
        Row: {
          id: string; profile_id: string;
          category: "preference" | "history" | "observation" | "group" | "dislike";
          content: string; confidence: "low" | "medium" | "high";
          source_trip_id: string | null; source_context: string | null;
          active: boolean; created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      ai_conversations: {
        Row: {
          id: string; trip_id: string; member_id: string; messages: AIMessage[];
          created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      journal_entries: {
        Row: {
          id: string; trip_id: string; stop_id: string | null; member_id: string;
          entry_type: "text" | "photo" | "voice"; content: string | null;
          media_url: string | null; captured_at: string; created_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
    };
    Views: {};
    Functions: {};
  };
};

export type Trip = Database["public"]["Tables"]["trips"]["Row"];
export type TripMember = Database["public"]["Tables"]["trip_members"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Day = Database["public"]["Tables"]["days"]["Row"];
export type Stop = Database["public"]["Tables"]["stops"]["Row"];
export type Vote = Database["public"]["Tables"]["votes"]["Row"];
export type Proposal = Database["public"]["Tables"]["proposals"]["Row"];
export type AIConversation = Database["public"]["Tables"]["ai_conversations"]["Row"];
export type JournalEntry = Database["public"]["Tables"]["journal_entries"]["Row"];

export interface StopWithVotes extends Stop { votes: Vote[]; vote_count: number; }
export interface DayWithStops extends Day { stops: StopWithVotes[]; }
export interface TripFull extends Trip { members: TripMember[]; days: DayWithStops[]; pending_proposals: Proposal[]; }
