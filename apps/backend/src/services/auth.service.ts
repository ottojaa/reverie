import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { db } from '../db/kysely.js';
import type { User } from '../db/schema.js';

const SALT_ROUNDS = 12;

export interface TokenPair {
    access_token: string;
    refresh_token: string;
    expires_in: number; // seconds
}

export interface AuthenticatedUser {
    user: User;
    tokens: TokenPair;
}

export class AuthService {
    constructor(private fastify: FastifyInstance) {}

    /**
     * Hash a password using bcrypt
     */
    async hashPassword(password: string): Promise<string> {
        return bcrypt.hash(password, SALT_ROUNDS);
    }

    /**
     * Verify a password against a hash
     */
    async verifyPassword(password: string, hash: string): Promise<boolean> {
        return bcrypt.compare(password, hash);
    }

    /**
     * Find a user by email
     */
    async findUserByEmail(email: string): Promise<User | undefined> {
        return db.selectFrom('users').selectAll().where('email', '=', email.toLowerCase()).executeTakeFirst();
    }

    /**
     * Find a user by ID
     */
    async findUserById(id: string): Promise<User | undefined> {
        return db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
    }

    /**
     * Find a user by Google ID
     */
    async findUserByGoogleId(googleId: string): Promise<User | undefined> {
        return db.selectFrom('users').selectAll().where('google_id', '=', googleId).executeTakeFirst();
    }

    /**
     * Generate access and refresh tokens for a user
     */
    generateTokens(user: User): TokenPair {
        const payload = {
            sub: user.id,
            email: user.email,
        };

        const access_token = this.fastify.jwt.sign(payload);

        // Refresh token with longer expiry
        const refresh_token = this.fastify.jwt.sign(payload, {
            expiresIn: env.JWT_REFRESH_EXPIRES,
        });

        // Parse expires_in from env (e.g., "15m" -> 900 seconds)
        const expires_in = this.parseExpiresIn(env.JWT_ACCESS_EXPIRES);

        return { access_token, refresh_token, expires_in };
    }

    /**
     * Verify a refresh token and return the payload
     */
    async verifyRefreshToken(token: string): Promise<{ sub: string; email: string } | null> {
        try {
            const decoded = this.fastify.jwt.verify<{ sub: string; email: string }>(token);
            return decoded;
        } catch {
            return null;
        }
    }

    /**
     * Authenticate with email and password
     */
    async authenticateWithPassword(email: string, password: string): Promise<AuthenticatedUser | null> {
        const user = await this.findUserByEmail(email);

        if (!user || !user.password_hash) {
            return null;
        }

        if (!user.is_active) {
            return null;
        }

        const isValid = await this.verifyPassword(password, user.password_hash);
        if (!isValid) {
            return null;
        }

        // Update last login
        await db.updateTable('users').set({ last_login_at: new Date() }).where('id', '=', user.id).execute();

        const tokens = this.generateTokens(user);
        return { user, tokens };
    }

    /**
     * Authenticate with Google (for existing users only)
     */
    async authenticateWithGoogle(googleId: string): Promise<AuthenticatedUser | null> {
        const user = await this.findUserByGoogleId(googleId);

        if (!user || !user.is_active) {
            return null;
        }

        // Update last login
        await db.updateTable('users').set({ last_login_at: new Date() }).where('id', '=', user.id).execute();

        const tokens = this.generateTokens(user);
        return { user, tokens };
    }

    /**
     * Change a user's password
     */
    async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
        const user = await this.findUserById(userId);

        if (!user || !user.password_hash) {
            return false;
        }

        const isValid = await this.verifyPassword(currentPassword, user.password_hash);
        if (!isValid) {
            return false;
        }

        const newHash = await this.hashPassword(newPassword);

        await db.updateTable('users').set({ password_hash: newHash }).where('id', '=', userId).execute();

        return true;
    }

    /**
     * Link a Google account to an existing user
     */
    async linkGoogleAccount(userId: string, googleId: string): Promise<boolean> {
        try {
            await db.updateTable('users').set({ google_id: googleId }).where('id', '=', userId).execute();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Parse duration string to seconds (e.g., "15m" -> 900)
     */
    private parseExpiresIn(duration: string): number {
        const match = duration.match(/^(\d+)([smhd])$/);
        if (!match) {
            return 900; // default 15 minutes
        }

        const value = parseInt(match[1] ?? '900', 10);
        const unit = match[2];

        switch (unit) {
            case 's':
                return value;
            case 'm':
                return value * 60;
            case 'h':
                return value * 60 * 60;
            case 'd':
                return value * 60 * 60 * 24;
            default:
                return 900;
        }
    }
}

// Factory function to create auth service (needs fastify instance for JWT)
export function createAuthService(fastify: FastifyInstance): AuthService {
    return new AuthService(fastify);
}
