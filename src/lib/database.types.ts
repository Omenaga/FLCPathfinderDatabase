export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      current_data: {
        Row: {
          created_at: string
          current_activities: Json | null
          current_title: string | null
          pathfinder_id: number
          school_year: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_activities?: Json | null
          current_title?: string | null
          pathfinder_id: number
          school_year?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_activities?: Json | null
          current_title?: string | null
          pathfinder_id?: number
          school_year?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "current_data_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: true
            referencedRelation: "member_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "current_data_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: true
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      drill: {
        Row: {
          history_role: string
          id: number
          pathfinder_id: number
          team: string | null
          years: Json
        }
        Insert: {
          history_role?: string
          id?: never
          pathfinder_id: number
          team?: string | null
          years: Json
        }
        Update: {
          history_role?: string
          id?: never
          pathfinder_id?: number
          team?: string | null
          years?: Json
        }
        Relationships: [
          {
            foreignKeyName: "drill_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "member_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drill_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      drum_corps: {
        Row: {
          history_role: string
          id: number
          pathfinder_id: number
          history: Json
        }
        Insert: {
          history_role?: string
          id?: never
          pathfinder_id: number
          history: Json
        }
        Update: {
          history_role?: string
          id?: never
          pathfinder_id?: number
          history?: Json
        }
        Relationships: [
          {
            foreignKeyName: "drum_corps_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "member_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drum_corps_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      honors: {
        Row: {
          id: number
          name: string
        }
        Insert: {
          id?: never
          name: string
        }
        Update: {
          id?: never
          name?: string
        }
        Relationships: []
      }
      honors_earned: {
        Row: {
          history_role: string
          honor_id: number
          id: number
          pathfinder_id: number
          year_earned: string
        }
        Insert: {
          history_role?: string
          honor_id: number
          id?: never
          pathfinder_id: number
          year_earned: string
        }
        Update: {
          history_role?: string
          honor_id?: number
          id?: never
          pathfinder_id?: number
          year_earned?: string
        }
        Relationships: [
          {
            foreignKeyName: "honors_earned_honor_id_fkey"
            columns: ["honor_id"]
            isOneToOne: false
            referencedRelation: "honors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "honors_earned_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "member_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "honors_earned_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      pathfinders: {
        Row: {
          birth_date: string | null
          created_at: string
          first_name: string
          id: number
          last_name: string
          levels: Json
          notes: string | null
          updated_at: string
          years_active: Json
        }
        Insert: {
          birth_date?: string | null
          created_at?: string
          first_name: string
          id?: never
          last_name?: string
          levels?: Json
          notes?: string | null
          updated_at?: string
          years_active?: Json
        }
        Update: {
          birth_date?: string | null
          created_at?: string
          first_name?: string
          id?: never
          last_name?: string
          levels?: Json
          notes?: string | null
          updated_at?: string
          years_active?: Json
        }
        Relationships: []
      }
      pbe: {
        Row: {
          history: Json
          history_role: string
          id: number
          pathfinder_id: number
        }
        Insert: {
          history: Json
          history_role?: string
          id?: never
          pathfinder_id: number
        }
        Update: {
          history?: Json
          history_role?: string
          id?: never
          pathfinder_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "pbe_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "member_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pbe_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      pbe_year_books: {
        Row: {
          book_name: string
          school_year: string
        }
        Insert: {
          book_name: string
          school_year: string
        }
        Update: {
          book_name?: string
          school_year?: string
        }
        Relationships: []
      }
      red_zone_archery: {
        Row: {
          history_role: string
          id: number
          pathfinder_id: number
          placement: string
          year: string
        }
        Insert: {
          history_role?: string
          id?: never
          pathfinder_id: number
          placement: string
          year: string
        }
        Update: {
          history_role?: string
          id?: never
          pathfinder_id?: number
          placement?: string
          year?: string
        }
        Relationships: [
          {
            foreignKeyName: "red_zone_archery_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "member_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "red_zone_archery_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      red_zone_bible_events: {
        Row: {
          history_role: string
          id: number
          name: string
          pathfinder_id: number
          placement: string
          year: string
        }
        Insert: {
          history_role?: string
          id?: never
          name: string
          pathfinder_id: number
          placement: string
          year: string
        }
        Update: {
          history_role?: string
          id?: never
          name?: string
          pathfinder_id?: number
          placement?: string
          year?: string
        }
        Relationships: [
          {
            foreignKeyName: "red_zone_bible_events_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "member_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "red_zone_bible_events_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      red_zone_burning_twine: {
        Row: {
          history_role: string
          id: number
          pathfinder_id: number
          placement: string
          year: string
        }
        Insert: {
          history_role?: string
          id?: never
          pathfinder_id: number
          placement: string
          year: string
        }
        Update: {
          history_role?: string
          id?: never
          pathfinder_id?: number
          placement?: string
          year?: string
        }
        Relationships: [
          {
            foreignKeyName: "red_zone_burning_twine_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "member_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "red_zone_burning_twine_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      red_zone_drill_performance: {
        Row: {
          history_role: string
          id: number
          pathfinder_id: number
          placement: string
          year: string
        }
        Insert: {
          history_role?: string
          id?: never
          pathfinder_id: number
          placement: string
          year: string
        }
        Update: {
          history_role?: string
          id?: never
          pathfinder_id?: number
          placement?: string
          year?: string
        }
        Relationships: [
          {
            foreignKeyName: "red_zone_drill_performance_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "member_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "red_zone_drill_performance_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      red_zone_drum_performance: {
        Row: {
          history_role: string
          id: number
          pathfinder_id: number
          placement: string
          year: string
        }
        Insert: {
          history_role?: string
          id?: never
          pathfinder_id: number
          placement: string
          year: string
        }
        Update: {
          history_role?: string
          id?: never
          pathfinder_id?: number
          placement?: string
          year?: string
        }
        Relationships: [
          {
            foreignKeyName: "red_zone_drum_performance_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "member_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "red_zone_drum_performance_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      red_zone_honor_evaluations: {
        Row: {
          history_role: string
          id: number
          name: string
          pathfinder_id: number
          placement: string
          year: string
        }
        Insert: {
          history_role?: string
          id?: never
          name: string
          pathfinder_id: number
          placement: string
          year: string
        }
        Update: {
          history_role?: string
          id?: never
          name?: string
          pathfinder_id?: number
          placement?: string
          year?: string
        }
        Relationships: [
          {
            foreignKeyName: "red_zone_honor_evaluations_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "member_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "red_zone_honor_evaluations_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      red_zone_jump_rope: {
        Row: {
          history_role: string
          id: number
          pathfinder_id: number
          placement: string
          year: string
        }
        Insert: {
          history_role?: string
          id?: never
          pathfinder_id: number
          placement: string
          year: string
        }
        Update: {
          history_role?: string
          id?: never
          pathfinder_id?: number
          placement?: string
          year?: string
        }
        Relationships: [
          {
            foreignKeyName: "red_zone_jump_rope_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "member_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "red_zone_jump_rope_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      red_zone_knots: {
        Row: {
          history_role: string
          id: number
          pathfinder_id: number
          placement: string
          year: string
        }
        Insert: {
          history_role?: string
          id?: never
          pathfinder_id: number
          placement: string
          year: string
        }
        Update: {
          history_role?: string
          id?: never
          pathfinder_id?: number
          placement?: string
          year?: string
        }
        Relationships: [
          {
            foreignKeyName: "red_zone_knots_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "member_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "red_zone_knots_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      red_zone_lashing: {
        Row: {
          history_role: string
          id: number
          pathfinder_id: number
          placement: string
          year: string
        }
        Insert: {
          history_role?: string
          id?: never
          pathfinder_id: number
          placement: string
          year: string
        }
        Update: {
          history_role?: string
          id?: never
          pathfinder_id?: number
          placement?: string
          year?: string
        }
        Relationships: [
          {
            foreignKeyName: "red_zone_lashing_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "member_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "red_zone_lashing_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      red_zone_tents: {
        Row: {
          history_role: string
          id: number
          pathfinder_id: number
          placement: string
          year: string
        }
        Insert: {
          history_role?: string
          id?: never
          pathfinder_id: number
          placement: string
          year: string
        }
        Update: {
          history_role?: string
          id?: never
          pathfinder_id?: number
          placement?: string
          year?: string
        }
        Relationships: [
          {
            foreignKeyName: "red_zone_tents_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "member_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "red_zone_tents_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_history: {
        Row: {
          id: number
          pathfinder_id: number
          history: Json
        }
        Insert: {
          id?: never
          pathfinder_id: number
          history: Json
        }
        Update: {
          id?: never
          pathfinder_id?: number
          history?: Json
        }
        Relationships: [
          {
            foreignKeyName: "staff_history_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: true
            referencedRelation: "member_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_history_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: true
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_titles: {
        Row: {
          title: string
        }
        Insert: {
          title: string
        }
        Update: {
          title?: string
        }
        Relationships: []
      }
      tlt: {
        Row: {
          history: Json
          history_role: string
          id: number
          pathfinder_id: number
        }
        Insert: {
          history: Json
          history_role?: string
          id?: never
          pathfinder_id: number
        }
        Update: {
          history?: Json
          history_role?: string
          id?: never
          pathfinder_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "tlt_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "member_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tlt_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      member_search: {
        Row: {
          created_at: string | null
          current_activities: Json | null
          current_title: string | null
          first_name: string | null
          has_current_data: boolean | null
          id: number | null
          last_name: string | null
          levels: Json | null
          name: string | null
          search_activities: Json | null
          search_activity_details: Json | null
          search_activity_years: Json | null
          search_event_details: Json | null
          search_event_years: Json | null
          search_events: Json | null
          search_years: Json | null
          status: string | null
          updated_at: string | null
          years_active: Json | null
        }
        Relationships: []
      }
    }
    Functions: {
      current_club_year: { Args: never; Returns: string }
      current_staff_role: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
