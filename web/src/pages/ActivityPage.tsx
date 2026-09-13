import { AuditLogPanel } from '../components/AuditLogPanel.js';

export function ActivityPage() {
  return (
    <div className="max-w-4xl px-7 py-6 font-sans">
      <h1 className="font-heading text-xl font-bold mb-5">Activity</h1>
      <AuditLogPanel
        title="My activity"
        description="Your invoice, approval, and webhook actions."
      />
    </div>
  );
}
