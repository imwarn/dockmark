export interface ChangeJournalSnapshot {
  id: string;
  title: string;
  url: string;
  description?: string;
  iconUrl?: string;
  categoryId: string | null;
  categoryName?: string;
  healthPolicy: string;
  healthStatus: string;
  position: number;
  inbox: boolean;
  archived: boolean;
  published: boolean;
  tags: string[];
}

export interface ChangeJournalItem {
  bookmarkId: string;
  title: string;
  url: string;
  before: ChangeJournalSnapshot | null;
  after: ChangeJournalSnapshot | null;
}

export interface ChangeJournalEntry {
  id: string;
  operation: string;
  itemCount: number;
  summary: string;
  items: ChangeJournalItem[];
  createdAt: string;
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

export async function listChangeJournal(limit = 30) {
  const response = await fetch(`/api/library/change-journal?limit=${encodeURIComponent(String(limit))}`, {
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({})) as ErrorEnvelope & { entries?: ChangeJournalEntry[] };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `Request failed with status ${response.status}.`);
  }
  return body.entries ?? [];
}
