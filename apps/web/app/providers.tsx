'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import React, { useState } from 'react';
import ClientRuntime from './_components/_layout/clientRuntime';

export default function Providers({ children }: { children: React.ReactNode }) {
    // Creating the query client within a useState initializer ensures it is
    // only instantiated once per page load and not recreated on subsequent renders.
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 60 * 1000, // 1 minute
                        refetchOnWindowFocus: false, // Turn off for predictable prototyping
                    },
                },
            })
    );

    return (
        <QueryClientProvider client={queryClient}>
            <MotionConfig reducedMotion="user">
                <ClientRuntime>{children}</ClientRuntime>
            </MotionConfig>
        </QueryClientProvider>
    );
}
