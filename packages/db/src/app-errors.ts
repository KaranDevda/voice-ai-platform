import { withOrg, type Db, type DbTx } from "./client";
import { appErrors } from "./schema";

export interface ErrorEntry {
  orgId: string;
  teamId?: string | null;
  userId?: string | null;
  route: string;
  method?: string | null;
  errorMessage: string;
  errorStack?: string | null;
  requestBody?: unknown;
  requestHeaders?: unknown;
  userAgent?: string | null;
  ip?: string | null;
}

/** Insert an application error using a transaction; safe to call from any async context. Does not throw on failure. */
export async function writeAppError(tx: DbTx, entry: ErrorEntry) {
  try {
    await tx.insert(appErrors).values(entry);
  } catch {
    // Never throw from error logging; the original error matters more.
  }
}

/** Insert an application error using a database connection (wraps in withOrg). Does not throw on failure. */
export async function writeAppErrorOrg(db: Db, entry: ErrorEntry) {
  try {
    // The table is row-level secured by organisation, so the organisation must be set first or the insert is silently refused.
    await withOrg(db, entry.orgId, (tx) => tx.insert(appErrors).values(entry));
  } catch {
    // Never throw from error logging.
  }
}