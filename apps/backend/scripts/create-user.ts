#!/usr/bin/env node
/**
 * Script to create a new user in the Reverie system
 *
 * Usage:
 *   npx tsx apps/backend/scripts/create-user.ts --email "user@example.com" --name "John Doe" --quota "500GB"
 *   npx tsx apps/backend/scripts/create-user.ts --email "user@example.com" --name "Jane" --quota "1TB" --google-id "123456789"
 *   npx tsx apps/backend/scripts/create-user.ts --email "user@example.com" --name "Bob" --quota "500GB" --password "mypassword123"
 */

import bcrypt from 'bcrypt';
import { config } from 'dotenv';
import { mkdir } from 'fs/promises';
import { nanoid } from 'nanoid';
import { join } from 'path';

// Load .env (env.ts also loads from repo root via __dirname; this covers script entry)
config({ path: join(process.cwd(), '.env') });

import { env } from '../src/config/env.js';
import { db } from '../src/db/kysely.js';

const SALT_ROUNDS = 12;

interface CreateUserOptions {
    email: string;
    name: string;
    quota: string; // e.g., "500GB", "1TB"
    password?: string;
    googleId?: string;
}

/**
 * Parse quota string to bytes
 * Supports: GB, TB (case insensitive)
 */
function parseQuota(quotaStr: string): number {
    const match = quotaStr.match(/^(\d+(?:\.\d+)?)\s*(GB|TB)$/i);
    if (!match) {
        throw new Error(`Invalid quota format: "${quotaStr}". Use format like "500GB" or "1TB"`);
    }

    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();

    if (unit === 'GB') {
        return Math.floor(value * 1024 * 1024 * 1024);
    } else if (unit === 'TB') {
        return Math.floor(value * 1024 * 1024 * 1024 * 1024);
    }

    throw new Error(`Unknown unit: ${unit}`);
}

/**
 * Generate a secure random password
 */
function generatePassword(): string {
    // Generate a 16-character alphanumeric password
    return nanoid(16);
}

/**
 * Create user storage directory
 */
async function createStorageDirectory(storagePath: string): Promise<void> {
    const fullPath = join(env.STORAGE_LOCAL_ROOT, storagePath);

    await mkdir(fullPath, { recursive: true });

    console.log(`Created storage directory: ${fullPath}`);
}

/**
 * Create a new user
 */
async function createUser(options: CreateUserOptions): Promise<void> {
    const { email, name, quota, googleId } = options;

    // Check if user already exists
    const existingUser = await db.selectFrom('users').selectAll().where('email', '=', email.toLowerCase()).executeTakeFirst();

    if (existingUser) {
        throw new Error(`User with email "${email}" already exists`);
    }

    // Parse quota
    const quotaBytes = parseQuota(quota);

    // Generate or use provided password
    const password = options.password || generatePassword();
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Generate unique storage path using user ID (will be set after insert)
    // We'll use a nanoid for the directory name for security
    const storagePathId = nanoid(12);
    const storagePath = `users/${storagePathId}`;

    // Create user in database
    const [user] = await db
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

    // Create storage directory
    await createStorageDirectory(storagePath);

    // Output results
    console.log('\n✅ User created successfully!\n');
    console.log('User Details:');
    console.log('─'.repeat(40));
    console.log(`  ID:           ${user.id}`);
    console.log(`  Email:        ${user.email}`);
    console.log(`  Display Name: ${user.display_name}`);
    console.log(`  Storage Path: ${user.storage_path}`);
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

/**
 * Parse command line arguments
 */
function parseArgs(): CreateUserOptions {
    const args = process.argv.slice(2);
    const options: Partial<CreateUserOptions> = {};

    for (let i = 0; i < args.length; i += 2) {
        const flag = args[i];
        const value = args[i + 1];

        switch (flag) {
            case '--email':
            case '-e':
                options.email = value;
                break;
            case '--name':
            case '-n':
                options.name = value;
                break;
            case '--quota':
            case '-q':
                options.quota = value;
                break;
            case '--password':
            case '-p':
                options.password = value;
                break;
            case '--google-id':
            case '-g':
                options.googleId = value;
                break;
            case '--help':
            case '-h':
                printUsage();
                process.exit(0);
            default:
                console.error(`Unknown flag: ${flag}`);
                printUsage();
                process.exit(1);
        }
    }

    // Validate required fields
    if (!options.email) {
        console.error('Error: --email is required');
        printUsage();
        process.exit(1);
    }

    if (!options.name) {
        console.error('Error: --name is required');
        printUsage();
        process.exit(1);
    }

    if (!options.quota) {
        console.error('Error: --quota is required');
        printUsage();
        process.exit(1);
    }

    return options as CreateUserOptions;
}

function printUsage(): void {
    console.log(`
Usage: npx tsx scripts/create-user.ts [options]

Options:
  --email, -e      User's email address (required)
  --name, -n       User's display name (required)
  --quota, -q      Storage quota, e.g., "500GB" or "1TB" (required)
  --password, -p   User's password (optional, auto-generated if not provided)
  --google-id, -g  Google account ID for OAuth login (optional)
  --help, -h       Show this help message

Examples:
  npx tsx scripts/create-user.ts --email "user@example.com" --name "John Doe" --quota "500GB"
  npx tsx scripts/create-user.ts -e "user@example.com" -n "Jane" -q "1TB" -g "123456789"
  npx tsx scripts/create-user.ts -e "user@example.com" -n "Bob" -q "500GB" -p "mypassword123"
`);
}

// Main execution
async function main() {
    try {
        const options = parseArgs();
        await createUser(options);
    } catch (error) {
        console.error('\n❌ Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    } finally {
        // Close database connection
        await db.destroy();
    }
}

main();
