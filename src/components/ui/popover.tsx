import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

/** Simple className joiner so we don't depend on a utils/cn helper */
function cx(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, sideOffset = 8, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cx(
        // layering + look
        "z-[9999] min-w-[12rem] rounded-md border bg-white p-2 text-popover-foreground shadow-md outline-none",
        // nice open/close transitions (safe even if you don't have animations configured)
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
        "data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = "PopoverContent";

