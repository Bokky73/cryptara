"use client";

import { useEffect, useState } from "react";

const REFRESH_KEY = "cryptara:offline-refresh-required";

function getInitialOnlineState() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function markOfflineRefreshRequired() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(REFRESH_KEY, "1");
  document.documentElement.dataset.offlineLocked = "true";
}

export function clearOfflineRefreshRequired() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(REFRESH_KEY);
  document.documentElement.dataset.offlineLocked = "false";
}

export function requiresOnlineRefresh() {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(REFRESH_KEY) === "1";
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(getInitialOnlineState);
  const [refreshRequired, setRefreshRequired] = useState(false);

  useEffect(() => {
    const sync = () => {
      const online = navigator.onLine;
      setIsOnline(online);
      if (!online) markOfflineRefreshRequired();
      setRefreshRequired(requiresOnlineRefresh());
    };

    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);

    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return {
    isOnline,
    isOffline: !isOnline,
    actionsDisabled: !isOnline || refreshRequired,
    refreshRequired,
    refresh: () => {
      clearOfflineRefreshRequired();
      window.location.reload();
    },
  };
}
