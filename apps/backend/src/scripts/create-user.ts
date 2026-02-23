#!/usr/bin/env node
/**
 * Script to create a new user in the Reverie system
 *
 * Usage:
 *   npx tsx apps/backend/src/scripts/create-user.ts          # interactive (dev)
 *   npx tsx apps/backend/src/scripts/create-user.ts --prod   # interactive, use .env.prod
 *   In Docker: docker exec -it reverie-backend sh -c 'cd apps/backend/dist && pnpm run create-user'
 */

// Parse --prod before imports so env.ts loads .env.prod
const prodIdx = process.argv.indexOf('--prod');

if (prodIdx !== -1) {

    const next = process.argv[prodIdx + 1];

    if (next !== 'false' && next !== '0') {
        process.env.ENV_FILE = '.env.prod';
    }
}

import bcrypt from 'bcrypt';
import { mkdir } from 'fs/promises';
import { nanoid } from 'nanoid';
import { join } from 'path';
import prompts from 'prompts';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

type AppDb = (typeof import('../db/kysely.js'))['db'];

let db: AppDb | null = null;
let storageRoot = '';

const SALT_ROUNDS = 12;

interface CreateUserOptions {
    email: string;
    name: string;
    quota: string;
    password?: string;
    googleId?: string;
}

function parseQuota(quotaStr: string): number {
    const match = quotaStr.match(/^(\d+(?:\.\d+)?)\s*(GB|TB)$/i);

    if (!match) {
        throw new Error(`Invalid quota format: "${quotaStr}". Use format like "500GB" or "1TB"`);
    }

    const value = parseFloat(match[1]!);
    const unit = match[2]!.toUpperCase();

    if (unit === 'GB') {
        return Math.floor(value * 1024 * 1024 * 1024);
    }

    return Math.floor(value * 1024 * 1024 * 1024 * 1024);
}

function generatePassword(): string {
    return nanoid(16);
}

async function createStorageDirectory(storagePath: string): Promise<void> {
    const fullPath = join(storageRoot, storagePath);

    await mkdir(fullPath, { recursive: true });

    console.log(`Created storage directory: ${fullPath}`);
}

async function createUser(options: CreateUserOptions): Promise<void> {
    const { email, name, quota, googleId } = options;

    if (!db) {
        throw new Error('Database not initialized');
    }

    const existingUser = await db.selectFrom('users').selectAll().where('email', '=', email.toLowerCase()).executeTakeFirst();

    if (existingUser) {
        throw new Error(`User with email "${email}" already exists`);
    }

    const quotaBytes = parseQuota(quota);
    const password = options.password || generatePassword();
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const storagePathId = nanoid(12);
    const storagePath = `users/${storagePathId}`;

    const [created] = await db
        .insertInto('users')
        .values({
            email: email.toLowerCase(),
            password_hash: passwordHash,
            google_id: googleId || null,
            display_name: name,
            storage_quota_bytes: quotaBytes,
            storage_used_bytes: 0,
            storage_path: storagePath,
            is_active: true,
        })
        .returning(['id', 'email', 'display_name', 'storage_path'])
        .execute();

    if (!created) {
        throw new Error('Failed to create user');
    }
    await createStorageDirectory(storagePath);

    console.log('\n✅ User created successfully!\n');
    console.log('User Details:');
    console.log('─'.repeat(40));
    console.log(`  ID:           ${created.id}`);
    console.log(`  Email:        ${created.email}`);
    console.log(`  Display Name: ${created.display_name}`);
    console.log(`  Storage Path: ${created.storage_path}`);
    console.log(`  Quota:        ${quota}`);

    if (googleId) {
        console.log(`  Google ID:    ${googleId}`);
    }

    if (!options.password) {
        console.log('\n⚠️  Generated password (save this - it cannot be recovered):');
        console.log(`  Password:     ${password}`);
    }

    console.log('');
}

async function getOptions(): Promise<CreateUserOptions> {
    const argv = await yargs(hideBin(process.argv))
        .option('email', {
            alias: 'e',
            type: 'string',
            description: "User's email address",
        })
        .option('name', {
            alias: 'n',
            type: 'string',
            description: "User's display name",
        })
        .option('quota', {
            alias: 'q',
            type: 'string',
            description: 'Storage quota, e.g. 500GB or 1TB',
        })
        .option('password', {
            alias: 'p',
            type: 'string',
            description: "User's password (optional, auto-generated if not provided)",
        })
        .option('google-id', {
            alias: 'g',
            type: 'string',
            description: 'Google account ID for OAuth login',
            required: false,
        })
        .option('prod', {
            type: 'boolean',
            default: false,
            description: 'Use .env.prod',
        })
        .help()
        .parse();

    const hasAllRequired = argv.email && argv.name && argv.quota;

    if (hasAllRequired) {
        return {
            email: argv.email!,
            name: argv.name!,
            quota: argv.quota!,
            password: argv.password,
            googleId: argv['google-id'],
        };
    }

    prompts.override(argv);

    const response = await prompts(
        [
            {
                type: argv.email ? null : 'text',
                name: 'email',
                message: 'Email?',
                validate: (v: string) => (!v || !v.includes('@') ? 'Valid email required' : true),
            },
            {
                type: argv.name ? null : 'text',
                name: 'name',
                message: 'Display name?',
                validate: (v: string) => (!v || !v.trim() ? 'Name required' : true),
            },
            {
                type: argv.quota ? null : 'text',
                name: 'quota',
                message: 'Storage quota? (e.g. 500GB, 1TB)',
                initial: '500GB',
                validate: (v: string) => (!/^\d+(?:\.\d+)?\s*(GB|TB)$/i.test(v || '') ? 'Use format like 500GB or 1TB' : true),
            },
            {
                type: 'text',
                name: 'password',
                message: 'Password? (optional, press enter to auto-generate)',
            },
            {
                type: 'text',
                name: 'googleId',
                message: 'Google ID? (optional, for OAuth)',
            },
        ],
        {
            onCancel: () => {
                process.exit(1);
            },
        },
    );

    const merged = { ...argv, ...response };

    return {
        email: merged.email,
        name: merged.name,
        quota: merged.quota,
        password: merged.password || undefined,
        googleId: merged.googleId || merged['google-id'] || undefined,
    };
}

async function main(): Promise<void> {
    try {
        const options = await getOptions();

        if (!options.email || !options.name || !options.quota) {
            console.error('Error: email, name, and quota are required');
            process.exit(1);
        }

        const envModule = await import('../config/env.js');
        const dbModule = await import('../db/kysely.js');
        storageRoot = envModule.env.STORAGE_LOCAL_ROOT;
        db = dbModule.db;

        await createUser(options);
    } catch (error) {
        console.error('\n❌ Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    } finally {
        if (db) {
            await db.destroy();
        }
    }
}

main();
