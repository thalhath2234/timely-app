import type { Metadata } from "next";
import pkg from "@/package.json";
import AiRows from "./_parts/ai";
import DocsSheets from "./_parts/docsSheets";
import { Closing, Downloads } from "./_parts/ends";
import Footer from "./_parts/footer";
import Header from "./_parts/header";
import Hero from "./_parts/hero";
import Loop from "./_parts/loop";
import More from "./_parts/more";
import { BreakBand, WorkSection } from "./_parts/pacing";
import Private from "./_parts/private";
import Shell from "./_parts/shell";

export const metadata: Metadata = { title: { absolute: "Timely · Design 5" } };

/**
 * Design iteration 5, "Focus": the page is paced like one Pomodoro cycle.
 * Four work sessions, short breaks between them, a long break, then done.
 */
export default function DesignFive() {
  return (
    <Shell>
      <Header />
      <main id="main-content">
        <Hero />

        <WorkSection
          id="ai"
          session={1}
          title={
            <>
              An assistant that runs on <span className="it">your</span> plan.
            </>
          }
          lead="Timely's AI uses the Claude or ChatGPT subscription you already have. It drafts, proposes and fills things in, and you stay the one who presses Apply."
        >
          <AiRows />
        </WorkSection>

        <BreakBand line="Look away from the screen. Nothing changes until you choose Apply changes." />

        <WorkSection
          id="how-it-works"
          session={2}
          title={
            <>
              One thought, <span className="it">one morning.</span>
            </>
          }
          lead="Everything in Timely follows one loop: capture, clarify, auto-schedule, focus. Here is a single task going all the way round."
        >
          <Loop />
        </WorkSection>

        <BreakBand line="Stand up and stretch. Your next block is already on the calendar." />

        <WorkSection
          id="docs-and-sheets"
          session={3}
          title={
            <>
              Docs and sheets, <span className="it">inside the plan.</span>
            </>
          }
          lead="Write the brief and track the budget right next to the tasks they are for, without a second app."
        >
          <DocsSheets />
        </WorkSection>

        <BreakBand line="Refill your water. Whatever you wrote, search will find it later." />

        <WorkSection
          id="features"
          session={4}
          title={
            <>
              Everything else, <span className="it">within reach.</span>
            </>
          }
          lead="The rest of the day-to-day: search, a dashboard, habits and goals, calendar views, and tasks three ways."
        >
          <More />
        </WorkSection>

        <WorkSection
          id="private"
          kind="Long break"
          minutes={15}
          color="var(--sand)"
          title={
            <>
              Private, <span className="it">by staying home.</span>
            </>
          }
          lead="Timely runs on your own computer, with its own server and database. Your week stays with you, and your phone joins over your own network."
        >
          <Private />
        </WorkSection>

        <section id="download" className="sec" data-phase="Download" aria-labelledby="download-title">
          <div className="wrap">
            <div className="sec-head flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
              <div>
                <p className="label mb-5">
                  Version <span className="num">{pkg.version}</span> · free and open source
                </p>
                <h2 id="download-title">
                  Download <span className="it">Timely.</span>
                </h2>
              </div>
              <p className="max-w-[28rem] text-[17px] text-[var(--soft)]">
                Windows, Ubuntu and Arch Linux on the computer; Android on the phone. Each has a step-by-step install
                guide.
              </p>
            </div>
            <Downloads />
          </div>
        </section>

        <Closing />
      </main>
      <Footer />
    </Shell>
  );
}
