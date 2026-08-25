import { open, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

/**
 * Write, flush, rename. The temporary file is created beside the target so the rename
 * stays within one filesystem, which is what makes it atomic — a crash or a second
 * writer landing mid-save can never leave a half-written file.
 */
export async function writeFileAtomically(file: string, contents: string): Promise<void> {
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const handle = await open(temp, 'wx');

  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}
