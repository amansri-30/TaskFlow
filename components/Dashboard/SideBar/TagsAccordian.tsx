import { ToolTipIcon } from "@/components/elements/TootTipIcon";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import type { TagStat } from "../Dashboard";
import { cn } from "@/lib/utils";

const TONES = [
  "bg-blue-500",
  "bg-amber-600",
  "bg-rose-600",
  "bg-emerald-600",
  "bg-violet-600",
  "bg-cyan-600",
  "bg-fuchsia-600",
  "bg-orange-600",
];

export function TagsAccordian({
  tags,
  activeTag,
  onTagClick,
}: {
  tags: TagStat[];
  activeTag?: string | null;
  onTagClick?: (tag: string) => void;
}) {
  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="tags">
        <ToolTipIcon
          name="Click to view all Tags"
          triggerJsxElement={
            <AccordionTrigger className="hover:no-underline p-2">
              <h2 className="text-2xl">Tags</h2>
            </AccordionTrigger>
          }
        />
        <AccordionContent>
          {tags.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 p-2">
              {tags.map((tag, index) => (
                <div className="col-span-1" key={tag.name}>
                  <button
                    onClick={() => onTagClick?.(tag.name)}
                    aria-label={`Filter tasks tagged "${tag.name}"`}
                    aria-pressed={activeTag === tag.name}
                    title={`${tag.count} task${tag.count === 1 ? "" : "s"} tagged "${tag.name}"`}
                    className={cn(
                      "flex items-center gap-1 rounded-full hover:opacity-80 transition-opacity",
                      activeTag === tag.name && "ring-2 ring-primary"
                    )}
                  >
                    <span
                      className={`inline-block ${TONES[index % TONES.length]} text-white text-xs px-2 py-1 rounded-full font-semibold tracking-wide`}
                    >
                      {tag.name}
                    </span>
                    <Badge variant="secondary" className="h-5 min-w-5 px-1 justify-center text-[10px]">
                      {tag.count}
                    </Badge>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-2 pb-2 text-xs text-muted-foreground">
              No tags yet — add tags when creating a task.
            </p>
          )}
          {tags.length > 0 && (
            <p className="px-2 pb-2 text-xs text-muted-foreground">
              Click a tag to filter tasks. Click again to clear.
            </p>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}