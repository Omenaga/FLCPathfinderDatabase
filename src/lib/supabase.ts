import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

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
