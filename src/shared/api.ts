// Gemeinsame API-Verträge zwischen Server und Web-App.
import type { LectureState } from './state.js';

export interface HealthResponse {
  status: 'ok';
  dataRoot: string;
  moduleDirExists: boolean;
  notesDirExists: boolean;
}

export interface LectureSummary {
  viewKind?: 'slides' | 'cryptography';
  lectureNumber?: number;
  markdownAvailable?: boolean;
  id: string;
  title: string;
  pageCount: number | null;
  error?: string;
  progress?: { completed: boolean; maxPageVisited: number; lastPage: number; noteCount: number | null; updatedAt?: string };
  sourceChanged?: boolean;
  previousPageCount?: number;
}

export interface OverviewResponse {
  modules: { name: string; lectures: LectureSummary[] }[];
  resume?: { id: string; title: string; module: string; pageCount: number; lastPage: number; updatedAt: string; viewKind?: 'slides' | 'cryptography' };
  orphans?: OrphanSummary[];
}

export interface LectureResponse extends LectureSummary {
  cryptography?: CryptographyContent;
  module: string;
  notes: Record<number, NoteValue>;
  readOnlyError?: NotesFileError;
  state: LectureState;
  completed: boolean;
  stateError?: string;
  sourceSha256?: string;
}
export interface SourceDocument {
  id: string;
  title: string;
  kind: 'whiteboard' | 'script';
  pageCount: number | null;
  sourceSha256?: string;
  sourceChanged?: boolean;
  error?: string;
}
export interface Citation {
  id: string;
  documentId?: string;
  page?: number;
  error?: string;
}
export interface CryptographyContent {
  documents: SourceDocument[];
  whiteboardId?: string;
  scriptId?: string;
  markdown?: string;
  citations: Citation[];
  warnings: string[];
}
export interface OrphanSummary {
  id: string; module: string; title: string; noteCount: number | null;
  candidates: { id: string; module: string; title: string }[];
  error?: string;
}

export interface NoteValue { text: string; hash: string }
export interface NotesFileError { message: string; line?: number }
export interface NoteConflict { currentText: string; currentHash: string }
