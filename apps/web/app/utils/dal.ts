import 'server-only';

import { cookies } from 'next/headers';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { decrypt } from './session';

// cache() prevents verifySession() from executing duplicate requests in a single render pass
export const verifySession = cache(async () => {
    const cookieStore = await cookies();
    const cookie = cookieStore.get('session')?.value;
    const session = await decrypt(cookie);

    if (!session?.user_id) {
        redirect('/login');
    }

    return { isAuth: true, userId: session.user_id };
});

export const getCurrentUser = cache(async () => {
    const session = await verifySession();
    if (!session) return null;

    try {
        // Return mock user data matching the verified session ID
        return {
            id: session.userId,
            name: 'Test User',
            email: 'user@example.com',
        };
    } catch {
        console.error('Failed to fetch authenticated user profile');
        return null;
    }
});
