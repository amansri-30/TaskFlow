import { Task } from "@/types";
import {
  addDays,
  startOfDay,
  startOfWeek,
  isAfter,
} from "date-fns";

const WEEKS = 12;
const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function dateKey(date: Date): number {
  return startOfDay(date).getTime();
}

export function getCompletionMap(tasks: Task[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const t of tasks) {
    if (!t.completed || !t.completedAt) continue;
    const d = new Date(t.completedAt);
    if (isNaN(d.getTime())) continue;
    const key = dateKey(d);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

export function getStreaks(tasks: Task[]): { current: number; best: number } {
  const map = getCompletionMap(tasks);

  // current streak — counts back from today, or yesterday if today is empty
  let current = 0;
  let cursor = startOfDay(new Date());
  if (!map.has(dateKey(cursor))) {
    cursor = addDays(cursor, -1);
  }
  while (map.has(dateKey(cursor))) {
    current++;
    cursor = addDays(cursor, -1);
  }

  // best streak over the last 365 days
  let best = 0;
  let run = 0;
  const start = startOfDay(addDays(new Date(), -364));
  for (let d = start; !isAfter(d, new Date()); d = addDays(d, 1)) {
    run = map.has(dateKey(d)) ? run + 1 : 0;
    if (run > best) best = run;
  }

  return { current, best };
}

function tone(level: number): string {
  switch (level) {
    case 1:
      return "bg-emerald-400/50";
    case 2:
      return "bg-emerald-500/70";
    case 3:
      return "bg-emerald-600";
    default:
      return "bg-emerald-700";
  }
}

export default function ActivityHeatmap({ tasks }: { tasks: Task[] }) {
  const today = startOfDay(new Date());
  const gridStart = startOfWeek(addDays(today, -7 * (WEEKS - 1)), {
    weekStartsOn: 1,
  });
  const map = getCompletionMap(tasks);

  const cells: { date: Date; count: number }[] = [];
  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < 7; d++) {
      const date = addDays(gridStart, w * 7 + d);
      cells.push({ date, count: map.get(dateKey(date)) || 0 });
    }
  }

  const monthCells: { col: number; label: string }[] = [];
  let previousMonth: number | null = null;
  for (let w = 0; w < WEEKS; w++) {
    const colDate = addDays(gridStart, w * 7);
    if (w === 0) {
      monthCells.push({ col: 0, label: SHORT_MONTHS[colDate.getMonth()] });
      previousMonth = colDate.getMonth();
    } else if (colDate.getMonth() !== previousMonth) {
      monthCells.push({
        col: w,
        label: SHORT_MONTHS[colDate.getMonth()],
      });
      previousMonth = colDate.getMonth();
    }
  }

  const windowTotal = cells.reduce((sum, cell) => sum + cell.count, 0);
  const { current, best } = getStreaks(tasks);

  const gridStyle = {
    gridTemplateColumns: `repeat(${WEEKS}, 10px)`,
    gridAutoRows: "10px",
  };

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Activity — last {WEEKS} weeks
        </p>
        <span className="mb-2 text-xs font-semibold text-orange-500">
          {current} day streak
        </span>
      </div>
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${WEEKS}, 10px)` }}
        role="img"
        aria-label={`Activity heatmap: ${windowTotal} tasks completed in the last ${WEEKS} weeks`}
      >
        {monthCells.map(({ col, label }) => (
          <span
            key={`${col}-${label}`}
            className="col-start-1 text-[9px] leading-none text-muted-foreground"
            style={{ gridColumnStart: col + 1 }}
          >
            {label}
          </span>
        ))}
      </div>
      <div
        className="grid gap-[3px]"
        style={gridStyle}
        role="img"
        aria-label={`Activity heatmap: ${windowTotal} tasks completed in the last ${WEEKS} weeks`}
      >
        {cells.map((cell) => (
          <div
            key={cell.date.toDateString()}
            title={`${cell.date.toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}: ${cell.count} task${cell.count === 1 ? "" : "s"}`}
            className={`h-2.5 w-2.5 rounded-[2px] ${
              cell.count > 0
                ? tone(Math.min(4, cell.count))
                : "bg-muted"
            }`}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
        <span>Less</span>
        <span className="h-2.5 w-2.5 rounded-[2px] bg-muted" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-emerald-400/50" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-emerald-500/70" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-emerald-600" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-emerald-700" />
        <span>More</span>
        <span className="ml-2">{windowTotal} completions</span>
        {best > 1 && <span className="ml-1">· Best: {best}</span>}
      </div>
    </div>
  );
}