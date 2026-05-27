'use client';

import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { User, Mail, Lock, ArrowRight, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import * as motion from 'motion/react-client';

export default function SignupPage() {
    const router = useRouter();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [validationError, setValidationError] = useState('');
    const [success, setSuccess] = useState(false);

    const signupMutation = useMutation({
        mutationFn: async () => {
            setValidationError('');
            // Since this is a prototype, registering will call our login endpoint
            // to automatically authenticate the user.
            const response = await fetch('http://localhost:8080/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email,
                    password,
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Signup failed');
            }
            return data;
        },
        onSuccess: () => {
            setSuccess(true);
            setTimeout(() => {
                router.push('/calendar');
                router.refresh();
            }, 1000);
        },
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !email.trim() || !password.trim()) {
            setValidationError('Please fill in all fields.');
            return;
        }
        if (password.length < 8) {
            setValidationError('Password must be at least 8 characters long.');
            return;
        }
        signupMutation.mutate();
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#152331] to-[#0a0e14] p-4 text-white">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="w-full max-w-md bg-slate-900/40 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl p-8 relative overflow-hidden"
            >
                {/* Decorative glowing sphere background */}
                <div className="absolute -top-12 -left-12 w-32 h-32 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-purple-500/20 rounded-full blur-3xl pointer-events-none" />

                <div className="text-center mb-8 relative">
                    <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                        Create Account
                    </h1>
                    <p className="text-slate-400 text-sm mt-2">
                        Get started with Timely task manager
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5 relative">
                    {/* Success Alert */}
                    {success && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 text-green-400 p-3 rounded-lg text-sm"
                        >
                            <CheckCircle2 className="size-5 shrink-0" />
                            <span>Registration successful! Redirecting...</span>
                        </motion.div>
                    )}

                    {/* Error Alerts */}
                    {(validationError || signupMutation.isError) && !success && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg text-sm"
                        >
                            <AlertCircle className="size-5 shrink-0" />
                            <span>
                                {validationError || signupMutation.error?.message}
                            </span>
                        </motion.div>
                    )}

                    {/* Full Name Input */}
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-300 block">
                            Full Name
                        </label>
                        <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-slate-400" />
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="John Doe"
                                className="w-full pl-10 pr-4 py-2.5 bg-slate-950/40 border border-white/10 rounded-xl outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 transition text-sm placeholder:text-slate-500"
                            />
                        </div>
                    </div>

                    {/* Email Input */}
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-300 block">
                            Email Address
                        </label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-slate-400" />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="name@example.com"
                                className="w-full pl-10 pr-4 py-2.5 bg-slate-950/40 border border-white/10 rounded-xl outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 transition text-sm placeholder:text-slate-500"
                            />
                        </div>
                    </div>

                    {/* Password Input */}
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-300 block">
                            Password
                        </label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-slate-400" />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="•••••••• (Min 8 characters)"
                                className="w-full pl-10 pr-4 py-2.5 bg-slate-950/40 border border-white/10 rounded-xl outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 transition text-sm placeholder:text-slate-500"
                            />
                        </div>
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={signupMutation.isPending || success}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:from-blue-500/50 disabled:to-purple-600/50 rounded-xl font-semibold text-sm transition cursor-pointer shadow-lg hover:shadow-blue-500/20 active:scale-[0.98] select-none"
                    >
                        {signupMutation.isPending ? (
                            <>
                                <Loader2 className="size-5 animate-spin" />
                                Creating account...
                            </>
                        ) : (
                            <>
                                Sign Up
                                <ArrowRight className="size-4" />
                            </>
                        )}
                    </button>
                </form>

                <div className="mt-8 text-center text-sm text-slate-400 relative">
                    Already have an account?{' '}
                    <Link
                        href="/login"
                        className="text-blue-400 hover:underline font-semibold"
                    >
                        Sign in
                    </Link>
                </div>
            </motion.div>
        </div>
    );
}
