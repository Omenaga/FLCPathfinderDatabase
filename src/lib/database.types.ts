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
      drill: {
        Row: {
          pathfinder_id: number
          years: Json
        }
        Insert: {
          pathfinder_id: number
          years: Json
        }
        Update: {
          pathfinder_id?: number
          years?: Json
        }
        Relationships: [
          {
            foreignKeyName: "drill_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: true
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      drum_corps: {
        Row: {
          drum_played: string
          id: number
          pathfinder_id: number
          years: Json
        }
        Insert: {
          drum_played: string
          id?: never
          pathfinder_id: number
          years: Json
        }
        Update: {
          drum_played?: string
          id?: never
          pathfinder_id?: number
          years?: Json
        }
        Relationships: [
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
          honor_id: number
          id: number
          pathfinder_id: number
          year_earned: number
        }
        Insert: {
          honor_id: number
          id?: never
          pathfinder_id: number
          year_earned: number
        }
        Update: {
          honor_id?: number
          id?: never
          pathfinder_id?: number
          year_earned?: number
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
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      pathfinders: {
        Row: {
          created_at: string
          extracurriculars: Json
          id: number
          levels: Json
          name: string
          red_zone_participation: Json
          updated_at: string
          years_active: Json
        }
        Insert: {
          created_at?: string
          extracurriculars?: Json
          id?: never
          levels?: Json
          name: string
          red_zone_participation?: Json
          updated_at?: string
          years_active?: Json
        }
        Update: {
          created_at?: string
          extracurriculars?: Json
          id?: never
          levels?: Json
          name?: string
          red_zone_participation?: Json
          updated_at?: string
          years_active?: Json
        }
        Relationships: []
      }
      pbe: {
        Row: {
          bible_book: string
          id: number
          pathfinder_id: number
          years: Json
        }
        Insert: {
          bible_book: string
          id?: never
          pathfinder_id: number
          years: Json
        }
        Update: {
          bible_book?: string
          id?: never
          pathfinder_id?: number
          years?: Json
        }
        Relationships: [
          {
            foreignKeyName: "pbe_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      red_zone_archery: {
        Row: {
          id: number
          pathfinder_id: number
          placement: string
          year: number
        }
        Insert: {
          id?: never
          pathfinder_id: number
          placement: string
          year: number
        }
        Update: {
          id?: never
          pathfinder_id?: number
          placement?: string
          year?: number
        }
        Relationships: [
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
          id: number
          name: string
          pathfinder_id: number
          placement: string
          year: number
        }
        Insert: {
          id?: never
          name: string
          pathfinder_id: number
          placement: string
          year: number
        }
        Update: {
          id?: never
          name?: string
          pathfinder_id?: number
          placement?: string
          year?: number
        }
        Relationships: [
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
          id: number
          pathfinder_id: number
          placement: string
          year: number
        }
        Insert: {
          id?: never
          pathfinder_id: number
          placement: string
          year: number
        }
        Update: {
          id?: never
          pathfinder_id?: number
          placement?: string
          year?: number
        }
        Relationships: [
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
          id: number
          pathfinder_id: number
          placement: string
          year: number
        }
        Insert: {
          id?: never
          pathfinder_id: number
          placement: string
          year: number
        }
        Update: {
          id?: never
          pathfinder_id?: number
          placement?: string
          year?: number
        }
        Relationships: [
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
          id: number
          pathfinder_id: number
          placement: string
          year: number
        }
        Insert: {
          id?: never
          pathfinder_id: number
          placement: string
          year: number
        }
        Update: {
          id?: never
          pathfinder_id?: number
          placement?: string
          year?: number
        }
        Relationships: [
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
          id: number
          name: string
          pathfinder_id: number
          placement: string
          year: number
        }
        Insert: {
          id?: never
          name: string
          pathfinder_id: number
          placement: string
          year: number
        }
        Update: {
          id?: never
          name?: string
          pathfinder_id?: number
          placement?: string
          year?: number
        }
        Relationships: [
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
          id: number
          pathfinder_id: number
          placement: string
          year: number
        }
        Insert: {
          id?: never
          pathfinder_id: number
          placement: string
          year: number
        }
        Update: {
          id?: never
          pathfinder_id?: number
          placement?: string
          year?: number
        }
        Relationships: [
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
          id: number
          pathfinder_id: number
          placement: string
          year: number
        }
        Insert: {
          id?: never
          pathfinder_id: number
          placement: string
          year: number
        }
        Update: {
          id?: never
          pathfinder_id?: number
          placement?: string
          year?: number
        }
        Relationships: [
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
          id: number
          pathfinder_id: number
          placement: string
          year: number
        }
        Insert: {
          id?: never
          pathfinder_id: number
          placement: string
          year: number
        }
        Update: {
          id?: never
          pathfinder_id?: number
          placement?: string
          year?: number
        }
        Relationships: [
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
          id: number
          pathfinder_id: number
          placement: string
          year: number
        }
        Insert: {
          id?: never
          pathfinder_id: number
          placement: string
          year: number
        }
        Update: {
          id?: never
          pathfinder_id?: number
          placement?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "red_zone_tents_pathfinder_id_fkey"
            columns: ["pathfinder_id"]
            isOneToOne: false
            referencedRelation: "pathfinders"
            referencedColumns: ["id"]
          },
        ]
      }
      tlt: {
        Row: {
          id: number
          pathfinder_id: number
          tlt_operation: string
          years: Json
        }
        Insert: {
          id?: never
          pathfinder_id: number
          tlt_operation: string
          years: Json
        }
        Update: {
          id?: never
          pathfinder_id?: number
          tlt_operation?: string
          years?: Json
        }
        Relationships: [
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
      [_ in never]: never
    }
    Functions: {
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
