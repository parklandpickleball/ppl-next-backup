import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

// On web (Vercel SSR), window may not exist — use a safe localStorage adapter
const webStorage = {
  getItem: (key: string) => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  },
  setItem: (key: string, value: string) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
  },
  removeItem: (key: string) => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(key);
  },
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
