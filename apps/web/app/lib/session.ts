import 'server-only';

import { jwtVerify } from 'jose';

const secretKey = process.env.JWT_SECRET;

if (!secretKey) {
    throw new Error('JWT_SECRET is missing');
}

const encodedKey = new TextEncoder().encode(secretKey);

export type SessionPayload = {
    user_id: number;
    email: string;
    exp: number;
    iat: number;
};

export async function decrypt(session?: string) {
    if (!session) return null;

    try {
        const { payload } = await jwtVerify(session, encodedKey, {
            algorithms: ['HS256'],
        });

        return payload as SessionPayload;
    } catch {
        return null;
    }
}