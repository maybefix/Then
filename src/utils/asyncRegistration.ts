export type AsyncDisposer = () => void | Promise<void>;

const runDisposer = (
  disposer: AsyncDisposer,
  onError: (error: unknown) => void,
) => {
  try {
    void Promise.resolve(disposer()).catch(onError);
  } catch (error) {
    onError(error);
  }
};

export const manageAsyncRegistration = (
  registration: Promise<AsyncDisposer>,
  onError: (error: unknown) => void = () => undefined,
): (() => void) => {
  let closed = false;
  let disposer: AsyncDisposer | null = null;

  void registration.then(
    (nextDisposer) => {
      if (closed) {
        runDisposer(nextDisposer, onError);
        return;
      }
      disposer = nextDisposer;
    },
    (error) => {
      if (!closed) onError(error);
    },
  );

  return () => {
    if (closed) return;
    closed = true;
    const currentDisposer = disposer;
    disposer = null;
    if (currentDisposer) runDisposer(currentDisposer, onError);
  };
};
