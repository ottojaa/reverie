import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { authApi } from '../lib/api/auth-api';
import { useAuth } from '../lib/auth';

export const Route = createFileRoute('/settings')({
    component: SettingsPage,
});

function SettingsPage() {
    const { user, logout } = useAuth();

    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const formatBytes = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;

        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };

    const handleChangePassword = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        if (newPassword !== confirmPassword) {
            setError('New passwords do not match');

            return;
        }

        if (newPassword.length < 8) {
            setError('New password must be at least 8 characters');

            return;
        }

        setIsLoading(true);

        try {
            await authApi.changePassword(currentPassword, newPassword);
            setSuccess('Password changed successfully');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to change password');
        } finally {
            setIsLoading(false);
        }
    };

    if (!user) {
        return null;
    }

    const storagePercentage = (user.storage_used_bytes / user.storage_quota_bytes) * 100;

    return (
        <div className="container p-6">
            <div className="space-y-6 w-full">
                <h1 className="text-2xl font-bold mb-8">Settings</h1>
                {/* Account Info */}
                <Card>
                    <CardHeader>
                        <CardTitle>Account Information</CardTitle>
                        <CardDescription>Your account details</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <label className="text-sm font-medium text-muted-foreground">Display Name</label>
                            <p className="text-lg">{user.display_name}</p>
                        </div>
                        <div>
                            <label className="text-sm font-medium text-muted-foreground">Email</label>
                            <p className="text-lg">{user.email}</p>
                        </div>
                    </CardContent>
                </Card>

                {/* Storage Usage */}
                <Card>
                    <CardHeader>
                        <CardTitle>Storage</CardTitle>
                        <CardDescription>Your storage usage</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <div className="flex justify-between text-sm mb-2">
                                <span>{formatBytes(user.storage_used_bytes)} used</span>
                                <span>{formatBytes(user.storage_quota_bytes)} total</span>
                            </div>
                            <div className="h-2 bg-secondary rounded-full overflow-hidden">
                                <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(storagePercentage, 100)}%` }} />
                            </div>
                            <p className="text-sm text-muted-foreground mt-2">{storagePercentage.toFixed(1)}% used</p>
                        </div>
                    </CardContent>
                </Card>

                {/* Change Password */}
                <Card>
                    <CardHeader>
                        <CardTitle>Change Password</CardTitle>
                        <CardDescription>Update your account password</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleChangePassword} className="space-y-4">
                            {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
                            {success && <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-600">{success}</div>}

                            <div className="space-y-2">
                                <label htmlFor="currentPassword" className="text-sm font-medium">
                                    Current Password
                                </label>
                                <Input
                                    id="currentPassword"
                                    type="password"
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    required
                                    disabled={isLoading}
                                />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="newPassword" className="text-sm font-medium">
                                    New Password
                                </label>
                                <Input
                                    id="newPassword"
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    required
                                    disabled={isLoading}
                                    minLength={8}
                                />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="confirmPassword" className="text-sm font-medium">
                                    Confirm New Password
                                </label>
                                <Input
                                    id="confirmPassword"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                    disabled={isLoading}
                                />
                            </div>

                            <Button type="submit" disabled={isLoading}>
                                {isLoading ? 'Changing...' : 'Change Password'}
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                {/* Logout */}
                <Card>
                    <CardHeader>
                        <CardTitle>Sign Out</CardTitle>
                        <CardDescription>Sign out of your account</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button variant="outline" onClick={logout}>
                            Sign Out
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
