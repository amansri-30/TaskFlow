import { ToolTipIcon } from "@/components/elements/TootTipIcon";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const TAGS = [
  { label: "flipkart", tone: "bg-blue-500" },
  { label: "amazon", tone: "bg-amber-600" },
  { label: "bills", tone: "bg-rose-600" },
];

export function TagsAccordian({
  onTagClick,
}: {
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
          <div className="grid grid-cols-3 gap-2 p-2">
            {TAGS.map((tag) => (
              <div className="col-span-1" key={tag.label}>
                <button
                  onClick={() => onTagClick?.(tag.label)}
                  aria-label={`Search for ${tag.label}`}
                  title={`Search tasks matching "${tag.label}"`}
                  className="hover:opacity-80 transition-opacity"
                >
                  <span
                    className={`inline-block ${tag.tone} text-white text-xs px-2 py-1 rounded-full font-semibold tracking-wide`}
                  >
                    {tag.label}
                  </span>
                </button>
              </div>
            ))}
          </div>
          <p className="px-2 pb-2 text-xs text-muted-foreground">
            Click a tag to search your tasks for it.
          </p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}