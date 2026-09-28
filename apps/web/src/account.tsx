import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { homeFor, useSession } from './auth';
import { Notice } from './ui';

export function Account({ mode }: { mode: 'signin' | 'signup' }) {
  const { user, loading, signIn, signUp } = useSession();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (loading) return <main className="centered"><p role="status">Restoring your session…</p></main>;
  if (user) return <Navigate to={homeFor(user.role)} replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    if (mode === 'signup' && (name.length < 2 || password.length < 12)) {
      setError('Enter a name and a password of at least 12 characters.');
      return;
    }
    setPending(true);
    try {
      const next = mode === 'signup' ? await signUp(name, email, password) : await signIn(email, password);
      navigate(homeFor(next.role), { replace: true });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-layout">
      <aside className="auth-story">
        <p className="eyebrow">Banani rush hour, made simpler</p>
        <h1>Share a seat.<br />Split the fare.</h1>
        <p>Book a place in Bullet, follow your ride and see exactly what you owe.
          Jashim can manage every step from the driver dashboard.</p>
        <div className="route-art" aria-hidden="true">
          <span>Banani</span><i /><span>Mohakhali &amp; Gulshan 1</span>
        </div>
      </aside>
      <section className="auth-card panel">
        <p className="eyebrow">{mode === 'signin' ? 'Welcome back' : 'Join the ride'}</p>
        <h2>{mode === 'signin' ? 'Sign in' : 'Create passenger account'}</h2>
        <p className="muted">{mode === 'signin'
          ? 'Passengers and Jashim use the same secure sign-in.'
          : 'Driver accounts are managed separately. This form creates a passenger account.'}</p>
        <form onSubmit={(event) => void submit(event)}>
          {mode === 'signup' && <label>Full name<input name="name" autoComplete="name" minLength={2}
            maxLength={80} required /></label>}
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Password<input name="password" type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            minLength={mode === 'signup' ? 12 : 1} maxLength={128} required /></label>
          {error && <Notice kind="error">{error}</Notice>}
          <button className="primary full" disabled={pending} type="submit">
            {pending ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p className="auth-switch">{mode === 'signin' ? <>New passenger? <Link to="/signup">Sign up</Link></>
          : <>Already have an account? <Link to="/signin">Sign in</Link></>}</p>
      </section>
    </main>
  );
}
