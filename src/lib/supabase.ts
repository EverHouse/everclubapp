import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;
let initAttempted = false;

function isValidSupabaseKey(key: string): boolean {
  // Supabase anon keys are JWTs that start with 'eyJ'
  return key && key.startsWith('eyJ') && key.length > 100;
}

export function getSupabase(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;
  if (initAttempted) return null;
  
  initAttempted = true;
  
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  
  if (!url || !anonKey || !isValidSupabaseKey(anonKey)) {
    return null;
  }
  
  try {
    supabaseClient = createClient(url, anonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10
        }
      },
      auth: {
        persistSession: false
      }
    });
    return supabaseClient;
  } catch {
    return null;
  }
}

export const supabase = getSupabase();
export const isSupabaseConfigured = !!supabase;

export function setSupabaseAuth(token: string | null) {
  const client = getSupabase();
  if (client && token) {
    client.auth.setSession({
      access_token: token,
      refresh_token: ''
    });
  } else if (client) {
    client.auth.signOut();
  }
}

export type AuthProvider = 'google' | 'apple' | 'github';

export async function signInWithEmail(email: string, password: string) {
  const client = getSupabase();
  if (!client) {
    return { data: null, error: { message: 'Supabase is not configured' } };
  }
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  return { data, error };
}

export async function signUpWithEmail(email: string, password: string, metadata?: { firstName?: string; lastName?: string }) {
  const client = getSupabase();
  if (!client) {
    return { data: null, error: { message: 'Supabase is not configured' } };
  }
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: metadata?.firstName,
        last_name: metadata?.lastName,
      }
    }
  });
  return { data, error };
}

export async function signInWithOAuth(provider: AuthProvider) {
  const client = getSupabase();
  if (!client) {
    return { data: null, error: { message: 'Supabase is not configured' } };
  }
  const { data, error } = await client.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    }
  });
  return { data, error };
}

export async function signOut() {
  const client = getSupabase();
  if (!client) {
    return { error: { message: 'Supabase is not configured' } };
  }
  const { error } = await client.auth.signOut();
  return { error };
}

export async function resetPassword(email: string) {
  const client = getSupabase();
  if (!client) {
    return { data: null, error: { message: 'Supabase is not configured' } };
  }
  const { data, error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  return { data, error };
}

export async function getSession() {
  const client = getSupabase();
  if (!client) {
    return { data: null, error: { message: 'Supabase is not configured' } };
  }
  const { data, error } = await client.auth.getSession();
  return { data, error };
}

export async function getUser() {
  const client = getSupabase();
  if (!client) {
    return { user: null, error: { message: 'Supabase is not configured' } };
  }
  const { data: { user }, error } = await client.auth.getUser();
  return { user, error };
}
