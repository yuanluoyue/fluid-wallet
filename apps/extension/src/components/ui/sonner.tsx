import { Toaster as Sonner, type ToasterProps } from "sonner";
// Sonner ships its styles as a separate file and does not import them itself,
// so a toast without this line renders unstyled.
import "sonner/dist/styles.css";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Transient confirmations, mounted once per document.
 *
 * The panel used to draw "Provider saved." as a badge in the page flow, which
 * pushed the list down and stayed there until the next action. A toast is the
 * right shape for that: it is an acknowledgement, not a state.
 *
 * `theme` is pinned rather than read from a provider: this build is light-only,
 * and a toast in the wrong theme is the kind of detail that makes a popup look
 * like two apps stacked on each other.
 */
function Toaster({ className, ...props }: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="bottom-center"
      closeButton={false}
      className={cn("toaster group", className)}
      style={{ "--width": "336px" } as React.CSSProperties}
      toastOptions={{
        classNames: {
          toast:
            "group toast !rounded-lg !border-border !bg-popover !text-[13px] !text-popover-foreground !shadow-lg",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
          cancelButton: "!bg-secondary !text-secondary-foreground",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
