import { createClient } from '@supabase/supabase-js'

/**
 * Local development fallback credentials keep the app functional when the
 * expected NEXT_PUBLIC_* environment variables are missing. They mirror the
 * previous hard-coded values and can safely be overridden by defining the env
 * vars in `.env.local` as documented in AUTHENTICATION_GUIDE.md.
 */
const FALLBACK_SUPABASE_URL = 'https://dqbmrakpaxhqmfuwxuqf.supabase.co'
const FALLBACK_SUPABASE_ANON_KEY =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxYm1yYWtwYXhocW1mdXd4dXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYzNTc4MTcsImV4cCI6MjA3MTkzMzgxN30.LZmk0N6uhUZ8Tr0T6mPd_J7phpvT5HXwQmoiYnjhKXQ'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? FALLBACK_SUPABASE_URL
const supabaseAnonKey =
	process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? FALLBACK_SUPABASE_ANON_KEY

if (
	(process.env.NEXT_PUBLIC_SUPABASE_URL === undefined ||
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY === undefined) &&
	typeof console !== 'undefined'
) {
	console.warn(
		'Using fallback Supabase credentials. Define NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment to override.'
	)
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
	auth: {
		persistSession: true,
		autoRefreshToken: true,
		detectSessionInUrl: true,
		storage: typeof window !== 'undefined' ? window.localStorage : undefined,
		storageKey: 'sb-auth-token',
		flowType: 'pkce',
	},
	global: {
		headers: {
			'x-client-info': 'bitter-scan-expert-dashboard',
		},
	},
})

// Helper function to listen for auth state changes
export function listenForSession(callback: (user: unknown) => void) {
	return supabase.auth.onAuthStateChange((_event, session) => {
		callback(session?.user || null)
	})
}
