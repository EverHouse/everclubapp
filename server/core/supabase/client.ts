import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseAdmin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (supabaseAdmin) {
    return supabaseAdmin;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SERVICE_ROLE_KEY environment variables');
  }

  supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseAdmin;
}

export function getSupabaseAnon(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL environment variable');
  }

  return createClient(supabaseUrl, anonKey || '', {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function enableRealtimeForTable(tableName: string): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    
    const { error } = await supabase.rpc('supabase_realtime_add_table', {
      table_name: tableName,
    });

    if (error) {
      console.error(`[Supabase] Failed to enable realtime for ${tableName}:`, error.message);
      return false;
    }

    console.log(`[Supabase] Realtime enabled for table: ${tableName}`);
    return true;
  } catch (err: any) {
    console.error(`[Supabase] Error enabling realtime for ${tableName}:`, err.message);
    return false;
  }
}

export { SupabaseClient };
