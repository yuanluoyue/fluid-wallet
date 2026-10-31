import { mountWallet } from "../../src/ui/mount";

// The popup is the wallet, not a launcher: everything the options page can do is
// reachable here, without opening a tab.
void mountWallet("popup");
