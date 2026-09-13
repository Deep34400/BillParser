import { useState, useEffect, useRef, useCallback } from 'react';
import { api, type InvoiceComment } from '../../api/client.js';
import { Card, CardContent, CardHeader } from '@/components/ui/card.js';
import { Input } from '@/components/ui/input.js';
import { Button } from '@/components/ui/button.js';

interface CommentsPanelProps {
  billId: string;
}

export function CommentsPanel({ billId }: CommentsPanelProps) {
  const [comments, setComments] = useState<InvoiceComment[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getComments(billId);
      setComments(data);
    } catch {
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [billId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [comments.length]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const comment = await api.addComment(billId, trimmed);
      setComments((prev) => [...prev, comment]);
      setText('');
    } catch {
      // leave input for retry
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader className="pb-2">
        <h3 className="text-sm font-semibold">Comments</h3>
      </CardHeader>
      <CardContent>
        <div ref={listRef} className="mb-3 max-h-64 space-y-3 overflow-y-auto">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && comments.length === 0 && (
            <p className="text-sm italic text-muted-foreground">No comments yet.</p>
          )}
          {comments.map((c) => (
            <div key={c.id} className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">
                  {c.user_name || c.user_email || 'User'}
                </span>
                <time className="shrink-0 text-[10px] text-muted-foreground">
                  {new Date(c.created_at).toLocaleString()}
                </time>
              </div>
              <p className="m-0 whitespace-pre-wrap text-sm text-foreground">{c.text}</p>
            </div>
          ))}
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a comment…"
            disabled={submitting}
          />
          <Button type="submit" disabled={!text.trim() || submitting}>
            {submitting ? '…' : 'Post'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
