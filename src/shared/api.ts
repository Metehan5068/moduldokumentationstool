// Gemeinsame API-Verträge zwischen Server und Web-App.

export interface HealthResponse {
  status: 'ok';
  dataRoot: string;
  moduleDirExists: boolean;
  notesDirExists: boolean;
}

export interface LectureSummary {
  id: string;
  title: string;
  pageCount: number | null;
  error?: string;
}

export interface OverviewResponse {
  modules: { name: string; lectures: LectureSummary[] }[];
}

export interface LectureResponse extends LectureSummary {
  module: string;
  notes: Record<number, NoteValue>;
  readOnlyError?: NotesFileError;
}

export interface NoteValue { text: string; hash: string }
export interface NotesFileError { message: string; line?: number }
export interface NoteConflict { currentText: string; currentHash: string }
