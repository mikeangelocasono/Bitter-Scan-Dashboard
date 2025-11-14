"use client";

import { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from 'react';
import { supabase } from './supabase';
import { UserProfile, User, UserContextType, SupabaseApiError, isSupabaseApiError } from '../types';

const SUPPRESS_AUTH_TOAST_KEY = 'bs:suppress-auth-toast';

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const initialResolved = useRef(false);
  const isMountedRef = useRef(true);

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileData) {
        setProfile(profileData);
        return;
      }

      if (profileError?.code === 'PGRST116') {
        // Profile intentionally missing (not created yet)
        setProfile(null);
        return;
      }

      if (profileError) {
        console.error('Error fetching profile:', profileError);
        setProfile(null);
      }
    } catch (error: unknown) {
      console.error('Error fetching profile:', error);
      setProfile(null);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  }, [fetchProfile, user]);

  const resolveSession = useCallback(
    async (sessionUser: User | null) => {
      if (!isMountedRef.current) return;
      setUser(sessionUser);

      if (sessionUser) {
        await fetchProfile(sessionUser.id);
      } else {
        setProfile(null);
      }
    },
    [fetchProfile]
  );

  const logout = useCallback(async () => {
    // Immediately clear local state for instant UI response
    setUser(null);
    setProfile(null);

    if (typeof window !== 'undefined') {
      sessionStorage.setItem(SUPPRESS_AUTH_TOAST_KEY, 'true');
    }

    try {
      await supabase.auth.signOut();
    } catch {
      // No-op: auth state listener will keep things consistent
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    const getInitialSession = async () => {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        
        // Handle refresh token errors
        if (sessionError) {
          const errorMessage = sessionError.message || '';
          if (errorMessage.includes('Refresh Token') || errorMessage.includes('refresh_token_not_found') || sessionError.status === 401) {
            // Invalid refresh token - clear session and sign out
            console.warn('Invalid refresh token detected, signing out...');
            setUser(null);
            setProfile(null);
            try {
              await supabase.auth.signOut();
            } catch {
              // Ignore sign-out errors
            }
            if (isMountedRef.current) {
              setLoading(false);
              initialResolved.current = true;
            }
            return;
          }
          throw sessionError;
        }
        
        await resolveSession(session?.user ?? null);
      } catch (error: unknown) {
        // Handle AuthApiError for refresh token issues
        if (isSupabaseApiError(error)) {
          const errorMessage = error.message || '';
          if (errorMessage.includes('Refresh Token') || errorMessage.includes('refresh_token_not_found') || error.status === 401) {
            console.warn('Invalid refresh token detected, signing out...');
            setUser(null);
            setProfile(null);
            try {
              await supabase.auth.signOut();
            } catch {
              // Ignore sign-out errors
            }
          } else {
            console.error('Error getting initial session:', error);
          }
        } else {
          console.error('Error getting initial session:', error);
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
          initialResolved.current = true;
        }
      }
    };

    getInitialSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMountedRef.current) return;

      const shouldShowSpinner = !initialResolved.current;
      if (shouldShowSpinner) {
        setLoading(true);
      }

      try {
        // Handle TOKEN_REFRESHED event errors
        if (event === 'TOKEN_REFRESHED' && !session) {
          // Token refresh failed - sign out
          console.warn('Token refresh failed, signing out...');
          setUser(null);
          setProfile(null);
          try {
            await supabase.auth.signOut();
          } catch {
            // Ignore sign-out errors
          }
          if (isMountedRef.current) {
            if (shouldShowSpinner) {
              setLoading(false);
            }
            initialResolved.current = true;
          }
          return;
        }

        await resolveSession(session?.user ?? null);
      } catch (error: unknown) {
        // Handle refresh token errors
        if (isSupabaseApiError(error)) {
          const errorMessage = error.message || '';
          if (errorMessage.includes('Refresh Token') || errorMessage.includes('refresh_token_not_found') || error.status === 401) {
            console.warn('Invalid refresh token detected, signing out...');
            setUser(null);
            setProfile(null);
            try {
              await supabase.auth.signOut();
            } catch {
              // Ignore sign-out errors
            }
          } else {
            console.error('Error in auth state change:', error);
          }
        } else {
          console.error('Error in auth state change:', error);
        }
      } finally {
        if (isMountedRef.current) {
          if (shouldShowSpinner) {
            setLoading(false);
          }
          initialResolved.current = true;
        }
      }
    });

    return () => {
      isMountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [resolveSession]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        
        // Handle refresh token errors
        if (sessionError) {
          const errorMessage = sessionError.message || '';
          if (errorMessage.includes('Refresh Token') || errorMessage.includes('refresh_token_not_found') || sessionError.status === 401) {
            console.warn('Invalid refresh token detected, signing out...');
            setUser(null);
            setProfile(null);
            try {
              await supabase.auth.signOut();
            } catch {
              // Ignore sign-out errors
            }
            return;
          }
          throw sessionError;
        }
        
        await resolveSession(session?.user ?? null);
      } catch (error: unknown) {
        // Handle AuthApiError for refresh token issues
        if (isSupabaseApiError(error)) {
          const errorMessage = error.message || '';
          if (errorMessage.includes('Refresh Token') || errorMessage.includes('refresh_token_not_found') || error.status === 401) {
            console.warn('Invalid refresh token detected, signing out...');
            setUser(null);
            setProfile(null);
            try {
              await supabase.auth.signOut();
            } catch {
              // Ignore sign-out errors
            }
          } else {
            console.error('Error refreshing session on visibility change:', error);
          }
        } else {
          console.error('Error refreshing session on visibility change:', error);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [resolveSession]);

  return (
    <UserContext.Provider value={{ user, profile, loading, refreshProfile, logout }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}
