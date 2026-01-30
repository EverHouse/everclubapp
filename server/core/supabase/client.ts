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

export function isSupabaseConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SERVICE_ROLE_KEY);
}

export async function enableRealtimeForTable(tableName: string): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    console.warn(`[Supabase] Skipping realtime for ${tableName} - Supabase not configured`);
    return false;
  }

  try {
    const supabase = getSupabaseAdmin();
    
    const { error } = await supabase.rpc('supabase_realtime_add_table', {
      table_name: tableName,
    });

    if (error) {
      if (error.message?.includes('function') && error.message?.includes('does not exist')) {
        console.warn(`[Supabase] Realtime RPC not available for ${tableName} - this is normal for some Supabase configurations`);
        return false;
      }
      console.error(`[Supabase] Failed to enable realtime for ${tableName}:`, error.message);
      return false;
    }

    console.log(`[Supabase] Realtime enabled for table: ${tableName}`);
    return true;
  } catch (err: any) {
    if (err.message?.includes('fetch failed') || err.message?.includes('ENOTFOUND') || err.message?.includes('ECONNREFUSED')) {
      console.warn(`[Supabase] Cannot reach Supabase for ${tableName} - check SUPABASE_URL configuration`);
    } else {
      console.error(`[Supabase] Error enabling realtime for ${tableName}:`, err.message);
    }
    return false;
  }
}

export { SupabaseClient };
