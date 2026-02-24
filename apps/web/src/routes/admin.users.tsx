import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { adminApi } from '@/lib/api/admin';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, formatFileSize } from '@/lib/commonhelpers';
import type { User } from '@reverie/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Pencil, Users } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

export const Route = createFileRoute('/admin/users')({
    component: AdminUsersPage,
});

function AdminUsersPage() {
    const { user, accessToken } = useAuth();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);

    const [email, setEmail] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [quota, setQuota] = useState('500GB');
    const [password, setPassword] = useState('');
    const [generatePassword, setGeneratePassword] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<{ email: string; password?: string } | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const { data: users = [], isLoading: usersLoading } = useQuery({
        queryKey: ['admin', 'users'],
        queryFn: () => adminApi.listUsers(),
        enabled: !!accessToken && user?.role === 'admin',
    });

    const updateUserMutation = useMutation({
        mutationFn: ({ id, body }: { id: string; body: { email?: string; display_name?: string; quota?: string } }) => adminApi.updateUser(id, body),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
            setEditDialogOpen(false);
            setEditingUser(null);
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'Failed to update user'),
    });

    useEffect(() => {
        if (user && user.role !== 'admin') {
            navigate({ to: '/browse' });
        }
    }, [user, navigate]);

    const handleCreateSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        setIsLoading(true);

        try {
            if (!accessToken) throw new Error('Not authenticated');

            if (!generatePassword && password.length < 8) {
                setError('Password must be at least 8 characters');
                setIsLoading(false);

                return;
            }

            const body = {
                email,
                display_name: displayName,
                quota,
                ...(generatePassword ? {} : { password }),
            };

            const result = await adminApi.createUser(body);

            setSuccess({
                email: result.user.email,
                password: result.password,
            });
            setEmail('');
            setDisplayName('');
            setQuota('500GB');
            setPassword('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create user');
        } finally {
            setIsLoading(false);
        }
    };

    const handleEditSubmit = async (e: FormEvent) => {
        e.preventDefault();

        if (!editingUser || !accessToken) return;

        setError(null);
        updateUserMutation.mutate({
            id: editingUser.id,
            body: {
                email: email || undefined,
                display_name: displayName || undefined,
                quota: quota || undefined,
            },
        });
    };

    const openEditDialog = (u: User) => {
        setEditingUser(u);

        setEmail(u.email);
        setDisplayName(u.display_name);
        setQuota(formatFileSize(u.storage_quota_bytes));

        setError(null);
        setEditDialogOpen(true);
    };

    const handleCloseCreateDialog = (open: boolean) => {
        if (!open) {
            setError(null);
            setSuccess(null);
        }

        setCreateDialogOpen(open);
    };

    const handleCloseEditDialog = (open: boolean) => {
        if (!open) {
            setEditingUser(null);
            setError(null);
            updateUserMutation.reset();
        }

        setEditDialogOpen(open);
    };

    if (!user) return null;

    if (user.role !== 'admin') {
        return null;
    }

    return (
        <div className="container p-6">
            <div className="mb-6 flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
                <Button onClick={() => setCreateDialogOpen(true)}>
                    <Users className="mr-2 size-4" />
                    Create User
                </Button>
            </div>

            <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
                {usersLoading ? (
                    <div className="p-8 space-y-4">
                        {[1, 2, 3, 4, 5].map((i) => (
                            <Skeleton key={i} className="h-12 w-full" />
                        ))}
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Email</TableHead>
                                <TableHead>Display Name</TableHead>
                                <TableHead>Storage</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead>Last Login</TableHead>
                                <TableHead className="w-12" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {users.map((u) => (
                                <TableRow key={u.id}>
                                    <TableCell className="font-medium">{u.email}</TableCell>
                                    <TableCell>{u.display_name}</TableCell>
                                    <TableCell>
                                        <div className="min-w-[140px]">
                                            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-success rounded-full transition-all duration-500"
                                                    style={{
                                                        width: `${Math.min(
                                                            u.storage_quota_bytes > 0 ? (u.storage_used_bytes / u.storage_quota_bytes) * 100 : 0,
                                                            100,
                                                        )}%`,
                                                    }}
                                                />
                                            </div>
                                            <span className="text-xs text-muted-foreground">
                                                {formatFileSize(u.storage_used_bytes)} of {formatFileSize(u.storage_quota_bytes)} used
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{formatDate(u.created_at)}</TableCell>
                                    <TableCell className="text-muted-foreground">{u.last_login_at ? formatDateTime(u.last_login_at) : '—'}</TableCell>
                                    <TableCell>
                                        <Button variant="ghost" size="icon" className="size-8" onClick={() => openEditDialog(u)} aria-label={`Edit ${u.email}`}>
                                            <Pencil className="size-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>

            <Dialog open={createDialogOpen} onOpenChange={handleCloseCreateDialog}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Create User</DialogTitle>
                        <DialogDescription>Add a new user. Leave password empty to auto-generate.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreateSubmit} className="space-y-4">
                        {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
                        {success && (
                            <div className="rounded-md bg-success/10 p-3 text-sm text-success">
                                User created: {success.email}
                                {success.password && <div className="mt-2 font-mono text-xs">Password (save this): {success.password}</div>}
                            </div>
                        )}
                        <div className="space-y-2">
                            <label htmlFor="create-email" className="text-sm font-medium">
                                Email
                            </label>
                            <Input
                                id="create-email"
                                type="email"
                                placeholder="user@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                disabled={isLoading}
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="create-displayName" className="text-sm font-medium">
                                Display Name
                            </label>
                            <Input
                                id="create-displayName"
                                type="text"
                                placeholder="Jane Doe"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                required
                                disabled={isLoading}
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="create-quota" className="text-sm font-medium">
                                Storage Quota
                            </label>
                            <Input
                                id="create-quota"
                                type="text"
                                placeholder="500GB or 1TB"
                                value={quota}
                                onChange={(e) => setQuota(e.target.value)}
                                required
                                disabled={isLoading}
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <Checkbox id="generatePassword" checked={generatePassword} onCheckedChange={(checked) => setGeneratePassword(checked === true)} />
                            <label htmlFor="generatePassword" className="text-sm">
                                Auto-generate password
                            </label>
                        </div>
                        {!generatePassword && (
                            <div className="space-y-2">
                                <label htmlFor="create-password" className="text-sm font-medium">
                                    Password
                                </label>
                                <Input
                                    id="create-password"
                                    type="password"
                                    placeholder="Min 8 characters"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    minLength={8}
                                    disabled={isLoading}
                                />
                            </div>
                        )}
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => handleCloseCreateDialog(false)} disabled={isLoading}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isLoading}>
                                {isLoading ? 'Creating...' : 'Create User'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={editDialogOpen} onOpenChange={handleCloseEditDialog}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Edit User</DialogTitle>
                        <DialogDescription>Update email, display name, or storage quota. Leave fields unchanged to keep current values.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleEditSubmit} className="space-y-4">
                        {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
                        <div className="space-y-2">
                            <label htmlFor="edit-email" className="text-sm font-medium">
                                Email
                            </label>
                            <Input
                                id="edit-email"
                                type="email"
                                placeholder="user@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                disabled={updateUserMutation.isPending}
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="edit-displayName" className="text-sm font-medium">
                                Display Name
                            </label>
                            <Input
                                id="edit-displayName"
                                type="text"
                                placeholder="Jane Doe"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                required
                                disabled={updateUserMutation.isPending}
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="edit-quota" className="text-sm font-medium">
                                Storage Quota
                            </label>
                            <Input
                                id="edit-quota"
                                type="text"
                                placeholder="500GB or 1TB"
                                value={quota}
                                onChange={(e) => setQuota(e.target.value)}
                                required
                                disabled={updateUserMutation.isPending}
                            />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => handleCloseEditDialog(false)} disabled={updateUserMutation.isPending}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={updateUserMutation.isPending}>
                                {updateUserMutation.isPending ? 'Saving...' : 'Save'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
