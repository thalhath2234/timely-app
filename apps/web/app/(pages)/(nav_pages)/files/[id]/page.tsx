"use client";

import { useParams } from "next/navigation";
import FileView from "@/app/_components/files/fileView";

export default function FilePage() {
  const { id } = useParams<{ id: string }>();
  return <FileView key={id} id={id} />;
}
