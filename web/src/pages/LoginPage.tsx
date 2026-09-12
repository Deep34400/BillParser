import { useState, type FormEvent } from 'react';
import { api } from '../api/client.js';
import carrumLogo from '../assets/carrum-logo.svg';
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card.js';

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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-border/50 font-sans px-4">
      <Card className="w-full max-w-[400px] shadow-lg">
        <CardHeader className="items-center text-center pb-2">
          <img src={carrumLogo} alt="Carrum" className="mx-auto mb-4 block h-auto w-48" />
          <h1 className="font-heading text-xl font-bold text-foreground">Invoice OCR</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to your account</p>
        </CardHeader>

        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
                {error}
              </div>
            )}

            <Button type="submit" disabled={loading} className="mt-1 w-full">
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </CardContent>

        <CardFooter className="justify-center">
          <p className="text-[11px] text-faint">Contact admin if you don't have an account</p>
        </CardFooter>
      </Card>
    </div>
  );
}
