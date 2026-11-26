import { seedDocument, seedFolder } from './seed';
import { useWorld } from './tool-world';

/** Fresh documents and folders for tests that write: each test makes its own, so the shared world stays intact. */
export function useWriteFixtures() {
    const ctx = useWorld();
    let counter = 0;
    const unique = (label: string) => label + '-' + ++counter;
    const alice = () => ctx.world().alice;
    const db = () => ctx.world().db;

    async function newFolder(name = unique('F'), parent?: { id: string; path: string }) {
        return seedFolder(db(), alice(), name, parent ? { parent } : {});
    }

    /** A folder two levels down: inside a fresh folder, inside a fresh top-level one. */
    async function newSubfolder() {
        return newFolder(unique('Sub'), await newFolder(unique('Mid'), await newFolder()));
    }

    async function newDoc(opts: { folderId?: string | null; name?: string; tags?: string[] } = {}) {
        return seedDocument(db(), { userId: alice(), name: opts.name ?? unique('doc') + '.pdf', folderId: opts.folderId ?? null, tags: opts.tags ?? [] });
    }

    return { ctx, alice, db, unique, newFolder, newSubfolder, newDoc };
}
