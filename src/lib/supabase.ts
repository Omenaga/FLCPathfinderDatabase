import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database as GeneratedDatabase } from './database.types'

// PostgreSQL function argument nullability is absent from generated types.
// The creation RPC deliberately accepts a null birthday for unknown dates.
type Functions = GeneratedDatabase['public']['Functions']
type Database = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<GeneratedDatabase['public'], 'Functions'> & {
    Functions: Omit<Functions, 'add_member_record' | 'add_to_records'> & {
      add_to_records: {
        Args: Omit<Functions['add_to_records']['Args'], 'p_year'> & { p_year: string | null }
        Returns: Functions['add_to_records']['Returns']
      }
      add_member_record: {
        Args: Omit<Functions['add_member_record']['Args'], 'p_birth_date'> & { p_birth_date: string | null }
        Returns: Functions['add_member_record']['Returns']
      }
    }
  }
}

let client: SupabaseClient<Database> | undefined

// Initialize on demand so the starter runs before a project is connected.
export function getSupabase(): SupabaseClient<Database> {
  if (client) return client

  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

  if (!url || !key) {
    throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local.')
  }

  client = createClient<Database>(url, key)
  return client
}
