import { API } from "typescript/unstable/sync";

/**
 * Opens on-disk files through TypeScript 7's unstable parser session and
 * guarantees that its native snapshot and client are released.
 */
export function withTypeScriptSourceFiles(files, callback) {
  const api = new API();
  let snapshot;
  try {
    snapshot = api.updateSnapshot({ openFiles: [...new Set(files)] });
    return callback((file) => {
      const project = snapshot.getDefaultProjectForFile(file);
      const sourceFile = project?.program.getSourceFile(file);
      if (!sourceFile) {
        throw new Error(`TypeScript could not parse ${file}`);
      }
      return sourceFile;
    });
  } finally {
    snapshot?.dispose();
    api.close();
  }
}
