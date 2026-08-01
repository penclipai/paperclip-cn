// The node-side portability zip reader lives in @penclipai/shared so the
// server can consume the same codec (a raw uploaded zip is unzipped into the
// exact `{ rootPath, files }` bundle the inline import source carries). This
// module re-exports it to keep the CLI's existing import paths stable.
export {
  binaryContentTypeByExtension,
  bytesToPortableFileEntry,
  isBlobStorePath,
  readZipArchive,
} from "@penclipai/shared/portability-zip";
