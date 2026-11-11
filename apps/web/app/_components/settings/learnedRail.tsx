"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { DOWNLOAD_LEARNED } from "@timely/contract/agentLearning";
import Button from "@/app/_components/_ui/button";
import { GroupHint, GroupLabel, ListGroup, ListRow, ListSwitch } from "@/app/_components/_ui/groupedList";
import { downloadLearned } from "@/app/utils/api/learning";
import { useLearningSettings, usePatchLearningSettings } from "@/app/utils/hooks/learning";
import { ErrorRow, errorText } from "./learnedShared";

/**
 * The switches of "What Timely learned": Learning, and "Search my past
 * chats" (Q-3.5, on by default), then "Download what Timely learned". No
 * Learning model row: learning uses the chat's own model (Q-3.2).
 */
export default function LearnedRail() {
  const settings = useLearningSettings();
  const patch = usePatchLearningSettings();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const data = settings.data;
  async function download() {
    setDownloading(true);
    setDownloadError("");
    try {
      await downloadLearned();
    } catch (err) {
      setDownloadError(errorText(err, "Couldn't download it."));
    } finally {
      setDownloading(false);
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-5 xl:sticky xl:top-0" data-testid="learned-switches">
      <div>
        <GroupLabel>Learning</GroupLabel>
        <ListGroup>
          {settings.error ? (
            <ErrorRow
              error={settings.error}
              what="learning settings"
              onRetry={() => void settings.refetch()}
              retrying={settings.isFetching}
            />
          ) : (
            [
              <ListRow key="learning" label="Learn from chats" meta="Skills and notes from your chats">
                <ListSwitch
                  label="Learn from chats"
                  checked={data?.learning ?? false}
                  disabled={!data}
                  onChange={(learning) => patch.mutate({ learning })}
                />
              </ListRow>,
              <ListRow key="search" label="Search my past chats" meta="So Timely can look back at earlier chats">
                <ListSwitch
                  label="Search my past chats"
                  checked={data?.searchHistory ?? false}
                  disabled={!data || !data.learning}
                  onChange={(searchHistory) => patch.mutate({ searchHistory })}
                />
              </ListRow>,
            ]
          )}
        </ListGroup>
        <GroupHint>
          {patch.error
            ? errorText(patch.error, "Couldn't save that.")
            : data && !data.learning
              ? "Learning is off. Nothing new is saved, and what Timely already learned stays."
              : "Learning uses the chat's own model. Private photo chats and chats you mark “Don't learn from this chat” never teach it."}
        </GroupHint>
      </div>
      <div>
        <ListGroup>
          <ListRow label={DOWNLOAD_LEARNED} meta="Your learned skills, About you and Notes, as a zip">
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={DOWNLOAD_LEARNED}
              loading={downloading}
              onClick={() => void download()}
            >
              {!downloading && <Download aria-hidden />}
            </Button>
          </ListRow>
        </ListGroup>
        {downloadError && (
          <GroupHint>
            <span role="alert" className="text-destructive">
              {downloadError}
            </span>
          </GroupHint>
        )}
      </div>
    </div>
  );
}
