import type { MetadataRoute } from "next";

/** This is a private application, not a public website: nothing in it should be listed by search engines. (The widget frame is not a page people visit.) */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
