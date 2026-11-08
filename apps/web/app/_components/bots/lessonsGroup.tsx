"use client";

import { X } from "lucide-react";
import { BOT_LIMITS, type Lesson } from "@timely/contract/bots";
import Button from "@/app/_components/_ui/button";
import {
  GroupHint,
  GroupLabel,
  ListGroup,
  ListRow,
} from "@/app/_components/_ui/groupedList";
import { useToastStore } from "@/app/_store/toastStore";
import { useForgetLesson } from "@/app/utils/hooks/bots";

/**
 * Lessons: what the bot was told by Not useful answers, kept for the AI
 * judge that comes later. Rules ignore them. Each one can be forgotten.
 */
export function LessonsGroup({
  botId,
  lessons,
}: {
  botId: string;
  lessons: Lesson[];
}) {
  const forget = useForgetLesson();
  return (
    <section>
      <GroupLabel aside={`${lessons.length} of ${BOT_LIMITS.maxLessons}`}>
        Lessons
      </GroupLabel>
      <ListGroup>
        {lessons.length === 0 ? (
          <ListRow
            key="none"
            label={
              <span className="text-muted-foreground">Nothing learned yet</span>
            }
          />
        ) : (
          lessons.map((lesson) => (
            <ListRow
              key={lesson.id}
              label={
                <span className="text-muted-foreground">{lesson.text}</span>
              }
            >
              <Button
                variant="ghost"
                size="sm"
                icon
                aria-label="Forget"
                loading={
                  forget.isPending && forget.variables?.lessonId === lesson.id
                }
                onClick={() =>
                  forget.mutate(
                    { botId, lessonId: lesson.id },
                    {
                      onError: (error) =>
                        useToastStore.getState().show(error.message),
                    },
                  )
                }
              >
                <X />
              </Button>
            </ListRow>
          ))
        )}
      </ListGroup>
      <GroupHint>
        Used once AI judging arrives; rules ignore them. Kept from your Not
        useful answers. Remove one to forget it.
      </GroupHint>
    </section>
  );
}
