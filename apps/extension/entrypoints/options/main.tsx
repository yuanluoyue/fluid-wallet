import { mountWallet } from "../../src/ui/mount";

// Same tree as the popup, laid out for a full tab. This page is what the
// first-run flow opens and what the approval window loads with `?approve=`.
void mountWallet("page");
