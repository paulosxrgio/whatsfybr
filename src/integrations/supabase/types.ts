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
      account_settings: {
        Row: {
          ai_model: string | null
          ai_provider: string | null
          anthropic_api_key: string | null
          created_at: string | null
          id: string
          openai_api_key: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          ai_model?: string | null
          ai_provider?: string | null
          anthropic_api_key?: string | null
          created_at?: string | null
          id?: string
          openai_api_key?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          ai_model?: string | null
          ai_provider?: string | null
          anthropic_api_key?: string | null
          created_at?: string | null
          id?: string
          openai_api_key?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      auto_reply_queue: {
        Row: {
          created_at: string | null
          id: string
          message_count: number | null
          pending_since: string | null
          scheduled_for: string | null
          status: string | null
          store_id: string
          ticket_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          message_count?: number | null
          pending_since?: string | null
          scheduled_for?: string | null
          status?: string | null
          store_id: string
          ticket_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          message_count?: number | null
          pending_since?: string | null
          scheduled_for?: string | null
          status?: string | null
          store_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_reply_queue_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_reply_queue_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_memory: {
        Row: {
          customer_email: string | null
          customer_name: string | null
          customer_phone: string
          id: string
          last_sentiment: string | null
          notes: string | null
          preferred_language: string | null
          store_id: string
          total_interactions: number | null
          updated_at: string | null
        }
        Insert: {
          customer_email?: string | null
          customer_name?: string | null
          customer_phone: string
          id?: string
          last_sentiment?: string | null
          notes?: string | null
          preferred_language?: string | null
          store_id: string
          total_interactions?: number | null
          updated_at?: string | null
        }
        Update: {
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string
          id?: string
          last_sentiment?: string | null
          notes?: string | null
          preferred_language?: string | null
          store_id?: string
          total_interactions?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_memory_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          chat_lid: string | null
          content: string | null
          created_at: string | null
          delivery_callback_payload: Json | null
          delivery_error: string | null
          delivery_status: string | null
          delivery_updated_at: string | null
          direction: string
          id: string
          media_url: string | null
          message_type: string | null
          source: string | null
          store_id: string
          ticket_id: string
          zapi_id: string | null
          zapi_message_id: string | null
          zapi_response: Json | null
          zapi_zaap_id: string | null
        }
        Insert: {
          chat_lid?: string | null
          content?: string | null
          created_at?: string | null
          delivery_callback_payload?: Json | null
          delivery_error?: string | null
          delivery_status?: string | null
          delivery_updated_at?: string | null
          direction: string
          id?: string
          media_url?: string | null
          message_type?: string | null
          source?: string | null
          store_id: string
          ticket_id: string
          zapi_id?: string | null
          zapi_message_id?: string | null
          zapi_response?: Json | null
          zapi_zaap_id?: string | null
        }
        Update: {
          chat_lid?: string | null
          content?: string | null
          created_at?: string | null
          delivery_callback_payload?: Json | null
          delivery_error?: string | null
          delivery_status?: string | null
          delivery_updated_at?: string | null
          direction?: string
          id?: string
          media_url?: string | null
          message_type?: string | null
          source?: string | null
          store_id?: string
          ticket_id?: string
          zapi_id?: string | null
          zapi_message_id?: string | null
          zapi_response?: Json | null
          zapi_zaap_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      requests: {
        Row: {
          created_at: string | null
          customer_name: string | null
          customer_phone: string | null
          description: string | null
          details: Json | null
          id: string
          order_id: string | null
          order_name: string | null
          status: string | null
          store_id: string
          ticket_id: string
          type: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          description?: string | null
          details?: Json | null
          id?: string
          order_id?: string | null
          order_name?: string | null
          status?: string | null
          store_id: string
          ticket_id: string
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          description?: string | null
          details?: Json | null
          id?: string
          order_id?: string | null
          order_name?: string | null
          status?: string | null
          store_id?: string
          ticket_id?: string
          type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "requests_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          ai_is_active: boolean | null
          ai_model: string | null
          ai_provider: string | null
          ai_response_delay: number | null
          ai_system_prompt: string | null
          anthropic_api_key: string | null
          cerebro_corpus_knowledge: string | null
          cerebro_memory: string | null
          corpus_analyzed_at: string | null
          corpus_pairs_analyzed: number | null
          created_at: string | null
          id: string
          notify_order_fulfilled: boolean | null
          openai_api_key: string | null
          shopify_client_id: string | null
          shopify_client_secret: string | null
          shopify_store_url: string | null
          store_id: string
          zapi_client_token: string | null
          zapi_instance_id: string | null
          zapi_token: string | null
        }
        Insert: {
          ai_is_active?: boolean | null
          ai_model?: string | null
          ai_provider?: string | null
          ai_response_delay?: number | null
          ai_system_prompt?: string | null
          anthropic_api_key?: string | null
          cerebro_corpus_knowledge?: string | null
          cerebro_memory?: string | null
          corpus_analyzed_at?: string | null
          corpus_pairs_analyzed?: number | null
          created_at?: string | null
          id?: string
          notify_order_fulfilled?: boolean | null
          openai_api_key?: string | null
          shopify_client_id?: string | null
          shopify_client_secret?: string | null
          shopify_store_url?: string | null
          store_id: string
          zapi_client_token?: string | null
          zapi_instance_id?: string | null
          zapi_token?: string | null
        }
        Update: {
          ai_is_active?: boolean | null
          ai_model?: string | null
          ai_provider?: string | null
          ai_response_delay?: number | null
          ai_system_prompt?: string | null
          anthropic_api_key?: string | null
          cerebro_corpus_knowledge?: string | null
          cerebro_memory?: string | null
          corpus_analyzed_at?: string | null
          corpus_pairs_analyzed?: number | null
          created_at?: string | null
          id?: string
          notify_order_fulfilled?: boolean | null
          openai_api_key?: string | null
          shopify_client_id?: string | null
          shopify_client_secret?: string | null
          shopify_store_url?: string | null
          store_id?: string
          zapi_client_token?: string | null
          zapi_instance_id?: string | null
          zapi_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settings_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          created_at: string | null
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      supervisor_reports: {
        Row: {
          created_at: string | null
          critical_errors: Json | null
          date: string
          id: string
          patterns_found: Json | null
          prompt_additions: Json | null
          score: number | null
          store_id: string
          summary: string | null
          tickets_analyzed: number | null
        }
        Insert: {
          created_at?: string | null
          critical_errors?: Json | null
          date?: string
          id?: string
          patterns_found?: Json | null
          prompt_additions?: Json | null
          score?: number | null
          store_id: string
          summary?: string | null
          tickets_analyzed?: number | null
        }
        Update: {
          created_at?: string | null
          critical_errors?: Json | null
          date?: string
          id?: string
          patterns_found?: Json | null
          prompt_additions?: Json | null
          score?: number | null
          store_id?: string
          summary?: string | null
          tickets_analyzed?: number | null
        }
        Relationships: []
      }
      tickets: {
        Row: {
          ai_paused: boolean | null
          ai_paused_at: string | null
          created_at: string | null
          customer_lid: string | null
          customer_name: string | null
          customer_phone: string
          id: string
          intent: string | null
          last_message_at: string | null
          sentiment: string | null
          status: string | null
          store_id: string
        }
        Insert: {
          ai_paused?: boolean | null
          ai_paused_at?: string | null
          created_at?: string | null
          customer_lid?: string | null
          customer_name?: string | null
          customer_phone: string
          id?: string
          intent?: string | null
          last_message_at?: string | null
          sentiment?: string | null
          status?: string | null
          store_id: string
        }
        Update: {
          ai_paused?: boolean | null
          ai_paused_at?: string | null
          created_at?: string | null
          customer_lid?: string | null
          customer_name?: string | null
          customer_phone?: string
          id?: string
          intent?: string | null
          last_message_at?: string | null
          sentiment?: string | null
          status?: string | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      training_examples: {
        Row: {
          applied: boolean | null
          created_at: string | null
          customer_input: string | null
          id: string
          ideal_response: string
          source: string | null
          store_id: string
          ticket_id: string | null
        }
        Insert: {
          applied?: boolean | null
          created_at?: string | null
          customer_input?: string | null
          id?: string
          ideal_response: string
          source?: string | null
          store_id: string
          ticket_id?: string | null
        }
        Update: {
          applied?: boolean | null
          created_at?: string | null
          customer_input?: string | null
          id?: string
          ideal_response?: string
          source?: string | null
          store_id?: string
          ticket_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_notifications: {
        Row: {
          carrier: string | null
          created_at: string | null
          customer_name: string | null
          customer_phone: string
          error_message: string | null
          event_type: string
          id: string
          message_content: string | null
          order_number: string | null
          sent_at: string | null
          shopify_order_id: string
          status: string
          store_id: string
          tracking_code: string | null
          tracking_url: string | null
        }
        Insert: {
          carrier?: string | null
          created_at?: string | null
          customer_name?: string | null
          customer_phone: string
          error_message?: string | null
          event_type?: string
          id?: string
          message_content?: string | null
          order_number?: string | null
          sent_at?: string | null
          shopify_order_id: string
          status?: string
          store_id: string
          tracking_code?: string | null
          tracking_url?: string | null
        }
        Update: {
          carrier?: string | null
          created_at?: string | null
          customer_name?: string | null
          customer_phone?: string
          error_message?: string | null
          event_type?: string
          id?: string
          message_content?: string | null
          order_number?: string | null
          sent_at?: string | null
          shopify_order_id?: string
          status?: string
          store_id?: string
          tracking_code?: string | null
          tracking_url?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      upsert_reply_queue: {
        Args: {
          p_scheduled_for: string
          p_store_id: string
          p_ticket_id: string
        }
        Returns: undefined
      }
      user_store_ids: { Args: never; Returns: string[] }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
