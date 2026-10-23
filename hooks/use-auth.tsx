"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from "react";

interface AuthUser {
    id: string;
    email?: string | null;
    name?: string | null;
    role?: string | null;
    staffId?: number | null;
    created_at?: string | null;
}

interface Profile {
    id: string;
    user_id: string;
    full_name: string | null;
    email: string;
    avatar_url: string | null;
    role: string | null;
}

interface AuthContextValue {
    user: AuthUser | null;
    profile: Profile | null;
    loading: boolean;
    signOut: () => Promise<void>;
    refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchProfile = useCallback(async () => {
        try {
            const res = await fetch("/api/auth/me");
            if (res.ok) {
                const data = await res.json();
                setUser(data.user ?? null);
                setProfile(data.profile ?? null);
            } else {
                setUser(null);
                setProfile(null);
            }
        } catch (err) {
            console.error("[useAuth] fetchProfile threw:", err);
            setUser(null);
            setProfile(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        let mounted = true;

        const init = async () => {
            await fetchProfile();
        };

        init();

        return () => {
            mounted = false;
        };
    }, [fetchProfile]);

    const signOut = useCallback(async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        setUser(null);
        setProfile(null);
        window.location.href = "/auth/login";
    }, []);

    const refreshProfile = useCallback(async () => {
        await fetchProfile();
    }, [fetchProfile]);

    return (
        <AuthContext.Provider
            value={{ user, profile, loading, signOut, refreshProfile }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        return {
            user: null,
            profile: null,
            loading: false,
            signOut: async () => {
                window.location.href = "/auth/login";
            },
            refreshProfile: async () => { },
        };
    }
    return ctx;
}
