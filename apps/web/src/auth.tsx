import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from './api';
import type { Role, User } from './api';

type Session = {
  user: User | null; loading: boolean; error: string | null;
  restore: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (name: string, email: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
};
const Context = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setLoading(true);
    setError(null);
    try {
      setUser((await api.me()).user);
    } catch (failure) {
      setUser(null);
      if (!(failure instanceof ApiError && failure.status === 401)) {
        setError(failure instanceof Error ? failure.message : 'Session unavailable.');
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void restore();
    const expired = () => setUser(null);
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);
  const value: Session = {
    user, loading, error, restore,
    signIn: async (email, password) => {
      const next = (await api.signIn(email, password)).user;
      setUser(next);
      setError(null);
      return next;
    },
    signUp: async (name, email, password) => {
      const next = (await api.signUp(name, email, password)).user;
      setUser(next);
      setError(null);
      return next;
    },
    signOut: async () => {
      await api.signOut();
      setUser(null);
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error('SessionProvider is missing');
  return value;
}

export function homeFor(role: Role) {
  return role === 'DRIVER' ? '/driver' : '/passenger';
}

export function Protected({ role }: { role: Role }) {
  const { user, loading, error, restore } = useSession();
  const location = useLocation();
  if (loading) return <main className="centered"><p role="status">Restoring your session…</p></main>;
  if (error) return (
    <main className="centered panel">
      <h1>Connection unavailable</h1>
      <p role="alert">{error}</p>
      <button onClick={() => void restore()}>Retry</button>
    </main>
  );
  if (!user) return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />;
  return <Outlet />;
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, signOut } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const home = user ? homeFor(user.role) : '/signin';
  async function logout() {
    setError('');
    try {
      await signOut();
      navigate('/signin', { replace: true });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Sign out failed.');
    }
  }
  return (
    <div className="site">
      <header className="topbar">
        <Link className="brand" to={home} aria-label="Dhaka Tesla Pool home">
          <span className="brand-mark">T</span>
          <span>Dhaka Tesla <strong>Pool</strong></span>
        </Link>
        <nav aria-label="Main navigation">
          {user?.role === 'PASSENGER' && <>
            <Link to="/passenger">My ride</Link><Link to="/passenger/history">History</Link>
          </>}
          {user?.role === 'DRIVER' && <>
            <Link to="/driver">Dashboard</Link><Link to="/driver/history">Trips</Link>
          </>}
          {user ? <button className="nav-button" onClick={() => void logout()}>Sign out</button>
            : <Link to="/signin">Sign in</Link>}
        </nav>
      </header>
      {error && <div className="notice error" role="alert">{error}</div>}
      {children}
      <footer className="footer">Dhaka Tesla Pool · Shared rides, clearer journeys</footer>
    </div>
  );
}
