import { requireApiUser } from "../../../../lib/auth";
import { customerFor } from "../../../../lib/crm";
import { customerAccessDetails } from "../../../../lib/customer-permissions";
export async function GET(request: Request) {
  const auth = await requireApiUser(["admin"]);
  if (!auth.user) return auth.response;
  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    customerFor(auth.user, id);
    return Response.json(customerAccessDetails(id));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 404 });
  }
}
