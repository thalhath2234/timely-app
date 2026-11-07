import { BOT_LIMITS } from "@timely/contract/bots";
import { cn } from "@/app/utils/cn";

/** Strikes toward the self-pause, one segment each. */
export function StrikeMeter({
  strikes,
  max = BOT_LIMITS.maxStrikes,
}: {
  strikes: number;
  max?: number;
}) {
  return (
    <span
      role="img"
      aria-label={`${Math.min(strikes, max)} of ${max} strikes`}
      className="flex shrink-0 gap-[3px]"
    >
      {Array.from({ length: max }, (_, index) => (
        <i
          key={index}
          className={cn(
            "block h-1 w-[22px] rounded-[2px]",
            index < strikes ? "bg-destructive" : "bg-fill",
          )}
        />
      ))}
    </span>
  );
}
