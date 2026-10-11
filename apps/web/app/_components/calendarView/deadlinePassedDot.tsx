/** Marks a placed block whose task's due date has already gone by. */
export default function DeadlinePassedDot() {
  return (
    <span
      role="img"
      aria-label="Overdue"
      className="mr-1 inline-block size-1.5 shrink-0 rounded-full bg-destructive align-middle"
    />
  );
}
