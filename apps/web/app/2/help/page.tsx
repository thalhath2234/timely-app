import type { Metadata } from "next";
import Footer from "../_parts/footer";
import Header from "../_parts/header";
import HelpIndex from "../_parts/helpIndex";
import Shell from "../_parts/shell";

export const metadata: Metadata = { title: { absolute: "Timely Help Center · Design 2" } };

/** Design iteration 2 · Ink and paper: the help center home as a printed index. Articles stay at /help/<section>/<slug>. */
export default function DesignTwoHelp() {
  return (
    <Shell>
      <Header current="help" />
      <main id="main-content">
        <HelpIndex />
      </main>
      <Footer />
    </Shell>
  );
}
