/** For the load balancer: answers without touching the database or a session. */
export const dynamic = "force-dynamic";
export const GET = () => Response.json({ ok: true });
