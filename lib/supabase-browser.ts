import { createBrowserClient } from '@supabase/ssr';

import { getSupabasePublicEnv } from './env';

export function createSupabaseBrowserClient() {
  const env = getSupabasePublicEnv();
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
