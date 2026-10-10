import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

// Legacy route: the Config tab was merged into Devices.
export const load: PageLoad = () => {
  throw redirect(307, "/#/devices");
};
