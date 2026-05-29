'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { useState } from 'react';

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
            {children}
        </QueryClientProvider>
    );
}
