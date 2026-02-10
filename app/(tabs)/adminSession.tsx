import React, { createContext, useContext, useMemo, useState } from "react";
import { supabase } from "../../constants/supabaseClient";

type AdminSessionContextValue = {
  isAdminUnlocked: boolean;
  unlockAdmin: () => Promise<void>;
  lockAdmin: () => Promise<void>;
};

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

export function AdminSessionProvider({ children }: { children: React.ReactNode }) {
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);

  const unlockAdmin = async () => {
    setIsAdminUnlocked(true);

    // ✅ Persist "admin session" to Supabase so RLS allows admin reads
    try {
      const userRes = await supabase.auth.getUser();
      const uid = userRes?.data?.user?.id;

      if (!uid) return;

      const { error } = await supabase.from("admin_unlock_sessions").upsert(
        {
          user_id: uid,
          unlocked_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      if (error) console.warn("admin_unlock_sessions upsert error:", error.message);
    } catch (e: any) {
      console.warn("unlockAdmin error:", e?.message ?? e);
    }
  };

  const lockAdmin = async () => {
    setIsAdminUnlocked(false);

    // ✅ Remove admin session row so RLS immediately removes admin reads
    try {
      const userRes = await supabase.auth.getUser();
      const uid = userRes?.data?.user?.id;

      if (!uid) return;

      const { error } = await supabase.from("admin_unlock_sessions").delete().eq("user_id", uid);

      if (error) console.warn("admin_unlock_sessions delete error:", error.message);
    } catch (e: any) {
      console.warn("lockAdmin error:", e?.message ?? e);
    }
  };

  const value = useMemo(
    () => ({
      isAdminUnlocked,
      unlockAdmin,
      lockAdmin,
    }),
    [isAdminUnlocked]
  );

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession() {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) throw new Error("useAdminSession must be used inside AdminSessionProvider");
  return ctx;
}
