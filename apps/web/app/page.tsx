import Link from 'next/link';
import { Calendar, ListTodo, Brain, ArrowRight, ShieldCheck } from 'lucide-react';

export default function Home() {
    return (
        <div className="min-h-screen bg-linear-to-br from-[#152331] to-[#0a0e14] text-white flex flex-col justify-between selection:bg-blue-500 selection:text-white">
            {/* Header */}
            <header className="max-w-7xl w-full mx-auto px-6 py-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-linear-to-br from-blue-400 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                        <span className="font-extrabold text-white text-lg">T</span>
                    </div>
                    <span className="font-bold text-xl tracking-tight bg-linear-to-r from-white to-slate-300 bg-clip-text text-transparent">Timely</span>
                </div>
                <div className="flex items-center gap-4">
                    <Link
                        href="/login"
                        className="text-sm font-semibold text-slate-300 hover:text-white transition-colors"
                    >
                        Sign In
                    </Link>
                    <Link
                        href="/signup"
                        className="text-sm font-semibold bg-white/10 hover:bg-white/20 border border-white/10 px-4 py-2 rounded-xl transition"
                    >
                        Register
                    </Link>
                </div>
            </header>

            {/* Hero Section */}
            <main className="max-w-4xl w-full mx-auto px-6 py-12 text-center flex-1 flex flex-col justify-center items-center">
                {/* Visual badge */}
                <div className="mb-6 inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 px-3 py-1.5 rounded-full text-xs font-semibold text-blue-400">
                    <ShieldCheck className="size-4" />
                    <span>Now Protected with Secure Cookie Sessions</span>
                </div>

                <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-tight">
                    Manage Your Time <br />
                    <span className="bg-linear-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
                        Effortlessly with Timely
                    </span>
                </h1>
                <p className="text-slate-400 text-lg sm:text-xl mt-6 max-w-2xl leading-relaxed">
                    A beautiful, premium task manager and interactive calendar dashboard designed to keep your schedules, agendas, and analytical reports in perfect harmony.
                </p>

                {/* Call To Actions */}
                <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center items-center w-full max-w-sm sm:max-w-none">
                    <Link
                        href="/signup"
                        className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 bg-linear-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 rounded-xl font-bold transition shadow-xl hover:shadow-blue-500/10 active:scale-[0.98]"
                    >
                        Get Started Free
                        <ArrowRight className="size-5" />
                    </Link>
                    <Link
                        href="/login"
                        className="w-full sm:w-auto flex items-center justify-center px-8 py-4 bg-slate-900/60 hover:bg-slate-900 border border-white/10 rounded-xl font-semibold transition"
                    >
                        Sign In Demo
                    </Link>
                </div>

                {/* Features Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-20 w-full text-left">
                    <div className="bg-slate-900/30 border border-white/5 p-6 rounded-2xl backdrop-blur-sm">
                        <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
                            <Calendar className="text-blue-400 size-6" />
                        </div>
                        <h3 className="font-bold text-lg mb-2 text-slate-100">Fluid Calendar</h3>
                        <p className="text-slate-400 text-sm leading-relaxed">
                            Organize appointments across Month, Week, and Day views with smooth, hardware-accelerated transitions.
                        </p>
                    </div>

                    <div className="bg-slate-900/30 border border-white/5 p-6 rounded-2xl backdrop-blur-sm">
                        <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4">
                            <ListTodo className="text-purple-400 size-6" />
                        </div>
                        <h3 className="font-bold text-lg mb-2 text-slate-100">Task Boards</h3>
                        <p className="text-slate-400 text-sm leading-relaxed">
                            Track to-dos, priorities, deadlines, and project labels with modern productivity views.
                        </p>
                    </div>

                    <div className="bg-slate-900/30 border border-white/5 p-6 rounded-2xl backdrop-blur-sm">
                        <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4">
                            <Brain className="text-indigo-400 size-6" />
                        </div>
                        <h3 className="font-bold text-lg mb-2 text-slate-100">Productivity Reports</h3>
                        <p className="text-slate-400 text-sm leading-relaxed">
                            Analyze focus hours, blockades, and scheduled activities through clean visual summaries.
                        </p>
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="border-t border-white/5 py-8 px-6 text-center text-sm text-slate-500">
                <p>&copy; {new Date().getFullYear()} Timely Inc. All rights reserved.</p>
            </footer>
        </div>
    );
}
