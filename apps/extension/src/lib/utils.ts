import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges class names, last one winning.
 *
 * Without this, a `className` passed from outside cannot override the default
 * of a component: both `p-2` and `p-4` end up in the attribute and CSS decides
 * by source order, which is not the order the caller wrote.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
