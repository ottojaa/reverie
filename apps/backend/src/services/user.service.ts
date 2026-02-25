import bcrypt from 'bcrypt';
import { mkdir } from 'fs/promises';
import { nanoid } from 'nanoid';
import { join } from 'path';
import { env } from '../config/env.js';
import { db } from '../db/kysely.js';
import type { User } from '../db/schema.js';

const SALT_ROUNDS = 12;
const MB = 1_000_000;
const GB = 1_000_000_000;
const TB = 1_000_000_000_000;

export interface CreateUserOptions {
    email: string;
    display_name: string;
    quota: string;
    password?: string;
}

export interface CreatedUser {
    user: User;
    password?: string;
}

function parseQuota(quotaStr: string): number {
    const match = quotaStr.match(/^(\d+(?:\.\d+)?)\s*(GB|TB|MB)$/i);

    if (!match) {
        throw new Error(`Invalid quota format: "${quotaStr}". Use format like "500GB" or "1TB"`);
    }

    const value = parseFloat(match[1]!);
    const unit = match[2]!.toUpperCase();

    switch (unit) {
        case 'GB':
            return Math.floor(value * GB);
        case 'TB':
            return Math.floor(value * TB);
        case 'MB':
            return Math.floor(value * MB);
        default:
            throw new Error(`Invalid quota unit: "${unit}". Use format like "500GB" or "1TB"`);
    }
}

function generatePassword(): string {
    return nanoid(16);
}

async function createStorageDirectory(storagePath: string): Promise<void> {
    if (env.STORAGE_PROVIDER !== 'local') return;

    const fullPath = join(env.STORAGE_LOCAL_ROOT, storagePath);
    await mkdir(fullPath, { recursive: true });
}

export async function createUser(options: CreateUserOptions): Promise<CreatedUser> {
    const { email, display_name, quota } = options;

    const existingUser = await db.selectFrom('users').selectAll().where('email', '=', email.toLowerCase()).executeTakeFirst();

    if (existingUser) {
        throw new Error(`User with email "${email}" already exists`);
    }

    const quotaBytes = parseQuota(quota);
    const password = options.password ?? generatePassword();
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const storagePathId = nanoid(12);
    const storagePath = `users/${storagePathId}`;

    const [created] = await db
        .insertInto('users')
        .values({
            email: email.toLowerCase(),
            password_hash: passwordHash,
            google_id: null,
            display_name,
            storage_quota_bytes: quotaBytes,
            storage_used_bytes: 0,
            storage_path: storagePath,
            is_active: true,
            role: 'user',
        })
        .returningAll()
        .execute();

    if (!created) {
        throw new Error('Failed to create user');
    }

    await createStorageDirectory(storagePath);

    return {
        user: created,
        password: options.password ? undefined : password,
    };
}

export async function listUsers(): Promise<User[]> {
    return db
        .selectFrom('users')
        .select(['id', 'email', 'display_name', 'storage_quota_bytes', 'storage_used_bytes', 'is_active', 'role', 'created_at', 'last_login_at'])
        .orderBy('created_at', 'desc')
        .execute() as Promise<User[]>;
}

export interface UpdateUserOptions {
    id: string;
    email?: string;
    display_name?: string;
    quota?: string;
}

export async function updateUser(options: UpdateUserOptions): Promise<User> {
    const { id, email, display_name, quota } = options;

    if (email !== undefined) {
        const existing = await db.selectFrom('users').select('id').where('email', '=', email.toLowerCase()).where('id', '!=', id).executeTakeFirst();

        if (existing) throw new Error(`User with email "${email}" already exists`);
    }

    const storage_quota_bytes = quota !== undefined ? parseQuota(quota) : undefined;
    const updates = {
        ...(email !== undefined && { email: email.toLowerCase() }),
        ...(display_name !== undefined && { display_name }),
        ...(storage_quota_bytes !== undefined && { storage_quota_bytes }),
    };

    if (Object.keys(updates).length === 0) {
        const existing = await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();

        if (!existing) throw new Error('User not found');

        return existing;
    }

    const [updated] = await db.updateTable('users').set(updates).where('id', '=', id).returningAll().execute();

    if (!updated) throw new Error('User not found');

    return updated;
}
