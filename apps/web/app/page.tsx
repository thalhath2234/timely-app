import Link from 'next/link';
import { Calendar, ListTodo, Brain, ArrowRight, ShieldCheck } from 'lucide-react';

export default function Home() {
    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col justify-between selection:bg-primary selection:text-primary-foreground">
            {/* Header */}
            <header className="max-w-7xl w-full mx-auto px-6 py-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg">
                        <span className="font-extrabold text-lg">T</span>
                    </div>
                    <span className="font-bold text-xl tracking-tight">Timely</span>
                </div>
                <div className="flex items-center gap-4">
                    <Link
                        href="/login"
                        className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Sign In
                    </Link>
                    <Link
                        href="/signup"
                        className="text-sm font-semibold bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground border border-border px-4 py-2 rounded-xl transition"
                    >
                        Register
                    </Link>
                </div>
            </header>

            {/* Hero Section */}
            <main className="max-w-4xl w-full mx-auto px-6 py-12 text-center flex-1 flex flex-col justify-center items-center">
                {/* Visual badge */}
                <div className="mb-6 inline-flex items-center gap-2 bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-4xl text-xs font-semibold text-primary">
                    <ShieldCheck className="size-4" />
                    <span>Now Protected with Secure Cookie Sessions</span>
                </div>

                <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight leading-tight text-balance">
                    Manage Your Time <br />
                    <span className="text-primary">
                        Effortlessly with Timely
                    </span>
                </h1>
                <p className="text-muted-foreground text-lg sm:text-xl mt-6 max-w-2xl leading-relaxed text-pretty">
                    A beautiful, premium task manager and interactive calendar dashboard designed to keep your schedules, agendas, and analytical reports in perfect harmony.
                </p>

                {/* Call To Actions */}
                <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center items-center w-full max-w-sm sm:max-w-none">
                    <Link
                        href="/signup"
                        className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl font-semibold transition shadow-sm active:scale-[0.98]"
                    >
                        Get Started Free
                        <ArrowRight className="size-5" />
                    </Link>
                    <Link
                        href="/login"
                        className="w-full sm:w-auto flex items-center justify-center px-8 py-4 bg-card hover:bg-accent hover:text-accent-foreground border border-border rounded-xl font-semibold transition"
                    >
                        Sign In
                    </Link>
                </div>

                {/* Features Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-20 w-full text-left">
                    <div className="bg-card border border-border p-6 rounded-2xl">
                        <div className="w-12 h-12 rounded-xl bg-chart-1/10 border border-chart-1/20 flex items-center justify-center mb-4">
                            <Calendar className="text-chart-1 size-6" />
                        </div>
                        <h3 className="font-semibold text-lg mb-2 text-card-foreground">Fluid Calendar</h3>
                        <p className="text-muted-foreground text-sm leading-relaxed">
                            Organize appointments across Month, Week, and Day views with smooth, hardware-accelerated transitions.
                        </p>
                    </div>

                    <div className="bg-card border border-border p-6 rounded-2xl">
                        <div className="w-12 h-12 rounded-xl bg-chart-3/10 border border-chart-3/20 flex items-center justify-center mb-4">
                            <ListTodo className="text-chart-3 size-6" />
                        </div>
                        <h3 className="font-semibold text-lg mb-2 text-card-foreground">Task Boards</h3>
                        <p className="text-muted-foreground text-sm leading-relaxed">
                            Track to-dos, priorities, deadlines, and project labels with modern productivity views.
                        </p>
                    </div>

                    <div className="bg-card border border-border p-6 rounded-2xl">
                        <div className="w-12 h-12 rounded-xl bg-chart-2/10 border border-chart-2/20 flex items-center justify-center mb-4">
                            <Brain className="text-chart-2 size-6" />
                        </div>
                        <h3 className="font-semibold text-lg mb-2 text-card-foreground">Productivity Reports</h3>
                        <p className="text-muted-foreground text-sm leading-relaxed">
                            Analyze focus hours, blockades, and scheduled activities through clean visual summaries.
                        </p>
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="border-t border-border py-8 px-6 text-center text-sm text-muted-foreground">
                <p>&copy; {new Date().getFullYear()} Timely Inc. All rights reserved.</p>
            </footer>
        </div>
    );
}
