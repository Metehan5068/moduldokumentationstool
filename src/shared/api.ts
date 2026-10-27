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
}
