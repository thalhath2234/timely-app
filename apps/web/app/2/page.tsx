import type { Metadata } from "next";
import ChapterAi from "./_parts/chapterAi";
import ChapterDocs from "./_parts/chapterDocs";
import { BackCover, ChapterDownload, ChapterPrivate } from "./_parts/chapterEnd";
import ChapterLoop from "./_parts/chapterLoop";
import ChapterMore from "./_parts/chapterMore";
import Footer from "./_parts/footer";
import Header from "./_parts/header";
import Hero from "./_parts/hero";
import Shell from "./_parts/shell";

export const metadata: Metadata = { title: { absolute: "Timely · Design 2" } };

/** Design iteration 2 · Ink and paper: the landing page as a printed planner manual. */
export default function DesignTwo() {
  return (
    <Shell>
      <Header />
      <main id="main-content">
        <Hero />
        <ChapterAi />
        <ChapterLoop />
        <ChapterDocs />
        <ChapterMore />
        <ChapterPrivate />
        <ChapterDownload />
        <BackCover />
      </main>
      <Footer />
    </Shell>
  );
}
