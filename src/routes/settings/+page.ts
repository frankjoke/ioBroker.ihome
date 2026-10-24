import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

// The single Settings page was split into config tabs; Server & Security holds
// its old contents. Old bookmarks and links land there.
export const load: PageLoad = () => {
  throw redirect(307, "/#/server");
};
