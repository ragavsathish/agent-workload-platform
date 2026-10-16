export type OperationOutcome = "ok" | "error" | string;

export type RecordOptions = {
  count?: number;
  durationSeconds?: number;
  outcome?: OperationOutcome;
};

export type Telemetry = {
  record(operation: string, options?: RecordOptions): void;
  observe<T>(operation: string, callback: () => Promise<T> | T): Promise<T>;
  shutdown(): Promise<void>;
};

export function configureTelemetry(serviceName: string): Telemetry;
