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
      collections: {
        Row: {
          id: number
          kind: Database["public"]["Enums"]["collection_kind"] | null
          name: string
          organization_id: number | null
          slug: string
        }
        Insert: {
          id?: number
          kind?: Database["public"]["Enums"]["collection_kind"] | null
          name: string
          organization_id?: number | null
          slug: string
        }
        Update: {
          id?: number
          kind?: Database["public"]["Enums"]["collection_kind"] | null
          name?: string
          organization_id?: number | null
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "collections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contributor_email_addresses: {
        Row: {
          contributor_id: number
          email_address: string
        }
        Insert: {
          contributor_id: number
          email_address: string
        }
        Update: {
          contributor_id?: number
          email_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "contributor_email_addresses_contributor_id_fkey"
            columns: ["contributor_id"]
            isOneToOne: false
            referencedRelation: "contributors"
            referencedColumns: ["id"]
          },
        ]
      }
      contributors: {
        Row: {
          editor: boolean
          entity_id: string
          id: number
          inat_login: string | null
          name: string
          orcid: string | null
          picture: string | null
        }
        Insert: {
          editor?: boolean
          entity_id?: string
          id?: number
          inat_login?: string | null
          name: string
          orcid?: string | null
          picture?: string | null
        }
        Update: {
          editor?: boolean
          entity_id?: string
          id?: number
          inat_login?: string | null
          name?: string
          orcid?: string | null
          picture?: string | null
        }
        Relationships: []
      }
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
          collection_id: number | null
          contributor_id: number | null
          count: number | null
          created_at: string
          direction: Database["public"]["Enums"]["travel_direction"] | null
          id: string
          observed_at: string
          observer_location: unknown
          provider_id: number
          source_url: string | null
          subject_location: unknown
          taxon_id: number
          updated_at: string
          url: string | null
          user_uuid: string
        }
        Insert: {
          accuracy?: number | null
          body?: string | null
          collection_id?: number | null
          contributor_id?: number | null
          count?: number | null
          created_at: string
          direction?: Database["public"]["Enums"]["travel_direction"] | null
          id: string
          observed_at: string
          observer_location?: unknown
          provider_id?: number
          source_url?: string | null
          subject_location: unknown
          taxon_id: number
          updated_at: string
          url?: string | null
          user_uuid: string
        }
        Update: {
          accuracy?: number | null
          body?: string | null
          collection_id?: number | null
          contributor_id?: number | null
          count?: number | null
          created_at?: string
          direction?: Database["public"]["Enums"]["travel_direction"] | null
          id?: string
          observed_at?: string
          observer_location?: unknown
          provider_id?: number
          source_url?: string | null
          subject_location?: unknown
          taxon_id?: number
          updated_at?: string
          url?: string | null
          user_uuid?: string
        }
        Relationships: [
          {
            foreignKeyName: "observations_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observations_contributor_id_fkey"
            columns: ["contributor_id"]
            isOneToOne: false
            referencedRelation: "contributors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observations_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          id: number
          name: string
          rights_holder_text: string
          slug: string
          url: string
        }
        Insert: {
          id?: number
          name: string
          rights_holder_text: string
          slug: string
          url: string
        }
        Update: {
          id?: number
          name?: string
          rights_holder_text?: string
          slug?: string
          url?: string
        }
        Relationships: []
      }
      providers: {
        Row: {
          id: number
          name: string
          slug: string
        }
        Insert: {
          id?: number
          name: string
          slug: string
        }
        Update: {
          id?: number
          name?: string
          slug?: string
        }
        Relationships: []
      }
      user_contributor: {
        Row: {
          contributor_id: number
          user_uuid: string
        }
        Insert: {
          contributor_id: number
          user_uuid: string
        }
        Update: {
          contributor_id?: number
          user_uuid?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_contributor_contributor_id_fkey"
            columns: ["contributor_id"]
            isOneToOne: false
            referencedRelation: "contributors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      occurrences: {
        Row: {
          accuracy: number | null
          attribution: string | null
          body: string | null
          contributor_id: number | null
          count: number | null
          direction: Database["public"]["Enums"]["travel_direction"] | null
          id: string | null
          identifiers: string[] | null
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
      collection_kind:
        | "facebook_group"
        | "research_dataset"
        | "acoustic_feed"
        | "detector"
        | "direct_app"
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
      collection_kind: [
        "facebook_group",
        "research_dataset",
        "acoustic_feed",
        "detector",
        "direct_app",
      ],
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

