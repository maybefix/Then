import { writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

// Windows can briefly lock a report while an indexer/scanner reads it. Retry
// only transient file-access errors; preserve failures after the bounded wait.
export async function writeAuditFile(file, data) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await writeFile(file, data);
      return;
    } catch (error) {
      if (attempt >= 5 || !["EBUSY", "EACCES", "EPERM", "UNKNOWN"].includes(error.code)) throw error;
      await setTimeout(100 * 2 ** attempt);
    }
  }
}
