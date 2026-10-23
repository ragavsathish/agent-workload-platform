declare module "request" {
  export default function request(path: string, body: string): string;
}

declare module "journal-query" {
  import type { JournalEntry } from "voice:personal-knowledge/types@0.1.0";
  export default function journalQuery(): JournalEntry[];
}
