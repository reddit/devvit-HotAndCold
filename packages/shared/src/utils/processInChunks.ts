type ProcessInChunksArgs<T> = {
  items: T[];
  chunkSize: number;
  promiseGenerator: (item: T, index: number) => Promise<any>;
  onSuccess?: (result: any, item: T, index: number, chunkIndex: number) => Promise<void> | void;
  onError?: (error: any, item: T, index: number, chunkIndex: number) => Promise<void> | void;
};

export async function processInChunks<T>({
  items,
  chunkSize,
  promiseGenerator,
  onSuccess,
  onError,
}: ProcessInChunksArgs<T>): Promise<void> {
  for (let chunkIndex = 0; chunkIndex < items.length; chunkIndex += chunkSize) {
    const chunk = items.slice(chunkIndex, chunkIndex + chunkSize);

    // Generate promises for the current chunk
    const promises = chunk.map((item, index) => promiseGenerator(item, chunkIndex + index));

    // Wait for all promises in the chunk to settle
    const results = await Promise.allSettled(promises);

    let successCount = 0;

    for (let settledIndex = 0; settledIndex < results.length; settledIndex++) {
      const result = results[settledIndex];
      const item = chunk[settledIndex];
      const absoluteIndex = chunkIndex + settledIndex;

      if (result.status === 'fulfilled') {
        successCount++;
        if (onSuccess) {
          await onSuccess(result.value, item, absoluteIndex, chunkIndex);
        }
      } else if (result.status === 'rejected') {
        if (onError) {
          await onError(result.reason, item, absoluteIndex, chunkIndex);
        }
      }
    }

    console.log(
      `Processed ${chunk.length} items in this chunk: ${successCount} succeeded, ${
        chunk.length - successCount
      } failed.`
    );
  }
}
