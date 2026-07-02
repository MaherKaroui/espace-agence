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
          id: string
          parent_id: string | null
          titre: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          parent_id?: string | null
          titre: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
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
          storage_path: string
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
          storage_path: string
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
          storage_path?: string
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
          nb_formateurs: number | null
          nb_formations: number | null
          nb_stagiaires: number | null
          pole_id: string
          qualiopi_audit_type: string | null
          qualiopi_scopes: string[]
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
          nb_formateurs?: number | null
          nb_formations?: number | null
          nb_stagiaires?: number | null
          pole_id: string
          qualiopi_audit_type?: string | null
          qualiopi_scopes?: string[]
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
          nb_formateurs?: number | null
          nb_formations?: number | null
          nb_stagiaires?: number | null
          pole_id?: string
          qualiopi_audit_type?: string | null
          qualiopi_scopes?: string[]
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
          id: string
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
          id?: string
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
          id?: string
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
          from_agence: boolean
          id: string
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
          from_agence?: boolean
          id?: string
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
          from_agence?: boolean
          id?: string
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
      [_ in never]: never
    }
    Functions: {
      close_stale_sessions: { Args: never; Returns: undefined }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      generer_rapport_quotidien: { Args: { _date?: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
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
      is_pole_member: {
        Args: { _pole_id: string; _user_id: string }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
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
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      sanitize_message_content: {
        Args: { _content: string }
        Returns: {
          flagged: boolean
          reasons: string[]
          sanitized: string
        }[]
      }
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
    }
    Enums: {
      app_role: "client" | "admin" | "direction" | "manager" | "consultant"
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
      app_role: ["client", "admin", "direction", "manager", "consultant"],
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
