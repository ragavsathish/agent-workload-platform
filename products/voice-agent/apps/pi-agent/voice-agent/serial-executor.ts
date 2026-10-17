export type OperationKind = "turn" | "maintenance";

export function createSerialExecutor() {
  let queue: Promise<void> = Promise.resolve();
  const pending: Record<OperationKind, number> = { turn: 0, maintenance: 0 };

  return {
    isBusy(): boolean {
      return pending.turn > 0 || pending.maintenance > 0;
    },
    run<T>(kind: OperationKind, operation: () => Promise<T>): Promise<T> {
      pending[kind] += 1;
      const result = queue.then(operation, operation);
      queue = result.then(() => undefined, () => undefined);
      return result.finally(() => {
        pending[kind] -= 1;
      });
    },
  };
}

export type SerialExecutor = ReturnType<typeof createSerialExecutor>;
