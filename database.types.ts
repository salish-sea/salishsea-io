export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      observation_photos: {
        Row: {
          href: string
          id: number
          license_code: string
          observation_id: string
          seq: number
        }
        Insert: {
          href: string
          id?: never
          license_code: string
          observation_id: string
          seq: number
        }
        Update: {
          href?: string
          id?: never
          license_code?: string
          observation_id?: string
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "sighting_photos_sighting_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "observations"
            referencedColumns: ["id"]
          },
        ]
      }
      observations: {
        Row: {
          accuracy: number | null
          body: string | null
          count: number | null
          created_at: string
          direction: Database["public"]["Enums"]["travel_direction"] | null
          id: string
          observed_at: string
          observer_location: unknown
          subject_location: unknown
          taxon_id: number
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          accuracy?: number | null
          body?: string | null
          count?: number | null
          created_at: string
          direction?: Database["public"]["Enums"]["travel_direction"] | null
          id: string
          observed_at: string
          observer_location?: unknown
          subject_location: unknown
          taxon_id: number
          updated_at: string
          url?: string | null
          user_id: string
        }
        Update: {
          accuracy?: number | null
          body?: string | null
          count?: number | null
          created_at?: string
          direction?: Database["public"]["Enums"]["travel_direction"] | null
          id?: string
          observed_at?: string
          observer_location?: unknown
          subject_location?: unknown
          taxon_id?: number
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          email: string
          family_name: string | null
          given_name: string | null
          iat: string
          id: number
          name: string | null
          nickname: string
          picture: string | null
          sub: string
        }
        Insert: {
          email: string
          family_name?: string | null
          given_name?: string | null
          iat: string
          id?: never
          name?: string | null
          nickname: string
          picture?: string | null
          sub: string
        }
        Update: {
          email?: string
          family_name?: string | null
          given_name?: string | null
          iat?: string
          id?: never
          name?: string | null
          nickname?: string
          picture?: string | null
          sub?: string
        }
        Relationships: []
      }
    }
    Views: {
      occurrences: {
        Row: {
          accuracy: number | null
          attribution: string | null
          body: string | null
          count: number | null
          direction: Database["public"]["Enums"]["travel_direction"] | null
          id: string | null
          identifiers: string[] | null
          is_own_observation: boolean | null
          location: Database["public"]["CompositeTypes"]["lon_lat"] | null
          observed_at: string | null
          observed_from: Database["public"]["CompositeTypes"]["lon_lat"] | null
          photos:
            | Database["public"]["CompositeTypes"]["occurrence_photo"][]
            | null
          taxon: Database["public"]["CompositeTypes"]["taxon"] | null
          url: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      extract_identifiers: { Args: { body: string }; Returns: string[] }
      extract_travel_direction: {
        Args: { body: string }
        Returns: Database["public"]["Enums"]["travel_direction"]
      }
      local_date: {
        Args: { occurrence: Database["public"]["Views"]["occurrences"]["Row"] }
        Returns: string
      }
      upsert_observation: {
        Args: {
          accuracy: number
          body: string
          count: number
          direction: Database["public"]["Enums"]["travel_direction"]
          id: string
          location: Database["public"]["CompositeTypes"]["lon_lat"]
          observed_at: string
          observed_from: Database["public"]["CompositeTypes"]["lon_lat"]
          photos: Database["public"]["CompositeTypes"]["occurrence_photo"][]
          taxon: string
          url: string
        }
        Returns: string
      }
    }
    Enums: {
      license:
        | "cc0"
        | "cc-by"
        | "cc-by-nc"
        | "cc-by-sa"
        | "cc-by-nd"
        | "cc-by-nc-sa"
        | "cc-by-nc-nd"
        | "none"
      sex: "male" | "female"
      travel_direction:
        | "north"
        | "northeast"
        | "east"
        | "southeast"
        | "south"
        | "southwest"
        | "west"
        | "northwest"
    }
    CompositeTypes: {
      dimensions: {
        height: number | null
        width: number | null
      }
      lat_lng: {
        lat: number | null
        lng: number | null
      }
      lon_lat: {
        lon: number | null
        lat: number | null
      }
      occurrence_photo: {
        attribution: string | null
        mimetype: string | null
        src: string | null
        thumb: string | null
        license: Database["public"]["Enums"]["license"] | null
      }
      taxon: {
        scientific_name: string | null
        vernacular_name: string | null
        species_id: number | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      license: [
        "cc0",
        "cc-by",
        "cc-by-nc",
        "cc-by-sa",
        "cc-by-nd",
        "cc-by-nc-sa",
        "cc-by-nc-nd",
        "none",
      ],
      sex: ["male", "female"],
      travel_direction: [
        "north",
        "northeast",
        "east",
        "southeast",
        "south",
        "southwest",
        "west",
        "northwest",
      ],
    },
  },
} as const

