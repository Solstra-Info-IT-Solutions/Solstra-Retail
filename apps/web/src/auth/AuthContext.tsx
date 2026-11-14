import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/client';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions?: string[];
}

interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const logout = useCallback(() => {
    sessionStorage.removeItem('solstra_access_token');
    sessionStorage.removeItem('solstra_user');
    setUser(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.post<LoginResponse>('/auth/login', {
      email,
      password,
    });

    const { accessToken, user: authenticatedUser } = response.data;

    sessionStorage.setItem('solstra_access_token', accessToken);
    sessionStorage.setItem('solstra_user', JSON.stringify(authenticatedUser));
    setUser(authenticatedUser);
  }, []);

  useEffect(() => {
    const restoreSession = async () => {
      const token = sessionStorage.getItem('solstra_access_token');
      const savedUser = sessionStorage.getItem('solstra_user');

      if (!token || !savedUser) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await api.get<{ user: AuthUser & { userId?: string } }>('/auth/me');
        const profile = response.data.user;
        setUser(profile ? { ...profile, id: profile.id || profile.userId || '' } : JSON.parse(savedUser) as AuthUser);
      } catch {
        logout();
      } finally {
        setIsLoading(false);
      }
    };

    void restoreSession();
  }, [logout]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: Boolean(user),
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}
