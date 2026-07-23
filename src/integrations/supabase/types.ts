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
      agency_task_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          task_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          task_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agency_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_tasks: {
        Row: {
          archived_at: string | null
          assigned_to: string | null
          attachment_name: string | null
          attachment_path: string | null
          auto: boolean
          client_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          dossier_id: string | null
          due_date: string | null
          id: string
          internal_comment: string | null
          pole_id: string | null
          priority: Database["public"]["Enums"]["agency_task_priority"]
          status: Database["public"]["Enums"]["agency_task_status"]
          task_type: string | null
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assigned_to?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          auto?: boolean
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          dossier_id?: string | null
          due_date?: string | null
          id?: string
          internal_comment?: string | null
          pole_id?: string | null
          priority?: Database["public"]["Enums"]["agency_task_priority"]
          status?: Database["public"]["Enums"]["agency_task_status"]
          task_type?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assigned_to?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          auto?: boolean
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          dossier_id?: string | null
          due_date?: string | null
          id?: string
          internal_comment?: string | null
          pole_id?: string | null
          priority?: Database["public"]["Enums"]["agency_task_priority"]
          status?: Database["public"]["Enums"]["agency_task_status"]
          task_type?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_tasks_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_tasks_pole_id_fkey"
            columns: ["pole_id"]
            isOneToOne: false
            referencedRelation: "poles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip: string | null
          metadata: Json
          severity: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip?: string | null
          metadata?: Json
          severity?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip?: string | null
          metadata?: Json
          severity?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      client_ephemeral_settings: {
        Row: {
          client_id: string
          ephemeral_duration_seconds: number | null
          ephemeral_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: string
          ephemeral_duration_seconds?: number | null
          ephemeral_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          ephemeral_duration_seconds?: number | null
          ephemeral_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      client_notes: {
        Row: {
          author_id: string
          client_id: string
          contenu: string
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          client_id: string
          contenu: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          client_id?: string
          contenu?: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consents: {
        Row: {
          accepted_at: string
          document_type: string
          id: string
          ip: string | null
          user_agent: string | null
          user_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          document_type: string
          id?: string
          ip?: string | null
          user_agent?: string | null
          user_id: string
          version: string
        }
        Update: {
          accepted_at?: string
          document_type?: string
          id?: string
          ip?: string | null
          user_agent?: string | null
          user_id?: string
          version?: string
        }
        Relationships: []
      }
      conversation_members: {
        Row: {
          added_at: string
          conversation_id: string
          role: string
          user_id: string
        }
        Insert: {
          added_at?: string
          conversation_id: string
          role?: string
          user_id: string
        }
        Update: {
          added_at?: string
          conversation_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          created_by: string
          ephemeral_duration_seconds: number | null
          ephemeral_enabled: boolean
          ephemeral_members_can_edit: boolean
          id: string
          parent_id: string | null
          titre: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          ephemeral_duration_seconds?: number | null
          ephemeral_enabled?: boolean
          ephemeral_members_can_edit?: boolean
          id?: string
          parent_id?: string | null
          titre: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          ephemeral_duration_seconds?: number | null
          ephemeral_enabled?: boolean
          ephemeral_members_can_edit?: boolean
          id?: string
          parent_id?: string | null
          titre?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_direction_reports: {
        Row: {
          actions_count: number
          active_users_count: number
          client_reports_json: Json
          created_at: string
          documents_count: number
          dossiers_modified_count: number
          generated_by: string | null
          hourly_activity_json: Json
          id: string
          messages_count: number
          pole_reports_json: Json
          relances_count: number
          report_date: string
          summary_json: Json
          updated_at: string
          user_reports_json: Json
        }
        Insert: {
          actions_count?: number
          active_users_count?: number
          client_reports_json?: Json
          created_at?: string
          documents_count?: number
          dossiers_modified_count?: number
          generated_by?: string | null
          hourly_activity_json?: Json
          id?: string
          messages_count?: number
          pole_reports_json?: Json
          relances_count?: number
          report_date: string
          summary_json?: Json
          updated_at?: string
          user_reports_json?: Json
        }
        Update: {
          actions_count?: number
          active_users_count?: number
          client_reports_json?: Json
          created_at?: string
          documents_count?: number
          dossiers_modified_count?: number
          generated_by?: string | null
          hourly_activity_json?: Json
          id?: string
          messages_count?: number
          pole_reports_json?: Json
          relances_count?: number
          report_date?: string
          summary_json?: Json
          updated_at?: string
          user_reports_json?: Json
        }
        Relationships: []
      }
      deletion_requests: {
        Row: {
          admin_notes: string | null
          id: string
          processed_at: string | null
          processed_by: string | null
          reason: string | null
          requested_at: string
          status: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          id?: string
          processed_at?: string | null
          processed_by?: string | null
          reason?: string | null
          requested_at?: string
          status?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          id?: string
          processed_at?: string | null
          processed_by?: string | null
          reason?: string | null
          requested_at?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          commentaire: string | null
          created_at: string
          detected_at: string | null
          detected_type: string | null
          detection_confidence: number | null
          dossier_id: string
          duration_seconds: number | null
          from_agence: boolean
          id: string
          mime_type: string | null
          nom: string
          statut: string
          storage_path: string | null
          taille: number | null
          thumbnail_path: string | null
          uploader_id: string
        }
        Insert: {
          commentaire?: string | null
          created_at?: string
          detected_at?: string | null
          detected_type?: string | null
          detection_confidence?: number | null
          dossier_id: string
          duration_seconds?: number | null
          from_agence?: boolean
          id?: string
          mime_type?: string | null
          nom: string
          statut?: string
          storage_path?: string | null
          taille?: number | null
          thumbnail_path?: string | null
          uploader_id: string
        }
        Update: {
          commentaire?: string | null
          created_at?: string
          detected_at?: string | null
          detected_type?: string | null
          detection_confidence?: number | null
          dossier_id?: string
          duration_seconds?: number | null
          from_agence?: boolean
          id?: string
          mime_type?: string | null
          nom?: string
          statut?: string
          storage_path?: string | null
          taille?: number | null
          thumbnail_path?: string | null
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      dossier_assignments: {
        Row: {
          active: boolean
          assigned_at: string
          assigned_by: string | null
          created_at: string
          dossier_id: string
          id: string
          revoked_at: string | null
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          dossier_id: string
          id?: string
          revoked_at?: string | null
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          dossier_id?: string
          id?: string
          revoked_at?: string | null
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dossier_assignments_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      dossiers: {
        Row: {
          avancement: number
          categorie: Database["public"]["Enums"]["dossier_categorie"]
          client_id: string
          commentaire_agence: string | null
          created_at: string
          description: string | null
          has_stagiaires: boolean
          id: string
          juridique_type: string | null
          last_relance_at: string | null
          nb_formateurs: number | null
          nb_formations: number | null
          nb_stagiaires: number | null
          organisme_email: string | null
          organisme_nom: string | null
          organisme_telephone: string | null
          pole_id: string
          prochaine_action: string | null
          qualiopi_audit_type: string | null
          qualiopi_scopes: string[]
          responsable_id: string | null
          site_web: string | null
          stagiaires: Json
          statut: Database["public"]["Enums"]["dossier_statut"]
          titre: string
          updated_at: string
        }
        Insert: {
          avancement?: number
          categorie: Database["public"]["Enums"]["dossier_categorie"]
          client_id: string
          commentaire_agence?: string | null
          created_at?: string
          description?: string | null
          has_stagiaires?: boolean
          id?: string
          juridique_type?: string | null
          last_relance_at?: string | null
          nb_formateurs?: number | null
          nb_formations?: number | null
          nb_stagiaires?: number | null
          organisme_email?: string | null
          organisme_nom?: string | null
          organisme_telephone?: string | null
          pole_id: string
          prochaine_action?: string | null
          qualiopi_audit_type?: string | null
          qualiopi_scopes?: string[]
          responsable_id?: string | null
          site_web?: string | null
          stagiaires?: Json
          statut?: Database["public"]["Enums"]["dossier_statut"]
          titre: string
          updated_at?: string
        }
        Update: {
          avancement?: number
          categorie?: Database["public"]["Enums"]["dossier_categorie"]
          client_id?: string
          commentaire_agence?: string | null
          created_at?: string
          description?: string | null
          has_stagiaires?: boolean
          id?: string
          juridique_type?: string | null
          last_relance_at?: string | null
          nb_formateurs?: number | null
          nb_formations?: number | null
          nb_stagiaires?: number | null
          organisme_email?: string | null
          organisme_nom?: string | null
          organisme_telephone?: string | null
          pole_id?: string
          prochaine_action?: string | null
          qualiopi_audit_type?: string | null
          qualiopi_scopes?: string[]
          responsable_id?: string | null
          site_web?: string | null
          stagiaires?: Json
          statut?: Database["public"]["Enums"]["dossier_statut"]
          titre?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dossiers_pole_id_fkey"
            columns: ["pole_id"]
            isOneToOne: false
            referencedRelation: "poles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_settings: {
        Row: {
          admin_email: string
          disabled_templates: string[]
          id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          admin_email?: string
          disabled_templates?: string[]
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          admin_email?: string
          disabled_templates?: string[]
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      group_message_reads: {
        Row: {
          message_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          message_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          message_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_message_reads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      group_messages: {
        Row: {
          attachment_mime: string | null
          attachment_name: string | null
          attachment_path: string | null
          content: string | null
          conversation_id: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          edited_by: string | null
          expires_at: string | null
          id: string
          is_system: boolean
          sender_id: string
        }
        Insert: {
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          content?: string | null
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          edited_by?: string | null
          expires_at?: string | null
          id?: string
          is_system?: boolean
          sender_id: string
        }
        Update: {
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          content?: string | null
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          edited_by?: string | null
          expires_at?: string | null
          id?: string
          is_system?: boolean
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_conversation_members: {
        Row: {
          added_at: string
          conversation_id: string
          favorite: boolean
          last_read_at: string | null
          muted: boolean
          role: string
          user_id: string
        }
        Insert: {
          added_at?: string
          conversation_id: string
          favorite?: boolean
          last_read_at?: string | null
          muted?: boolean
          role?: string
          user_id: string
        }
        Update: {
          added_at?: string
          conversation_id?: string
          favorite?: boolean
          last_read_at?: string | null
          muted?: boolean
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "internal_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_conversations: {
        Row: {
          admin_only_posting: boolean
          archived_at: string | null
          client_id: string | null
          created_at: string
          created_by: string
          description: string | null
          dossier_id: string | null
          ephemeral_duration_seconds: number | null
          ephemeral_enabled: boolean
          ephemeral_members_can_edit: boolean
          id: string
          is_group: boolean
          is_private: boolean
          pole_id: string | null
          task_id: string | null
          titre: string | null
          type: string
          updated_at: string
        }
        Insert: {
          admin_only_posting?: boolean
          archived_at?: string | null
          client_id?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          dossier_id?: string | null
          ephemeral_duration_seconds?: number | null
          ephemeral_enabled?: boolean
          ephemeral_members_can_edit?: boolean
          id?: string
          is_group?: boolean
          is_private?: boolean
          pole_id?: string | null
          task_id?: string | null
          titre?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          admin_only_posting?: boolean
          archived_at?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          dossier_id?: string | null
          ephemeral_duration_seconds?: number | null
          ephemeral_enabled?: boolean
          ephemeral_members_can_edit?: boolean
          id?: string
          is_group?: boolean
          is_private?: boolean
          pole_id?: string | null
          task_id?: string | null
          titre?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_conversations_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_conversations_pole_id_fkey"
            columns: ["pole_id"]
            isOneToOne: false
            referencedRelation: "poles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_conversations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agency_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "internal_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_messages: {
        Row: {
          attachment_mime: string | null
          attachment_name: string | null
          attachment_path: string | null
          content: string | null
          conversation_id: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          expires_at: string | null
          id: string
          is_system: boolean
          mentions_entities: Json
          mentions_users: string[]
          parent_message_id: string | null
          sender_id: string
        }
        Insert: {
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          content?: string | null
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          expires_at?: string | null
          id?: string
          is_system?: boolean
          mentions_entities?: Json
          mentions_users?: string[]
          parent_message_id?: string | null
          sender_id: string
        }
        Update: {
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          content?: string | null
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          expires_at?: string | null
          id?: string
          is_system?: boolean
          mentions_entities?: Json
          mentions_users?: string[]
          parent_message_id?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "internal_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_messages_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "internal_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_deletion_log: {
        Row: {
          client_id: string
          content_hash: string
          content_length: number | null
          deleted_at: string
          deleted_by: string
          deleted_message_id: string
          id: string
          original_author_id: string
        }
        Insert: {
          client_id: string
          content_hash: string
          content_length?: number | null
          deleted_at?: string
          deleted_by: string
          deleted_message_id: string
          id?: string
          original_author_id: string
        }
        Update: {
          client_id?: string
          content_hash?: string
          content_length?: number | null
          deleted_at?: string
          deleted_by?: string
          deleted_message_id?: string
          id?: string
          original_author_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          attachment_mime: string | null
          attachment_name: string | null
          attachment_path: string | null
          client_id: string
          content: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          edited_by: string | null
          expires_at: string | null
          from_agence: boolean
          id: string
          is_system: boolean
          read_at: string | null
          sender_id: string
        }
        Insert: {
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          client_id: string
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          edited_by?: string | null
          expires_at?: string | null
          from_agence?: boolean
          id?: string
          is_system?: boolean
          read_at?: string | null
          sender_id: string
        }
        Update: {
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          client_id?: string
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          edited_by?: string | null
          expires_at?: string | null
          from_agence?: boolean
          id?: string
          is_system?: boolean
          read_at?: string | null
          sender_id?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
          enabled: boolean
          event_type: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          event_type: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          event_type?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_reminders_sent: {
        Row: {
          entity_id: string
          kind: string
          sent_at: string
        }
        Insert: {
          entity_id: string
          kind: string
          sent_at?: string
        }
        Update: {
          entity_id?: string
          kind?: string
          sent_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          link: string | null
          message: string | null
          read_at: string | null
          titre: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          link?: string | null
          message?: string | null
          read_at?: string | null
          titre: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          link?: string | null
          message?: string | null
          read_at?: string | null
          titre?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: []
      }
      pole_members: {
        Row: {
          created_at: string
          id: string
          pole_id: string
          role: Database["public"]["Enums"]["pole_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          pole_id: string
          role?: Database["public"]["Enums"]["pole_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          pole_id?: string
          role?: Database["public"]["Enums"]["pole_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pole_members_pole_id_fkey"
            columns: ["pole_id"]
            isOneToOne: false
            referencedRelation: "poles"
            referencedColumns: ["id"]
          },
        ]
      }
      poles: {
        Row: {
          actif: boolean
          code: string
          couleur: string
          created_at: string
          description: string | null
          id: string
          nom: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code: string
          couleur?: string
          created_at?: string
          description?: string | null
          id?: string
          nom: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code?: string
          couleur?: string
          created_at?: string
          description?: string | null
          id?: string
          nom?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          avatar_url: string | null
          created_at: string
          email: string
          entreprise: string | null
          id: string
          nom: string
          prenom: string
          telephone: string | null
          updated_at: string
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          avatar_url?: string | null
          created_at?: string
          email: string
          entreprise?: string | null
          id: string
          nom?: string
          prenom?: string
          telephone?: string | null
          updated_at?: string
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          avatar_url?: string | null
          created_at?: string
          email?: string
          entreprise?: string | null
          id?: string
          nom?: string
          prenom?: string
          telephone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      push_delivery_logs: {
        Row: {
          created_at: string
          endpoint_hash: string | null
          endpoint_host: string | null
          error_message: string | null
          http_status: number | null
          id: string
          notification_id: string
          sent_at: string
          status: string
          subscription_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint_hash?: string | null
          endpoint_host?: string | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          notification_id: string
          sent_at?: string
          status?: string
          subscription_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          endpoint_hash?: string | null
          endpoint_host?: string | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          notification_id?: string
          sent_at?: string
          status?: string
          subscription_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string | null
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string | null
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string | null
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      qualiopi_criteria: {
        Row: {
          created_at: string
          description: string | null
          id: number
          titre: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id: number
          titre: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: number
          titre?: string
        }
        Relationships: []
      }
      qualiopi_indicators: {
        Row: {
          created_at: string
          criterion_id: number
          description: string | null
          id: number
          libelle_court: string
          numero: number
        }
        Insert: {
          created_at?: string
          criterion_id: number
          description?: string | null
          id: number
          libelle_court: string
          numero: number
        }
        Update: {
          created_at?: string
          criterion_id?: number
          description?: string | null
          id?: number
          libelle_court?: string
          numero?: number
        }
        Relationships: [
          {
            foreignKeyName: "qualiopi_indicators_criterion_id_fkey"
            columns: ["criterion_id"]
            isOneToOne: false
            referencedRelation: "qualiopi_criteria"
            referencedColumns: ["id"]
          },
        ]
      }
      qualiopi_request_documents: {
        Row: {
          antivirus_status: string
          created_at: string
          file_size: number | null
          filename: string
          id: string
          mime_type: string | null
          request_id: string
          sha256: string | null
          storage_path: string
          uploaded_by: string
          version: number
        }
        Insert: {
          antivirus_status?: string
          created_at?: string
          file_size?: number | null
          filename: string
          id?: string
          mime_type?: string | null
          request_id: string
          sha256?: string | null
          storage_path: string
          uploaded_by: string
          version?: number
        }
        Update: {
          antivirus_status?: string
          created_at?: string
          file_size?: number | null
          filename?: string
          id?: string
          mime_type?: string | null
          request_id?: string
          sha256?: string | null
          storage_path?: string
          uploaded_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "qualiopi_request_documents_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "qualiopi_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      qualiopi_request_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          created_at: string
          id: string
          meta: Json | null
          request_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          id?: string
          meta?: Json | null
          request_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          id?: string
          meta?: Json | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualiopi_request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "qualiopi_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      qualiopi_requests: {
        Row: {
          created_at: string
          dossier_id: string
          due_date: string | null
          id: string
          indicator_id: number
          last_reminder_at: string | null
          message: string | null
          refus_motif: string | null
          requested_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          statut: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dossier_id: string
          due_date?: string | null
          id?: string
          indicator_id: number
          last_reminder_at?: string | null
          message?: string | null
          refus_motif?: string | null
          requested_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          statut?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dossier_id?: string
          due_date?: string | null
          id?: string
          indicator_id?: number
          last_reminder_at?: string | null
          message?: string | null
          refus_motif?: string | null
          requested_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          statut?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualiopi_requests_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualiopi_requests_indicator_id_fkey"
            columns: ["indicator_id"]
            isOneToOne: false
            referencedRelation: "qualiopi_indicators"
            referencedColumns: ["id"]
          },
        ]
      }
      rapports_quotidiens: {
        Row: {
          alertes_securite_24h: number
          avancement_moyen: number
          created_at: string
          date_rapport: string
          details: Json
          dossiers_actifs: number
          dossiers_en_attente_client: number
          dossiers_nouveaux: number
          dossiers_termines: number
          id: string
          messages_24h: number
          repartition_pole: Json
          repartition_statut: Json
          taches_en_retard: number
          taches_terminees_24h: number
        }
        Insert: {
          alertes_securite_24h?: number
          avancement_moyen?: number
          created_at?: string
          date_rapport: string
          details?: Json
          dossiers_actifs?: number
          dossiers_en_attente_client?: number
          dossiers_nouveaux?: number
          dossiers_termines?: number
          id?: string
          messages_24h?: number
          repartition_pole?: Json
          repartition_statut?: Json
          taches_en_retard?: number
          taches_terminees_24h?: number
        }
        Update: {
          alertes_securite_24h?: number
          avancement_moyen?: number
          created_at?: string
          date_rapport?: string
          details?: Json
          dossiers_actifs?: number
          dossiers_en_attente_client?: number
          dossiers_nouveaux?: number
          dossiers_termines?: number
          id?: string
          messages_24h?: number
          repartition_pole?: Json
          repartition_statut?: Json
          taches_en_retard?: number
          taches_terminees_24h?: number
        }
        Relationships: []
      }
      rdv_reminders_sent: {
        Row: {
          kind: string
          rdv_id: string
          sent_at: string
        }
        Insert: {
          kind: string
          rdv_id: string
          sent_at?: string
        }
        Update: {
          kind?: string
          rdv_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rdv_reminders_sent_rdv_id_fkey"
            columns: ["rdv_id"]
            isOneToOne: false
            referencedRelation: "rendez_vous"
            referencedColumns: ["id"]
          },
        ]
      }
      rendez_vous: {
        Row: {
          client_id: string
          created_at: string
          dossier_id: string | null
          ends_at: string
          id: string
          notes: string | null
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          dossier_id?: string | null
          ends_at: string
          id?: string
          notes?: string | null
          starts_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          dossier_id?: string | null
          ends_at?: string
          id?: string
          notes?: string | null
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rendez_vous_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      security_settings: {
        Row: {
          blocked_keywords: string[]
          business_hours_end: string
          business_hours_only: boolean
          business_hours_start: string
          filter_keywords: boolean
          id: number
          mask_emails: boolean
          mask_phones: boolean
          updated_at: string
        }
        Insert: {
          blocked_keywords?: string[]
          business_hours_end?: string
          business_hours_only?: boolean
          business_hours_start?: string
          filter_keywords?: boolean
          id?: number
          mask_emails?: boolean
          mask_phones?: boolean
          updated_at?: string
        }
        Update: {
          blocked_keywords?: string[]
          business_hours_end?: string
          business_hours_only?: boolean
          business_hours_start?: string
          filter_keywords?: boolean
          id?: number
          mask_emails?: boolean
          mask_phones?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      tache_templates: {
        Row: {
          actif: boolean
          categorie: Database["public"]["Enums"]["dossier_categorie"]
          cote_client: boolean
          created_at: string
          depends_on_ordre: number | null
          description: string | null
          id: string
          jours_echeance: number | null
          ordre: number
          titre: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          categorie: Database["public"]["Enums"]["dossier_categorie"]
          cote_client?: boolean
          created_at?: string
          depends_on_ordre?: number | null
          description?: string | null
          id?: string
          jours_echeance?: number | null
          ordre: number
          titre: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          categorie?: Database["public"]["Enums"]["dossier_categorie"]
          cote_client?: boolean
          created_at?: string
          depends_on_ordre?: number | null
          description?: string | null
          id?: string
          jours_echeance?: number | null
          ordre?: number
          titre?: string
          updated_at?: string
        }
        Relationships: []
      }
      taches: {
        Row: {
          assigne_id: string | null
          completed_at: string | null
          cote_client: boolean
          created_at: string
          date_echeance: string | null
          depends_on_id: string | null
          description: string | null
          dossier_id: string
          id: string
          ordre: number
          statut: Database["public"]["Enums"]["tache_statut"]
          titre: string
          updated_at: string
          verrouillee: boolean
        }
        Insert: {
          assigne_id?: string | null
          completed_at?: string | null
          cote_client?: boolean
          created_at?: string
          date_echeance?: string | null
          depends_on_id?: string | null
          description?: string | null
          dossier_id: string
          id?: string
          ordre?: number
          statut?: Database["public"]["Enums"]["tache_statut"]
          titre: string
          updated_at?: string
          verrouillee?: boolean
        }
        Update: {
          assigne_id?: string | null
          completed_at?: string | null
          cote_client?: boolean
          created_at?: string
          date_echeance?: string | null
          depends_on_id?: string | null
          description?: string | null
          dossier_id?: string
          id?: string
          ordre?: number
          statut?: Database["public"]["Enums"]["tache_statut"]
          titre?: string
          updated_at?: string
          verrouillee?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "taches_depends_on_id_fkey"
            columns: ["depends_on_id"]
            isOneToOne: false
            referencedRelation: "taches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "taches_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          city: string | null
          country: string | null
          country_code: string | null
          created_at: string
          duration_seconds: number | null
          ended_at: string | null
          id: string
          ip: string | null
          last_seen_at: string
          latitude: number | null
          longitude: number | null
          region: string | null
          started_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          city?: string | null
          country?: string | null
          country_code?: string | null
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          ip?: string | null
          last_seen_at?: string
          latitude?: number | null
          longitude?: number | null
          region?: string | null
          started_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          city?: string | null
          country?: string | null
          country_code?: string | null
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          ip?: string | null
          last_seen_at?: string
          latitude?: number | null
          longitude?: number | null
          region?: string | null
          started_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      izisuivis_notification_task_health: {
        Row: {
          auto_task_duplicate_dossiers: number | null
          dossiers_missing_organisme_nom: number | null
          dossiers_total: number | null
          dossiers_without_auto_task: number | null
          push_subscriptions_total: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      anonymize_user_account: { Args: { _user_id: string }; Returns: undefined }
      archive_client: {
        Args: { _reason?: string; _user_id: string }
        Returns: undefined
      }
      backfill_missing_auto_dossier_tasks: { Args: never; Returns: number }
      can_internal_contact: {
        Args: { _a: string; _b: string }
        Returns: boolean
      }
      can_post_internal_conv: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      can_view_agency_task: {
        Args: { _task_id: string; _user: string }
        Returns: boolean
      }
      can_view_internal_conv: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      client_in_scope: {
        Args: { _client: string; _staff: string }
        Returns: boolean
      }
      close_stale_sessions: { Args: never; Returns: undefined }
      create_auto_task_for_dossier: {
        Args: { _dossier_id: string }
        Returns: string
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      disable_team_member: {
        Args: { _reason?: string; _user_id: string }
        Returns: undefined
      }
      dossier_in_scope: {
        Args: { _dossier: string; _user: string }
        Returns: boolean
      }
      dossier_title_from_of:
        | {
            Args: { _categorie: string; _organisme_nom: string }
            Returns: string
          }
        | {
            Args: {
              _categorie: string
              _juridique_type: string
              _organisme_nom: string
            }
            Returns: string
          }
      email_queue_dispatch: { Args: never; Returns: undefined }
      email_template_enabled: {
        Args: { _template_name: string }
        Returns: boolean
      }
      enable_team_member: { Args: { _user_id: string }; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      generer_rapport_direction: { Args: { _date?: string }; Returns: string }
      generer_rapport_quotidien: { Args: { _date?: string }; Returns: string }
      get_admin_email: { Args: never; Returns: string }
      get_last_activity: { Args: { _user_id: string }; Returns: string }
      get_presence: {
        Args: { _ids: string[] }
        Returns: {
          last_seen_at: string
          online: boolean
          user_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_agency_member: { Args: { _user: string }; Returns: boolean }
      is_assigned_as: {
        Args: { _dossier: string; _role: string; _user: string }
        Returns: boolean
      }
      is_assigned_to_dossier: {
        Args: { _dossier: string; _user: string }
        Returns: boolean
      }
      is_conversation_member: {
        Args: { _conv_id: string; _user_id: string }
        Returns: boolean
      }
      is_conversation_owner: {
        Args: { _conv_id: string; _user_id: string }
        Returns: boolean
      }
      is_internal_member: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      is_internal_owner: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      is_pole_member: {
        Args: { _pole_id: string; _user_id: string }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      list_expired_ephemeral: {
        Args: { _limit?: number }
        Returns: {
          attachment_path: string
          id: string
          source: string
        }[]
      }
      log_document_download: {
        Args: { _document_id: string }
        Returns: undefined
      }
      log_event: {
        Args: {
          _action: string
          _entity_id: string
          _entity_type: string
          _metadata: Json
          _severity: string
        }
        Returns: undefined
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      notify_team_document_reminder: {
        Args: { _document_id: string; _reminder_type?: string }
        Returns: number
      }
      notify_team_dossier_reminder: {
        Args: { _dossier_id: string; _reminder_type?: string }
        Returns: number
      }
      qualiopi_dossier_participant: {
        Args: { _dossier: string; _user: string }
        Returns: boolean
      }
      qualiopi_dossier_recipients: {
        Args: { _dossier: string }
        Returns: {
          user_id: string
        }[]
      }
      qualiopi_link_for: {
        Args: { _dossier: string; _user: string }
        Returns: string
      }
      qualiopi_notify_all: {
        Args: {
          _dossier: string
          _except: string
          _message: string
          _titre: string
          _type: Database["public"]["Enums"]["notification_type"]
        }
        Returns: undefined
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      rgpd_purge_old_logs: { Args: never; Returns: undefined }
      sanitize_message_content: {
        Args: { _content: string }
        Returns: {
          flagged: boolean
          reasons: string[]
          sanitized: string
        }[]
      }
      save_push_subscription: {
        Args: {
          _auth: string
          _endpoint: string
          _p256dh: string
          _user_agent?: string
        }
        Returns: undefined
      }
      send_rdv_reminders: { Args: never; Returns: undefined }
      session_end: { Args: { _session_id: string }; Returns: undefined }
      session_heartbeat: { Args: { _session_id: string }; Returns: undefined }
      session_start:
        | { Args: { _user_agent?: string }; Returns: string }
        | {
            Args: {
              _city?: string
              _country?: string
              _country_code?: string
              _ip?: string
              _latitude?: number
              _longitude?: number
              _region?: string
              _user_agent?: string
            }
            Returns: string
          }
      shares_conversation: {
        Args: { _a: string; _b: string }
        Returns: boolean
      }
      staff_can_view_client: {
        Args: { _client_id: string; _staff_id: string }
        Returns: boolean
      }
      team_notification_recipients_for_client: {
        Args: { _client_id: string; _exclude_user_id?: string }
        Returns: {
          user_id: string
        }[]
      }
      team_notification_recipients_for_pole: {
        Args: { _exclude_user_id?: string; _pole_id: string }
        Returns: {
          user_id: string
        }[]
      }
      test_push_notification_for_pole: {
        Args: { _pole_id: string }
        Returns: {
          notification_id: string
          push_subscriptions_count: number
          user_id: string
        }[]
      }
      test_push_notification_for_user: {
        Args: { _user_id: string }
        Returns: {
          notification_id: string
          push_subscriptions_count: number
          user_id: string
        }[]
      }
      unarchive_client: { Args: { _user_id: string }; Returns: undefined }
    }
    Enums: {
      agency_task_priority: "basse" | "normale" | "haute" | "urgente"
      agency_task_status: "a_faire" | "en_cours" | "bloquee" | "terminee"
      app_role:
        | "client"
        | "admin"
        | "direction"
        | "manager"
        | "consultant"
        | "auditeur"
        | "certificateur"
      dossier_categorie:
        | "qualiopi"
        | "bpf"
        | "nda"
        | "cfa"
        | "vae"
        | "edof"
        | "contrats"
        | "documents_administratifs"
        | "autres"
        | "juridique"
      dossier_statut:
        | "en_attente"
        | "documents_manquants"
        | "en_cours_etude"
        | "en_cours_traitement"
        | "a_completer"
        | "valide"
        | "refuse"
        | "termine"
      notification_type:
        | "message"
        | "document_depose"
        | "document_valide"
        | "document_refuse"
        | "document_demande"
        | "statut_change"
        | "commentaire"
        | "compte_active"
        | "email_verifie"
        | "rappel"
        | "action_requise"
        | "rdv"
        | "alerte_securite"
        | "internal_message"
        | "agency_task"
        | "internal_mention"
        | "tache_attente"
        | "qualiopi_message"
        | "qualiopi_demande"
        | "qualiopi_document"
        | "qualiopi_validation"
        | "qualiopi_refus"
        | "qualiopi_echeance"
        | "qualiopi_retard"
      pole_role: "manager" | "consultant"
      tache_statut:
        | "a_faire"
        | "en_cours"
        | "en_attente_client"
        | "bloque"
        | "termine"
        | "annule"
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
      agency_task_priority: ["basse", "normale", "haute", "urgente"],
      agency_task_status: ["a_faire", "en_cours", "bloquee", "terminee"],
      app_role: [
        "client",
        "admin",
        "direction",
        "manager",
        "consultant",
        "auditeur",
        "certificateur",
      ],
      dossier_categorie: [
        "qualiopi",
        "bpf",
        "nda",
        "cfa",
        "vae",
        "edof",
        "contrats",
        "documents_administratifs",
        "autres",
        "juridique",
      ],
      dossier_statut: [
        "en_attente",
        "documents_manquants",
        "en_cours_etude",
        "en_cours_traitement",
        "a_completer",
        "valide",
        "refuse",
        "termine",
      ],
      notification_type: [
        "message",
        "document_depose",
        "document_valide",
        "document_refuse",
        "document_demande",
        "statut_change",
        "commentaire",
        "compte_active",
        "email_verifie",
        "rappel",
        "action_requise",
        "rdv",
        "alerte_securite",
        "internal_message",
        "agency_task",
        "internal_mention",
        "tache_attente",
        "qualiopi_message",
        "qualiopi_demande",
        "qualiopi_document",
        "qualiopi_validation",
        "qualiopi_refus",
        "qualiopi_echeance",
        "qualiopi_retard",
      ],
      pole_role: ["manager", "consultant"],
      tache_statut: [
        "a_faire",
        "en_cours",
        "en_attente_client",
        "bloque",
        "termine",
        "annule",
      ],
    },
  },
} as const
