import { createDbProxy } from './test-database';

/**
 * The `db` that `vi.mock('../db/kysely', ...)` hands to the code under test. It lives in its own
 * module so the mock factory can import it without pulling in the tools (which import `db/kysely`).
 */
export const dbProxy = createDbProxy();
