/**
 * Invoice comment repository — CRUD for bill notes.
 */
import { Op } from 'sequelize';
import { InvoiceComment } from './models/invoiceComment.js';
import { User } from '../users/models/index.js';

export interface CommentDoc {
  id: string;
  bill_id: string;
  user_id: string;
  text: string;
  created_at: string;
  user_email?: string;
  user_name?: string;
}

function rowToDoc(row: InvoiceComment, user?: User | null): CommentDoc {
  return {
    id: row.id,
    bill_id: row.billId,
    user_id: row.userId,
    text: row.text,
    created_at: row.createdAt.toISOString(),
    user_email: user?.email,
    user_name: user?.name,
  };
}

export async function getComments(billId: string): Promise<CommentDoc[]> {
  const rows = await InvoiceComment.findAll({
    where: { billId },
    order: [['createdAt', 'ASC']],
  });

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const users = userIds.length
    ? await User.findAll({ where: { userId: { [Op.in]: userIds } } })
    : [];
  const userMap = new Map(users.map((u) => [u.userId, u]));

  return rows.map((r) => rowToDoc(r, userMap.get(r.userId)));
}

export async function addComment(billId: string, userId: string, text: string): Promise<CommentDoc> {
  const row = await InvoiceComment.create({ billId, userId, text: text.trim() } as any);
  const user = await User.findByPk(userId);
  return rowToDoc(row, user);
}
