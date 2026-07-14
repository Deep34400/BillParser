import { useState, type FormEvent } from 'react';
import { api } from '../api/client.js';
import { T } from '../theme.js';

interface Props {
  onLogin: () => void;
}

export function LoginPage({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      const r = await api.login(email.trim(), password);
      localStorage.setItem('session_token', r.data.token);
      localStorage.setItem('session_user', JSON.stringify(r.data.user));
      onLogin();
    } catch (err) {
      setError((err as Error).message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `linear-gradient(135deg, ${T.bg} 0%, #e8e5de 100%)`, fontFamily: T.font,
    }}>
      <div style={{
        width: 400, background: T.panel, borderRadius: 16, padding: '40px 36px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08)', border: `1px solid ${T.border}`,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14, background: T.accentSoft,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px', fontSize: 24, color: T.accent, fontWeight: 700,
          }}>
            P
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text, margin: 0 }}>
            Carrum Invoice OCR
          </h1>
          <p style={{ fontSize: 13, color: T.muted, marginTop: 6 }}>
            Sign in to your account
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: 'block', marginBottom: 6 }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoFocus
              style={{
                width: '100%', padding: '10px 14px', border: `1px solid ${T.border}`,
                borderRadius: 8, fontSize: 14, fontFamily: T.font, boxSizing: 'border-box',
                outline: 'none', transition: 'border-color 0.15s',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: 'block', marginBottom: 6 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              style={{
                width: '100%', padding: '10px 14px', border: `1px solid ${T.border}`,
                borderRadius: 8, fontSize: 14, fontFamily: T.font, boxSizing: 'border-box',
                outline: 'none', transition: 'border-color 0.15s',
              }}
            />
          </div>

          {error && (
            <div style={{
              padding: '10px 14px', background: '#fef2f2', border: `1px solid #fecaca`,
              borderRadius: 8, fontSize: 13, color: T.red,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '11px 14px', border: 'none', borderRadius: 8,
              background: loading ? T.muted : T.accent, color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: loading ? 'wait' : 'pointer', fontFamily: T.font, transition: 'background 0.15s',
              marginTop: 4,
            }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: T.faint }}>
          Contact admin if you don't have an account
        </div>
      </div>
    </div>
  );
}
