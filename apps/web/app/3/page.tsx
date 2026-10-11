import type { Metadata } from "next";
import Link from "next/link";
import { GitHubMark } from "@/app/_components/site/marks";
import { ACCOUNT, VERSION } from "./_parts/data";
import { fontVars } from "./_parts/fonts";
import Footer from "./_parts/footer";
import Header from "./_parts/header";
import HeroStage from "./_parts/hero";
import { Keys } from "./_parts/kbd";
import { D3Motion } from "./_parts/motion";
import { AiSection, ClosingSection, DocsSheetsSection, DownloadSection, FeaturesSection, LoopSection, PrivateSection } from "./_parts/sections";
import "./_parts/design.css";

export const metadata: Metadata = {
  title: "Timely · Design 3",
  description: "A private planner you drive from the keyboard: capture a thought and Timely places it on your week.",
};

/** Design iteration 3: "Command line". Keyboard-first, amber on graphite. */
export default function DesignThree() {
  return (
    <div className={`d3 ${fontVars}`}>
      <D3Motion>
        <Header />
        <main id="main-content">
          <section className="d3-hero" aria-labelledby="d3-hero-title">
            <div className="d3-wrap d3-hero-grid">
              <div>
                <p className="d3-tagline">
                  <b>v{VERSION}</b>
                  <span className="d3-dot" aria-hidden />
                  private planner
                  <span className="d3-dot" aria-hidden />
                  open source
                </p>
                <h1 id="d3-hero-title" className="d3-h1">
                  Capture a thought. Timely finds it <em>a&nbsp;slot.</em>
                </h1>
                <p className="d3-lede">
                  Timely is a private planner for your tasks, calendar, docs and sheets. Type what is on your mind and
                  Auto-schedule places it on your week, <strong>around your meetings</strong> and{" "}
                  <strong>inside your working hours</strong>.
                </p>
                <div className="d3-cta">
                  <Link href={ACCOUNT.register} className="d3-btn d3-btn-amber">
                    Register
                  </Link>
                  <Link href={ACCOUNT.login} className="d3-btn d3-btn-ghost">
                    Log in
                  </Link>
                  <a href={ACCOUNT.github} className="d3-btn d3-btn-plain">
                    <GitHubMark />
                    GitHub
                  </a>
                </div>
                <ul className="d3-legend" aria-label="A few of Timely's shortcuts">
                  <li>
                    <Keys keys={["Ctrl", "K"]} size="sm" label="Control K" />
                    Search, create and jump anywhere
                  </li>
                  <li>
                    <Keys keys={["c"]} size="sm" />
                    New task, from any page
                  </li>
                  <li>
                    <Keys keys={["Ctrl", "Shift", "J"]} size="sm" label="Control Shift J" />
                    Ask the assistant from a quick prompt
                  </li>
                </ul>
              </div>
              <HeroStage />
            </div>
          </section>

          <AiSection />
          <LoopSection />
          <DocsSheetsSection />
          <FeaturesSection />
          <PrivateSection />
          <DownloadSection />
          <ClosingSection />
        </main>
        <Footer />
      </D3Motion>
    </div>
  );
}
