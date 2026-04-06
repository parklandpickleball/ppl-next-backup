import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

// On web (Vercel SSR), window may not exist — use a Promise-based localStorage adapter
const webStorage = {
  getItem: (key: string): Promise<string | null> =>
    Promise.resolve(typeof window !== 'undefined' ? window.localStorage.getItem(key) : null),
  setItem: (key: string, value: string): Promise<void> =>
    Promise.resolve(typeof window !== 'undefined' ? void window.localStorage.setItem(key, value) : undefined),
  removeItem: (key: string): Promise<void> =>
    Promise.resolve(typeof window !== 'undefined' ? void window.localStorage.removeItem(key) : undefined),
};

export const supabase = createClient(
  "https://betrvovxlgmrgqcabidj.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJldHJ2b3Z4bGdtcmdxY2FiaWRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwNDgwMzksImV4cCI6MjA4NTYyNDAzOX0.H6wjdR2B5vdaIjWxZIW49D5kowOj1eDPsTsvlFOOpFk",
  {
    auth: {
      storage: Platform.OS === 'web' ? webStorage : AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);
