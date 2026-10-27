// Gemeinsame API-Verträge zwischen Server und Web-App.

export interface HealthResponse {
  status: 'ok';
  dataRoot: string;
  moduleDirExists: boolean;
  notesDirExists: boolean;
}
