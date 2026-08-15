# Chime Standalone Isolation

This folder is an independent source snapshot of the Chime booking product.

- It lives outside the HiTech Labs website repository.
- The HiTech website does not import, serve, or deploy files from this folder.
- Private environment files, installed dependencies, generated builds, IDE state,
  and Git metadata were intentionally excluded.
- The existing HiTech website and its deployed Chime bundle were not changed.
- Changes here affect only this standalone copy unless someone deliberately builds
  the embed and copies its output into another project.

## Local setup

1. Copy the provided environment examples to local environment files.
2. Run `npm ci` in the project root.
3. Install the server dependencies according to `server/package.json`.
4. Run `npm run dev` for the standalone interface.
5. Run `npm run build:embed` only when producing a portable embed release.
