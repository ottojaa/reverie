import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { zodToJsonSchema } from 'zod-to-json-schema';
import { callTool, listTools } from './registry';

const READ_TOOLS = ['search_documents', 'find_duplicates', 'get_document', 'list_folders', 'list_folder_contents', 'get_library_overview'];
const WRITE_TOOLS = ['add_tags', 'remove_tags', 'move_documents', 'create_folder', 'rename_folder', 'rename_document', 'undo_write'];
const ctx = { user: { id: '00000000-0000-4000-8000-000000000001' } };

describe('tool registry', () => {
    it('lists exactly the agreed tools, so a delete tool cannot slip in', () => {
        expect(listTools().map((tool) => tool.name)).toEqual([...READ_TOOLS, ...WRITE_TOOLS]);
        expect(listTools().filter((tool) => /delete|trash|purge|unlock|restore/i.test(tool.name))).toEqual([]);
    });

    it('flags read and write tools correctly', () => {
        expect(
            listTools()
                .filter((tool) => tool.access === 'read')
                .map((tool) => tool.name),
        ).toEqual(READ_TOOLS);
        expect(
            listTools()
                .filter((tool) => tool.access === 'write')
                .map((tool) => tool.name),
        ).toEqual(WRITE_TOOLS);
    });

    it('describes every tool', () => {
        for (const tool of listTools()) expect(tool.description.length, tool.name).toBeGreaterThan(40);
    });

    it('has an input schema that converts to a JSON Schema object, for MCP', () => {
        for (const tool of listTools()) {
            const schema = zodToJsonSchema(tool.inputSchema) as { type?: string; properties?: Record<string, unknown> };

            expect(schema.type, tool.name).toBe('object');
            expect(schema.properties, tool.name).toBeDefined();
        }
    });

    it('gives every write tool a dry_run flag and no read tool one', () => {
        for (const tool of listTools()) {
            const properties = (zodToJsonSchema(tool.inputSchema) as { properties: Record<string, unknown> }).properties;

            expect('dry_run' in properties, tool.name).toBe(tool.access === 'write');
        }
    });

    it('refuses an unknown tool', async () => {
        expect(await callTool('delete_documents', {}, ctx)).toEqual({ ok: false, output: { error: 'Unknown tool: delete_documents' } });
    });

    it('refuses invalid input with the field named', async () => {
        const result = await callTool('get_document', { document_id: 'not-a-uuid' }, ctx);

        expect(result.ok).toBe(false);
        expect((result.output as { error: string }).error).toMatch(/^Invalid input: document_id/);
    });

    it('keeps an unexpected failure out of the result', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        // No test database is attached in this file, so the handler throws something that is not a ToolError.
        const result = await callTool('get_library_overview', {}, ctx);

        expect(result.ok).toBe(false);
        expect(JSON.stringify(result.output)).not.toMatch(/Test database/);
        expect((result.output as { error: string }).error).toMatch(/^The tool failed/);
        expect(log).toHaveBeenCalled();
        log.mockRestore();
    });
});
